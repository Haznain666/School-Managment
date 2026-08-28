import 'server-only';

import { and, asc, eq, inArray } from 'drizzle-orm';

import {
  branches,
  feeChallans,
  grades,
  schoolUsers,
  sections,
  studentEnrollments,
  studentGuardians,
  studentProfiles,
  OPEN_CHALLAN_STATUSES,
} from '@/db/schema';

import { AGING_BUCKETS, type AgingBucket } from './aging-buckets';
import { db } from './drizzle';
import { remindersForStudents, type ReminderChip } from './fee-reminders';
import { maskPhone } from './phone';

/**
 * The fee defaulter list — "the report an accountant actually opens each
 * morning" (`ROADMAP.md`).
 *
 * ── Aging is by due date, not by issue date ─────────────────────────────
 * A challan raised on the 1st and due on the 10th is not overdue on the 5th.
 * Bucketing from issue would put every current challan in the first bucket and
 * make the report useless in the first week of every month, which is when it is
 * read most.
 *
 * ── The buckets ─────────────────────────────────────────────────────────
 * 1–30, 31–60, 61–90, over 90, and a `current` column for what is owed but not
 * yet due. Current is shown rather than hidden because an accountant chasing
 * arrears still wants to know the household's whole position before they
 * telephone — arriving at "you owe 4,000" and being told "I paid this month's"
 * is how a collection call goes wrong.
 */

/*
 * Re-exported, not declared here.
 *
 * The definitions moved to `lib/aging-buckets.ts` so that the client component
 * drawing the aged-debt table can import them without dragging this module's
 * `server-only` marker — and `db/drizzle` behind it — into the browser bundle.
 * Every server-side caller of `@/lib/defaulters` keeps working unchanged.
 */
export {
  AGING_BUCKETS,
  BUCKET_LABELS,
  isAgingBucket,
  type AgingBucket,
} from './aging-buckets';

export interface DefaulterRow {
  studentProfileId: string;
  studentName: string;
  studentNumber: string;
  gradeName: string;
  sectionName: string;
  branchName: string;
  guardianName: string | null;
  guardianPhone: string | null;
  guardianEmail: string | null;
  /** Whether anyone could be reached about this at all. */
  reachable: boolean;
  openChallans: number;
  oldestDueDate: string;
  daysOverdue: number;
  bucket: AgingBucket;
  outstanding: string;
  buckets: Record<AgingBucket, string>;
  /**
   * The open vouchers behind `outstanding`, with what each still owes.
   *
   * Carried so the row's own quick actions have something to act on: **Send
   * reminder** posts these ids, and **Mark as paid** records one payment per
   * voucher for its own balance. Without them the screen would have to fetch a
   * student's vouchers on every click, and the figure it had just shown could
   * disagree with the one it then paid.
   */
  openVouchers: Array<{ challanId: string; challanNumber: string; balance: string }>;
  /** Every reminder sent to this family, oldest first. Chips on the row. */
  reminders: ReminderChip[];
}

export interface DefaulterFilters {
  branchId?: string | undefined;
  gradeId?: string | undefined;
  bucket?: AgingBucket | undefined;
  /** Ignore anyone owing less than this. Small residues are not defaults. */
  minimumAmount?: number | undefined;
}

export interface DefaulterSummary {
  students: number;
  outstanding: string;
  buckets: Record<AgingBucket, string>;
  /** How many have no phone and no email — nobody to chase. */
  unreachable: number;
}

function emptyBuckets(): Record<AgingBucket, number> {
  return { current: 0, d1_30: 0, d31_60: 0, d61_90: 0, d90_plus: 0 };
}

function bucketFor(daysOverdue: number): AgingBucket {
  if (daysOverdue <= 0) return 'current';
  if (daysOverdue <= 30) return 'd1_30';
  if (daysOverdue <= 60) return 'd31_60';
  if (daysOverdue <= 90) return 'd61_90';
  return 'd90_plus';
}

const money = (paisa: number) => (paisa / 100).toFixed(2);

/**
 * Every student with money outstanding, aged.
 *
 * Aggregated in this process rather than in SQL. The grouping is per student
 * across several buckets *and* carries the guardian, and expressing that as one
 * query means either five correlated subqueries or a pivot nobody will be able
 * to change later. A school's open challans are hundreds of rows, not
 * millions; this is the readable choice and it costs nothing at that size.
 * Revisit if a school ever carries tens of thousands of open challans, which
 * would mean something else has gone wrong.
 */
export async function listDefaulters(
  locationId: string,
  filters: DefaulterFilters = {},
): Promise<{ rows: DefaulterRow[]; summary: DefaulterSummary }> {
  const conditions = [
    eq(feeChallans.locationId, locationId),
    inArray(feeChallans.status, [...OPEN_CHALLAN_STATUSES]),
  ];

  if (filters.branchId !== undefined && filters.branchId !== '') {
    conditions.push(eq(grades.branchId, filters.branchId));
  }
  if (filters.gradeId !== undefined && filters.gradeId !== '') {
    conditions.push(eq(grades.id, filters.gradeId));
  }

  const rows = await db
    .select({
      challanId: feeChallans.id,
      challanNumber: feeChallans.challanNumber,
      studentProfileId: studentProfiles.id,
      studentName: schoolUsers.name,
      studentNumber: studentProfiles.studentId,
      dueDate: feeChallans.dueDate,
      totalAmount: feeChallans.totalAmount,
      paidAmount: feeChallans.paidAmount,
      gradeName: grades.name,
      sectionName: sections.name,
      branchName: branches.name,
      guardianName: studentGuardians.name,
      guardianPhone: studentGuardians.phone,
      guardianEmail: studentGuardians.email,
    })
    .from(feeChallans)
    .innerJoin(studentProfiles, eq(studentProfiles.id, feeChallans.studentProfileId))
    .innerJoin(schoolUsers, eq(schoolUsers.id, studentProfiles.schoolUserId))
    // The student's placement in the year the challan belongs to, so a child
    // who has since been promoted is still listed under the class the debt
    // was incurred in — which is where an accountant will look for them.
    .innerJoin(
      studentEnrollments,
      and(
        eq(studentEnrollments.studentProfileId, studentProfiles.id),
        eq(studentEnrollments.academicYearId, feeChallans.academicYearId),
      ),
    )
    .innerJoin(sections, eq(sections.id, studentEnrollments.sectionId))
    .innerJoin(grades, eq(grades.id, sections.gradeId))
    .innerJoin(branches, eq(branches.id, grades.branchId))
    .leftJoin(
      studentGuardians,
      and(
        eq(studentGuardians.studentProfileId, studentProfiles.id),
        eq(studentGuardians.isPrimaryContact, true),
      ),
    )
    .where(and(...conditions))
    .orderBy(asc(feeChallans.dueDate));

  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);

  interface Accumulator {
    row: Omit<
      DefaulterRow,
      | 'buckets'
      | 'outstanding'
      | 'bucket'
      | 'daysOverdue'
      | 'oldestDueDate'
      | 'reminders'
    >;
    buckets: Record<AgingBucket, number>;
    outstandingPaisa: number;
    oldestDue: string;
    maxOverdue: number;
  }

  const byStudent = new Map<string, Accumulator>();

  for (const row of rows) {
    const owedPaisa =
      Math.round(Number(row.totalAmount) * 100) - Math.round(Number(row.paidAmount) * 100);
    // A challan whose payments have caught up with it is not a default even if
    // its status has not been rewritten yet.
    if (owedPaisa <= 0) continue;

    const due = new Date(`${row.dueDate}T00:00:00Z`);
    const daysOverdue = Math.floor((today.getTime() - due.getTime()) / 86_400_000);
    const bucket = bucketFor(daysOverdue);

    const existing = byStudent.get(row.studentProfileId);

    const accumulator: Accumulator = existing ?? {
      row: {
        studentProfileId: row.studentProfileId,
        studentName: row.studentName,
        studentNumber: row.studentNumber,
        gradeName: row.gradeName,
        sectionName: row.sectionName,
        branchName: row.branchName,
        guardianName: row.guardianName,
        // Masked, matching the decision already taken on
        // `/api/school/fees/reports/defaulters`: this report exists to decide
        // *who* to chase, the reminder path reads the real number
        // server-side, and rendering four hundred parents' full numbers into
        // a page is handing out a contact list for no gain. `reachable`
        // below is computed from the unmasked value, so the report can still
        // say who cannot be reached at all.
        guardianPhone: row.guardianPhone === null ? null : maskPhone(row.guardianPhone),
        guardianEmail: row.guardianEmail,
        reachable:
          (row.guardianPhone !== null && row.guardianPhone !== '') ||
          (row.guardianEmail !== null && row.guardianEmail !== ''),
        openChallans: 0,
        openVouchers: [],
      },
      buckets: emptyBuckets(),
      outstandingPaisa: 0,
      oldestDue: row.dueDate,
      maxOverdue: daysOverdue,
    };

    accumulator.row.openChallans += 1;
    accumulator.row.openVouchers.push({
      challanId: row.challanId,
      challanNumber: row.challanNumber,
      balance: money(owedPaisa),
    });
    accumulator.buckets[bucket] += owedPaisa;
    accumulator.outstandingPaisa += owedPaisa;

    if (row.dueDate < accumulator.oldestDue) accumulator.oldestDue = row.dueDate;
    if (daysOverdue > accumulator.maxOverdue) accumulator.maxOverdue = daysOverdue;

    byStudent.set(row.studentProfileId, accumulator);
  }

  const minimumPaisa = Math.round((filters.minimumAmount ?? 0) * 100);

  let defaulters: DefaulterRow[] = [...byStudent.values()]
    .filter((entry) => entry.outstandingPaisa > minimumPaisa)
    .map((entry) => ({
      ...entry.row,
      reminders: [],
      oldestDueDate: entry.oldestDue,
      daysOverdue: entry.maxOverdue,
      // The student's bucket is their *worst* one. A household 100 days behind
      // on one challan and current on another is a 90-plus case, and filing
      // them under "not yet due" because most of the money is recent is how
      // the oldest debt goes unchased.
      bucket: bucketFor(entry.maxOverdue),
      outstanding: money(entry.outstandingPaisa),
      buckets: {
        current: money(entry.buckets.current),
        d1_30: money(entry.buckets.d1_30),
        d31_60: money(entry.buckets.d31_60),
        d61_90: money(entry.buckets.d61_90),
        d90_plus: money(entry.buckets.d90_plus),
      },
    }));

  if (filters.bucket !== undefined) {
    defaulters = defaulters.filter((entry) => entry.bucket === filters.bucket);
  }

  // Worst first: the report is a call list, and the top of it is who to
  // telephone before lunch.
  defaulters.sort((a, b) => b.daysOverdue - a.daysOverdue || Number(b.outstanding) - Number(a.outstanding));

  /*
   * The reminder history, read once for the whole page (item 6d).
   *
   * After the filters, not before: a report narrowed to the over-90 bucket
   * should not pay for the chase history of every student in the school.
   */
  const reminders = await remindersForStudents(
    locationId,
    defaulters.map((entry) => entry.studentProfileId),
  );

  for (const entry of defaulters) {
    entry.reminders = reminders.get(entry.studentProfileId) ?? [];
  }

  const summaryBuckets = emptyBuckets();
  let totalPaisa = 0;
  let unreachable = 0;

  for (const entry of defaulters) {
    for (const bucket of AGING_BUCKETS) {
      summaryBuckets[bucket] += Math.round(Number(entry.buckets[bucket]) * 100);
    }
    totalPaisa += Math.round(Number(entry.outstanding) * 100);
    if (!entry.reachable) unreachable += 1;
  }

  return {
    rows: defaulters,
    summary: {
      students: defaulters.length,
      outstanding: money(totalPaisa),
      buckets: {
        current: money(summaryBuckets.current),
        d1_30: money(summaryBuckets.d1_30),
        d31_60: money(summaryBuckets.d31_60),
        d61_90: money(summaryBuckets.d61_90),
        d90_plus: money(summaryBuckets.d90_plus),
      },
      unreachable,
    },
  };
}

/** Kept so a caller can type the filter without importing the whole module. */
