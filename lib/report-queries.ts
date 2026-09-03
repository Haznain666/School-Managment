import 'server-only';

import { and, asc, desc, eq, gte, inArray, lte, ne, sql, type SQL } from 'drizzle-orm';

import {
  admissionApplications,
  attendanceRecords,
  branches,
  expenseCategories,
  expenses,
  ledgerAccounts,
  ledgerEntries,
  ledgerTransactions,
  examSubjects,
  exams,
  examTerms,
  feeChallans,
  feePayments,
  gradeLabel,
  grades,
  leaveRequests,
  leaveTypes,
  payrollRuns,
  payslips,
  schoolUsers,
  sections,
  staff,
  studentEnrollments,
  studentProfiles,
  subjects,
  timetableEntries,
  MONTH_NAMES,
} from '@/db/schema';

import {
  ACCOUNT_TYPE_LABELS,
  LEDGER_SOURCE_LABELS,
  balancePaise,
  isLedgerSource,
  normalBalanceOf,
  profitPaise,
  type LedgerAccountType,
} from './accounting';
import { db } from './drizzle';
import { fromPaise, toPaise } from './money';
import {
  foldStudentTotals,
  readExamMarks,
  type FoldablePaper,
} from './dashboard-queries';
import {
  defaultDateRange,
  rate,
  type ReportKey,
  type ReportParams,
  type ReportRow,
} from './report-catalogue';

/**
 * The nine reports — Sprint 12.
 *
 * `lib/report-catalogue.ts` declares what each one is and what its columns are;
 * this module answers them. Split for the reason every `lib/*-queries.ts` in
 * this repo is split from its pure half: the catalogue is imported by the
 * browser bundle and this is `server-only`.
 *
 * ── Tenancy ──────────────────────────────────────────────────────────────
 * `locationId` comes from the verified session in every caller and is applied
 * to every table in every query below, including the ones reached by join.
 * Hazard §4.4. A report is the worst thing in the application to leak: it is a
 * whole school's finances or a whole staff's salaries in one response, and
 * unlike a list screen there is no per-row check downstream to catch it.
 *
 * `branchId` is the second scope and works differently. When the caller's
 * session carries one they are a branch-scoped administrator and *cannot*
 * widen it — the filter bar does not offer the control, and the runner applies
 * the session's value regardless of what the query string says. When it is
 * null the query-string value is honoured, because that caller may see the
 * whole school.
 *
 * ── Money ────────────────────────────────────────────────────────────────
 * `numeric` columns come back from postgres-js as strings and are summed in
 * Postgres, then converted to numbers here. Numbers, not formatted strings:
 * the CSV has to hand a spreadsheet something it can add up, and the screen
 * formats on the way to the page. See `lib/csv-export.ts`.
 *
 * ── Empty is a row of zeroes, never a missing row ────────────────────────
 * Aggregates here are built on the *thing being reported on* (the class, the
 * month, the subject) with a left join to the events, so a class nobody marked
 * a register for appears with zeroes rather than vanishing. A report that
 * silently omits its worst case is the failure mode these are for.
 */

/** What every runner is given. */
export interface ReportScope {
  locationId: string;
  /**
   * Set when the caller is branch-bound and may not widen.
   *
   * @deprecated Sprint 19a. The screens now resolve the campus through
   * `lib/branch-scope.ts` and pass the applied value in `params.branchId`,
   * because a person granted extra campuses has a real choice that a single
   * session field cannot express. It stays for `scripts/check-reports.ts`,
   * which drives the runners directly with bare parameters and has no session.
   */
  sessionBranchId: string | null;
  /**
   * The campuses the caller may read at all, from `resolveBranchScope`.
   *
   * `null` is the whole school. It is the backstop rather than the filter: the
   * *selection* arrives in `params.branchId`, already validated against this
   * list by the resolver, and this is here so a runner can refuse a value that
   * somehow reached it from outside — which is the difference between a filter
   * and a boundary.
   */
  branchIds?: string[] | null | undefined;
  /**
   * BR4 — the grades a scoped principal may be shown (Sprint 23, item 3).
   *
   * `undefined`/`null` is every grade, which is what every non-principal and
   * every `single`-model school resolves to. An **empty array** is an
   * unassigned head and matches no row.
   *
   * Applied only by the runners that *have* a class dimension. The seven
   * financial statements — balance sheet, P&L, day book, account summary,
   * monthly accounts, expense detail, income/expense — are read off
   * `ledger_entries` and have no grade to narrow on. Narrowing them would mean
   * inventing an attribution of a school's electricity bill to a class, which
   * is not a thing this ledger records; they are left whole and this is where
   * that is written down rather than in seven separate places.
   */
  gradeIds?: string[] | null | undefined;
}

export interface ReportResult {
  rows: ReportRow[];
  /** The footer line. Null for reports where a total means nothing. */
  totals: ReportRow | null;
}

/**
 * The campus actually applied.
 *
 * The order is: the caller's session pin (the pre-Sprint-19a path, still used
 * by `check-reports`), then the selection — but **only when it is inside the
 * caller's own scope**. A value from outside it falls back to the first campus
 * the resolver listed, which is the caller's own; it never falls back to
 * `undefined`, because `undefined` here means "no campus filter" and would
 * widen a branch-bound reader to the whole group.
 *
 * That is the one place in this module where getting the fallback wrong is a
 * leak rather than a wrong number, which is why it is written out rather than
 * expressed as a `??` chain.
 */
function effectiveBranch(scope: ReportScope, params: ReportParams): string | undefined {
  if (scope.sessionBranchId !== null) return scope.sessionBranchId;

  const requested = params.branchId === '' ? undefined : params.branchId;
  const allowed = scope.branchIds ?? null;

  if (allowed === null) return requested;
  if (requested !== undefined && allowed.includes(requested)) return requested;
  return allowed[0];
}

/**
 * The date range, always populated.
 *
 * `parseReportParams` fills these for every date-range report, but the runners
 * are also called from `scripts/check-reports.ts` with bare parameters — and a
 * `date` column compared against an empty string is a Postgres *error*, not an
 * empty result. Defaulting here means no runner can be handed one.
 */
/**
 * BR4 — the grade filter, or nothing (Sprint 23, item 3).
 *
 * Written once and applied identically in the five runners that join `grades`,
 * because five hand-written `inArray`s are five chances to narrow one report by
 * a different rule from the next — and a head reading two reports that
 * disagree about their own division has no way to tell which is wrong.
 *
 * `inArray` with an empty list renders as `false` in Drizzle, which is exactly
 * the reading wanted for an unassigned head: no rows, and the screen says why.
 */
function scopedGrades(scope: ReportScope): SQL | undefined {
  const ids = scope.gradeIds ?? null;
  if (ids === null) return undefined;
  return inArray(grades.id, ids);
}

function range(params: ReportParams): { from: string; to: string } {
  const fallback = defaultDateRange();
  return { from: params.from ?? fallback.from, to: params.to ?? fallback.to };
}

/** `numeric` string -> number, with null and unparseable both becoming 0. */
function num(value: string | number | null): number {
  if (value === null) return 0;
  const parsed = typeof value === 'number' ? value : Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

/** Two decimal places, so a sum of rupees does not print 1234.5600000001. */
function money(value: string | number | null): number {
  return Math.round(num(value) * 100) / 100;
}

const COUNT = (condition: SQL): SQL<number> =>
  sql<number>`count(*) filter (where ${condition})`.mapWith(Number);

const SUM = (column: SQL | ReturnType<typeof sql>): SQL<string> =>
  sql<string>`coalesce(sum(${column}), 0)`;

/* -----------------------------------------------------------------------------
 * 1. Attendance summary — one row per section.
 * -------------------------------------------------------------------------- */

async function attendanceSummary(
  scope: ReportScope,
  params: ReportParams,
): Promise<ReportResult> {
  const branchId = effectiveBranch(scope, params);
  const period = range(params);

  const rows = await db
    .select({
      gradeName: grades.name,
      gradeDisplayName: grades.displayName,
      gradeSortOrder: grades.sortOrder,
      sectionName: sections.name,
      branchName: branches.name,
      students: sql<number>`count(distinct ${studentEnrollments.studentProfileId})`.mapWith(Number),
      present: COUNT(eq(attendanceRecords.status, 'present')),
      absent: COUNT(eq(attendanceRecords.status, 'absent')),
      late: COUNT(eq(attendanceRecords.status, 'late')),
      excused: COUNT(eq(attendanceRecords.status, 'excused')),
      holiday: COUNT(eq(attendanceRecords.status, 'holiday')),
    })
    .from(studentEnrollments)
    .innerJoin(sections, eq(sections.id, studentEnrollments.sectionId))
    .innerJoin(grades, eq(grades.id, sections.gradeId))
    .innerJoin(branches, eq(branches.id, grades.branchId))
    // Left, so a section whose register was never taken is a row of zeroes
    // rather than an absence from the report.
    .leftJoin(
      attendanceRecords,
      and(
        eq(attendanceRecords.locationId, scope.locationId),
        eq(attendanceRecords.enrollmentId, studentEnrollments.id),
        gte(attendanceRecords.date, period.from),
        lte(attendanceRecords.date, period.to),
      ),
    )
    .where(
      and(
        eq(studentEnrollments.locationId, scope.locationId),
        eq(studentEnrollments.status, 'active'),
        branchId === undefined ? undefined : eq(grades.branchId, branchId),
        // BR4 — Sprint 23, item 3. Beside the campus filter, never instead of
        // it: the two boundaries compose exactly as they do on the dashboard.
        scopedGrades(scope),
        params.gradeId === undefined || params.gradeId === ''
          ? undefined
          : eq(grades.id, params.gradeId),
      ),
    )
    .groupBy(
      grades.id,
      grades.name,
      grades.displayName,
      grades.sortOrder,
      sections.id,
      sections.name,
      branches.name,
    )
    .orderBy(asc(branches.name), asc(grades.sortOrder), asc(sections.name));

  const totals = { present: 0, absent: 0, late: 0, excused: 0, holiday: 0, students: 0 };

  const out = rows.map((row) => {
    totals.students += row.students;
    totals.present += row.present;
    totals.absent += row.absent;
    totals.late += row.late;
    totals.excused += row.excused;
    totals.holiday += row.holiday;

    // A holiday is a school closure, not an absence — reported, but out of the
    // denominator. Late counts as present. Both rules are `attendancePercentage`'s
    // and are restated here only because this aggregates in SQL.
    const marked = row.present + row.absent + row.late + row.excused;

    return {
      className: gradeLabel({ name: row.gradeName, displayName: row.gradeDisplayName }),
      branchName: row.branchName,
      sectionName: row.sectionName,
      students: row.students,
      present: row.present,
      absent: row.absent,
      late: row.late,
      excused: row.excused,
      holiday: row.holiday,
      percentage: rate(row.present + row.late, marked),
    } satisfies ReportRow;
  });

  const markedTotal = totals.present + totals.absent + totals.late + totals.excused;

  return {
    rows: out,
    totals: {
      className: 'All classes',
      branchName: null,
      sectionName: null,
      students: totals.students,
      present: totals.present,
      absent: totals.absent,
      late: totals.late,
      excused: totals.excused,
      holiday: totals.holiday,
      percentage: rate(totals.present + totals.late, markedTotal),
    },
  };
}

/* -----------------------------------------------------------------------------
 * 2. Subject-wise attendance — derived from the daily register and the timetable.
 * -------------------------------------------------------------------------- */

/**
 * Attendance charged to subjects.
 *
 * The register is daily (see `db/schema/attendance-records.ts`: per-period
 * marking would multiply a teacher's work by seven for a number nobody reports
 * to a board). So there is no per-subject attendance to read, and inventing a
 * table for one would be a Sprint 12 migration in a sprint that has none.
 *
 * What there *is* is a timetable, which says which subjects a section studies
 * on each weekday. Joining one day's mark to that day's periods gives
 * student-periods: a child absent on a Tuesday costs whichever subjects their
 * section had on Tuesday. That is a real and useful number — it is teaching
 * time lost, per subject — and it is not the same number a per-period register
 * would give. The report says so on screen and on paper, because a head
 * comparing it against a teacher's own count needs to know why they differ.
 *
 * `day_of_week` is 0 = Monday; Postgres `isodow` is 1 = Monday.
 */
async function subjectAttendance(
  scope: ReportScope,
  params: ReportParams,
): Promise<ReportResult> {
  const branchId = effectiveBranch(scope, params);
  const period = range(params);

  const rows = await db
    .select({
      subjectName: subjects.name,
      subjectCode: subjects.code,
      sections: sql<number>`count(distinct ${timetableEntries.sectionId})`.mapWith(Number),
      attended: COUNT(inArray(attendanceRecords.status, ['present', 'late'])),
      missed: COUNT(inArray(attendanceRecords.status, ['absent', 'excused'])),
    })
    .from(attendanceRecords)
    .innerJoin(
      studentEnrollments,
      eq(studentEnrollments.id, attendanceRecords.enrollmentId),
    )
    .innerJoin(
      timetableEntries,
      and(
        eq(timetableEntries.locationId, scope.locationId),
        eq(timetableEntries.sectionId, studentEnrollments.sectionId),
        eq(timetableEntries.isActive, true),
        sql`${timetableEntries.dayOfWeek} = extract(isodow from ${attendanceRecords.date})::int - 1`,
      ),
    )
    .innerJoin(subjects, eq(subjects.id, timetableEntries.subjectId))
    .innerJoin(sections, eq(sections.id, studentEnrollments.sectionId))
    .innerJoin(grades, eq(grades.id, sections.gradeId))
    .where(
      and(
        eq(attendanceRecords.locationId, scope.locationId),
        gte(attendanceRecords.date, period.from),
        lte(attendanceRecords.date, period.to),
        // A closure is not teaching time, so it is in neither side of this.
        ne(attendanceRecords.status, 'holiday'),
        branchId === undefined ? undefined : eq(grades.branchId, branchId),
        // BR4 — Sprint 23, item 3. Beside the campus filter, never instead of
        // it: the two boundaries compose exactly as they do on the dashboard.
        scopedGrades(scope),
        params.gradeId === undefined || params.gradeId === ''
          ? undefined
          : eq(grades.id, params.gradeId),
      ),
    )
    .groupBy(subjects.id, subjects.name, subjects.code)
    .orderBy(asc(subjects.name));

  let attendedTotal = 0;
  let missedTotal = 0;

  const out = rows.map((row) => {
    attendedTotal += row.attended;
    missedTotal += row.missed;

    return {
      subjectName: row.subjectName,
      subjectCode: row.subjectCode,
      sections: row.sections,
      periodsScheduled: row.attended + row.missed,
      periodsAttended: row.attended,
      periodsMissed: row.missed,
      percentage: rate(row.attended, row.attended + row.missed),
    } satisfies ReportRow;
  });

  return {
    rows: out,
    totals: {
      subjectName: 'All subjects',
      subjectCode: null,
      sections: null,
      periodsScheduled: attendedTotal + missedTotal,
      periodsAttended: attendedTotal,
      periodsMissed: missedTotal,
      percentage: rate(attendedTotal, attendedTotal + missedTotal),
    },
  };
}

/* -----------------------------------------------------------------------------
 * 3. Fee collection — one row per class, on a billing basis.
 * -------------------------------------------------------------------------- */

/**
 * A challan is attributed to the class its student is *currently* enrolled in,
 * because a challan carries no section of its own. A child who transferred
 * mid-year therefore takes their billing history with them to the new class.
 * That is the right answer for the question this report is asked ("what is
 * Grade 5 costing us to collect") and the wrong one for a historical audit,
 * which is what the challan list itself is for.
 */
async function feeCollection(
  scope: ReportScope,
  params: ReportParams,
): Promise<ReportResult> {
  const branchId = effectiveBranch(scope, params);
  const period = range(params);

  const rows = await db
    .select({
      gradeName: grades.name,
      gradeDisplayName: grades.displayName,
      gradeSortOrder: grades.sortOrder,
      branchName: branches.name,
      challans: sql<number>`count(distinct ${feeChallans.id})`.mapWith(Number),
      students: sql<number>`count(distinct ${feeChallans.studentProfileId})`.mapWith(Number),
      billed: SUM(sql`${feeChallans.totalAmount}`),
      collected: SUM(sql`${feeChallans.paidAmount}`),
    })
    .from(feeChallans)
    .innerJoin(
      studentEnrollments,
      and(
        eq(studentEnrollments.locationId, scope.locationId),
        eq(studentEnrollments.studentProfileId, feeChallans.studentProfileId),
        eq(studentEnrollments.status, 'active'),
      ),
    )
    .innerJoin(sections, eq(sections.id, studentEnrollments.sectionId))
    .innerJoin(grades, eq(grades.id, sections.gradeId))
    .innerJoin(branches, eq(branches.id, grades.branchId))
    .where(
      and(
        eq(feeChallans.locationId, scope.locationId),
        gte(feeChallans.issueDate, period.from),
        lte(feeChallans.issueDate, period.to),
        // A cancelled challan was never owed. A waived one was owed and
        // forgiven, so it stays in `billed` — a school that waives half its
        // fees should see that in its collection rate, not have it hidden.
        ne(feeChallans.status, 'cancelled'),
        branchId === undefined ? undefined : eq(grades.branchId, branchId),
        // BR4 — Sprint 23, item 3. Beside the campus filter, never instead of
        // it: the two boundaries compose exactly as they do on the dashboard.
        scopedGrades(scope),
        params.gradeId === undefined || params.gradeId === ''
          ? undefined
          : eq(grades.id, params.gradeId),
      ),
    )
    .groupBy(
      grades.id,
      grades.name,
      grades.displayName,
      grades.sortOrder,
      branches.name,
    )
    .orderBy(asc(branches.name), asc(grades.sortOrder));

  let billedTotal = 0;
  let collectedTotal = 0;
  let challansTotal = 0;
  let studentsTotal = 0;

  const out = rows.map((row) => {
    const billed = money(row.billed);
    const collected = money(row.collected);

    billedTotal += billed;
    collectedTotal += collected;
    challansTotal += row.challans;
    studentsTotal += row.students;

    return {
      className: gradeLabel({ name: row.gradeName, displayName: row.gradeDisplayName }),
      branchName: row.branchName,
      challans: row.challans,
      students: row.students,
      billed,
      collected,
      outstanding: Math.round((billed - collected) * 100) / 100,
      rate: rate(collected, billed),
    } satisfies ReportRow;
  });

  return {
    rows: out,
    totals: {
      className: 'All classes',
      branchName: null,
      challans: challansTotal,
      // Deliberately not summed: one student appears in one class, but this is
      // the sum of per-class distinct counts and a transferred child could be
      // counted twice. The number is honest per row and unreliable in aggregate.
      students: studentsTotal,
      billed: Math.round(billedTotal * 100) / 100,
      collected: Math.round(collectedTotal * 100) / 100,
      outstanding: Math.round((billedTotal - collectedTotal) * 100) / 100,
      rate: rate(collectedTotal, billedTotal),
    },
  };
}

/* -----------------------------------------------------------------------------
 * 4. Outstanding & aging — one row per student, split across buckets.
 * -------------------------------------------------------------------------- */

/**
 * How this differs from the two aged-debt views that already exist: the
 * Defaulters tab in Fee Reports is a per-challan chase list feeding the
 * reminder sender, and `/dashboard/fees/defaulters` puts each student in the
 * *one* bucket their oldest debt falls into. Neither answers "how much of our
 * receivable is over 90 days", because a student with three challans of
 * different ages is one row in one bucket there. Here every student's debt is
 * split across all five, so the column totals are the receivable's real age
 * profile and they add up to the total owed.
 */
const BUCKET_SUM = (lower: number | null, upper: number | null): SQL<string> => {
  const owed = sql`${feeChallans.totalAmount} - ${feeChallans.paidAmount}`;
  const age = sql`(current_date - ${feeChallans.dueDate})`;

  if (lower === null) return SUM(sql`case when ${age} <= 0 then ${owed} else 0 end`);
  if (upper === null) return SUM(sql`case when ${age} > ${lower} then ${owed} else 0 end`);

  return SUM(
    sql`case when ${age} > ${lower} and ${age} <= ${upper} then ${owed} else 0 end`,
  );
};

async function outstandingAging(
  scope: ReportScope,
  params: ReportParams,
): Promise<ReportResult> {
  const branchId = effectiveBranch(scope, params);

  const rows = await db
    .select({
      studentName: schoolUsers.name,
      studentNumber: studentProfiles.studentId,
      gradeName: grades.name,
      gradeDisplayName: grades.displayName,
      branchName: branches.name,
      current: BUCKET_SUM(null, 0),
      d1_30: BUCKET_SUM(0, 30),
      d31_60: BUCKET_SUM(30, 60),
      d61_90: BUCKET_SUM(60, 90),
      d90_plus: BUCKET_SUM(90, null),
      total: SUM(sql`${feeChallans.totalAmount} - ${feeChallans.paidAmount}`),
    })
    .from(feeChallans)
    .innerJoin(studentProfiles, eq(studentProfiles.id, feeChallans.studentProfileId))
    .innerJoin(schoolUsers, eq(schoolUsers.id, studentProfiles.schoolUserId))
    .innerJoin(
      studentEnrollments,
      and(
        eq(studentEnrollments.locationId, scope.locationId),
        eq(studentEnrollments.studentProfileId, studentProfiles.id),
        eq(studentEnrollments.status, 'active'),
      ),
    )
    .innerJoin(sections, eq(sections.id, studentEnrollments.sectionId))
    .innerJoin(grades, eq(grades.id, sections.gradeId))
    .innerJoin(branches, eq(branches.id, grades.branchId))
    .where(
      and(
        eq(feeChallans.locationId, scope.locationId),
        inArray(feeChallans.status, ['unpaid', 'partial']),
        sql`${feeChallans.totalAmount} - ${feeChallans.paidAmount} > 0`,
        branchId === undefined ? undefined : eq(grades.branchId, branchId),
        // BR4 — Sprint 23, item 3. Beside the campus filter, never instead of
        // it: the two boundaries compose exactly as they do on the dashboard.
        scopedGrades(scope),
        params.gradeId === undefined || params.gradeId === ''
          ? undefined
          : eq(grades.id, params.gradeId),
      ),
    )
    .groupBy(
      studentProfiles.id,
      studentProfiles.studentId,
      schoolUsers.name,
      grades.name,
      grades.displayName,
      branches.name,
    )
    .orderBy(desc(SUM(sql`${feeChallans.totalAmount} - ${feeChallans.paidAmount}`)));

  const totals = { current: 0, d1_30: 0, d31_60: 0, d61_90: 0, d90_plus: 0, total: 0 };

  const out = rows.map((row) => {
    const cells = {
      current: money(row.current),
      d1_30: money(row.d1_30),
      d31_60: money(row.d31_60),
      d61_90: money(row.d61_90),
      d90_plus: money(row.d90_plus),
      total: money(row.total),
    };

    for (const key of Object.keys(totals) as Array<keyof typeof totals>) {
      totals[key] += cells[key];
    }

    return {
      studentName: row.studentName,
      studentNumber: row.studentNumber,
      className: gradeLabel({ name: row.gradeName, displayName: row.gradeDisplayName }),
      branchName: row.branchName,
      ...cells,
    } satisfies ReportRow;
  });

  return {
    rows: out,
    totals: {
      studentName: `${out.length} students`,
      studentNumber: null,
      className: null,
      branchName: null,
      current: Math.round(totals.current * 100) / 100,
      d1_30: Math.round(totals.d1_30 * 100) / 100,
      d31_60: Math.round(totals.d31_60 * 100) / 100,
      d61_90: Math.round(totals.d61_90 * 100) / 100,
      d90_plus: Math.round(totals.d90_plus * 100) / 100,
      total: Math.round(totals.total * 100) / 100,
    },
  };
}

/* -----------------------------------------------------------------------------
 * 5. Academic results — one row per exam in a term.
 * -------------------------------------------------------------------------- */

/**
 * Three reads and a fold, not one read per exam.
 *
 * The marks cannot be aggregated in SQL: passing means passing *every*
 * published paper, and an overall percentage is against the marks available
 * across all of them — both of which need the papers in hand. `foldStudentTotals`
 * is the same function the dashboard's exam charts use and is asserted without
 * a database in `scripts/check-dashboard-queries.ts`, so this report cannot
 * disagree with the chart or with the report card printed from the same marks.
 */
async function academicResults(
  scope: ReportScope,
  params: ReportParams,
): Promise<ReportResult> {
  const termId = params.termId === '' ? undefined : params.termId;
  if (termId === undefined) return { rows: [], totals: null };

  const branchId = effectiveBranch(scope, params);

  const examRows = await db
    .select({
      id: exams.id,
      title: exams.title,
      examDate: exams.examDate,
      gradeName: grades.name,
      gradeDisplayName: grades.displayName,
      gradeSortOrder: grades.sortOrder,
      sectionName: sections.name,
      branchName: branches.name,
    })
    .from(exams)
    .innerJoin(
      examTerms,
      and(eq(examTerms.id, exams.termId), eq(examTerms.locationId, scope.locationId)),
    )
    .innerJoin(sections, eq(sections.id, exams.sectionId))
    .innerJoin(grades, eq(grades.id, exams.gradeId))
    .innerJoin(branches, eq(branches.id, grades.branchId))
    .where(
      and(
        eq(exams.locationId, scope.locationId),
        eq(exams.termId, termId),
        // Item 9. This report grew a campus filter this sprint, so the
        // selection is honoured here the way every other campus-scoped runner
        // honours it — through `effectiveBranch`, which still lets a
        // branch-bound caller's own scope override whatever the URL says.
        branchId === undefined ? undefined : eq(grades.branchId, branchId),
        // BR4 — Sprint 23, item 3. Beside the campus filter, never instead of
        // it: the two boundaries compose exactly as they do on the dashboard.
        scopedGrades(scope),
      ),
    )
    .orderBy(asc(branches.name), asc(grades.sortOrder), asc(exams.examDate));

  if (examRows.length === 0) return { rows: [], totals: null };

  const paperRows = await db
    .select({
      id: examSubjects.id,
      examId: examSubjects.examId,
      maxMarks: examSubjects.maxMarks,
      passingMarks: examSubjects.passingMarks,
      resultsStatus: examSubjects.resultsStatus,
      resitStatus: examSubjects.resitStatus,
    })
    .from(examSubjects)
    .where(
      and(
        eq(examSubjects.locationId, scope.locationId),
        inArray(
          examSubjects.examId,
          examRows.map((row) => row.id),
        ),
      ),
    );

  // Published only — the same rule the report card follows. A chart or a report
  // built on draft marks would state a pass rate the school has not agreed to.
  const published = paperRows.filter((paper) => paper.resultsStatus === 'published');

  const marks = await readExamMarks(
    scope.locationId,
    published.map((paper) => paper.id),
  );

  const papersByExam = new Map<string, FoldablePaper[]>();
  for (const paper of published) {
    const list = papersByExam.get(paper.examId) ?? [];
    list.push({
      id: paper.id,
      resitStatus: paper.resitStatus,
      maxMarks: num(paper.maxMarks),
      passingMarks: num(paper.passingMarks),
    });
    papersByExam.set(paper.examId, list);
  }

  const marksByExam = new Map<string, typeof marks>();
  const examOfPaper = new Map(published.map((paper) => [paper.id, paper.examId]));
  for (const row of marks) {
    const examId = examOfPaper.get(row.examSubjectId);
    if (examId === undefined) continue;
    const list = marksByExam.get(examId) ?? [];
    list.push(row);
    marksByExam.set(examId, list);
  }

  let gradedTotal = 0;
  let passedTotal = 0;
  let excludedTotal = 0;
  const allPercentages: number[] = [];

  const out = examRows.map((exam) => {
    const papers = papersByExam.get(exam.id) ?? [];
    const totals = foldStudentTotals(papers, marksByExam.get(exam.id) ?? []);

    gradedTotal += totals.graded;
    passedTotal += totals.passed;
    excludedTotal += totals.absent + totals.unmarked;
    allPercentages.push(...totals.percentages);

    const sorted = [...totals.percentages].sort((a, b) => a - b);

    return {
      examTitle: exam.title,
      className: gradeLabel({ name: exam.gradeName, displayName: exam.gradeDisplayName }),
      branchName: `${exam.branchName} · ${exam.sectionName}`,
      papers: papers.length,
      graded: totals.graded,
      passed: totals.passed,
      passRate: rate(totals.passed, totals.graded),
      average: mean(totals.percentages),
      highest: sorted.at(-1) ?? null,
      lowest: sorted.at(0) ?? null,
      excluded: totals.absent + totals.unmarked,
    } satisfies ReportRow;
  });

  const sortedAll = [...allPercentages].sort((a, b) => a - b);

  return {
    rows: out,
    totals: {
      examTitle: `${examRows.length} exams`,
      className: null,
      branchName: null,
      papers: published.length,
      graded: gradedTotal,
      passed: passedTotal,
      passRate: rate(passedTotal, gradedTotal),
      average: mean(allPercentages),
      highest: sortedAll.at(-1) ?? null,
      lowest: sortedAll.at(0) ?? null,
      excluded: excludedTotal,
    },
  };
}

/** Mean to one decimal, or null for an empty set. */
function mean(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  return Math.round((10 * values.reduce((sum, value) => sum + value, 0)) / values.length) / 10;
}

/* -----------------------------------------------------------------------------
 * 6. Payroll summary — one row per run.
 * -------------------------------------------------------------------------- */

async function payrollSummary(
  scope: ReportScope,
  params: ReportParams,
): Promise<ReportResult> {
  const branchId = effectiveBranch(scope, params);
  const year = params.year ?? new Date().getFullYear();

  const rows = await db
    .select({
      payrollMonth: payrollRuns.payrollMonth,
      payrollYear: payrollRuns.payrollYear,
      status: payrollRuns.status,
      staffCount: payrollRuns.staffCount,
      gross: payrollRuns.grossTotal,
      deductions: payrollRuns.deductionTotal,
      net: payrollRuns.netTotal,
      branchName: branches.name,
      lossOfPay: SUM(sql`${payslips.lossOfPayAmount}`),
      paid: SUM(
        sql`case when ${payslips.status} = 'paid' then ${payslips.netPayable} else 0 end`,
      ),
    })
    .from(payrollRuns)
    .leftJoin(branches, eq(branches.id, payrollRuns.branchId))
    .leftJoin(
      payslips,
      and(
        eq(payslips.locationId, scope.locationId),
        eq(payslips.payrollRunId, payrollRuns.id),
      ),
    )
    .where(
      and(
        eq(payrollRuns.locationId, scope.locationId),
        eq(payrollRuns.payrollYear, year),
        branchId === undefined ? undefined : eq(payrollRuns.branchId, branchId),
      ),
    )
    .groupBy(
      payrollRuns.id,
      payrollRuns.payrollMonth,
      payrollRuns.payrollYear,
      payrollRuns.status,
      payrollRuns.staffCount,
      payrollRuns.grossTotal,
      payrollRuns.deductionTotal,
      payrollRuns.netTotal,
      branches.name,
    )
    .orderBy(asc(payrollRuns.payrollMonth), asc(branches.name));

  const totals = { staffCount: 0, gross: 0, lossOfPay: 0, deductions: 0, net: 0, paid: 0 };

  const out = rows.map((row) => {
    const cells = {
      staffCount: row.staffCount,
      gross: money(row.gross),
      lossOfPay: money(row.lossOfPay),
      deductions: money(row.deductions),
      net: money(row.net),
      paid: money(row.paid),
    };

    for (const key of Object.keys(totals) as Array<keyof typeof totals>) {
      totals[key] += cells[key];
    }

    return {
      period: `${MONTH_NAMES[row.payrollMonth - 1] ?? row.payrollMonth} ${row.payrollYear}`,
      branchName: row.branchName ?? 'All campuses',
      status: row.status,
      ...cells,
    } satisfies ReportRow;
  });

  return {
    rows: out,
    totals: {
      period: `${year}`,
      branchName: null,
      status: `${rows.length} runs`,
      staffCount: totals.staffCount,
      gross: Math.round(totals.gross * 100) / 100,
      lossOfPay: Math.round(totals.lossOfPay * 100) / 100,
      deductions: Math.round(totals.deductions * 100) / 100,
      net: Math.round(totals.net * 100) / 100,
      paid: Math.round(totals.paid * 100) / 100,
    },
  };
}

/* -----------------------------------------------------------------------------
 * 7. Leave summary — one row per staff member with leave in the range.
 * -------------------------------------------------------------------------- */

async function leaveSummary(
  scope: ReportScope,
  params: ReportParams,
): Promise<ReportResult> {
  const branchId = effectiveBranch(scope, params);

  const period = range(params);

  // Approved days appear four times below — as the total, split by whether the
  // leave type is paid, and as the sort key. The condition is written out each
  // time rather than bound once because Drizzle needs it inside four different
  // `sql` templates, and a shared fragment reused across them reads as though
  // it were one expression when it is four.
  const rows = await db
    .select({
      firstName: staff.firstName,
      lastName: staff.lastName,
      employeeCode: staff.employeeCode,
      department: staff.department,
      branchName: branches.name,
      requests: sql<number>`count(*)`.mapWith(Number),
      approvedDays: SUM(
        sql`case when ${leaveRequests.status} = 'approved' then ${leaveRequests.totalDays} else 0 end`,
      ),
      paidDays: SUM(
        sql`case when ${leaveRequests.status} = 'approved' and ${leaveTypes.isPaid} then ${leaveRequests.totalDays} else 0 end`,
      ),
      unpaidDays: SUM(
        sql`case when ${leaveRequests.status} = 'approved' and not ${leaveTypes.isPaid} then ${leaveRequests.totalDays} else 0 end`,
      ),
      pending: COUNT(eq(leaveRequests.status, 'pending')),
      rejected: COUNT(eq(leaveRequests.status, 'rejected')),
    })
    .from(leaveRequests)
    .innerJoin(staff, eq(staff.id, leaveRequests.staffId))
    .innerJoin(
      leaveTypes,
      and(
        eq(leaveTypes.id, leaveRequests.leaveTypeId),
        eq(leaveTypes.locationId, scope.locationId),
      ),
    )
    .leftJoin(branches, eq(branches.id, staff.branchId))
    .where(
      and(
        eq(leaveRequests.locationId, scope.locationId),
        gte(leaveRequests.startDate, period.from),
        lte(leaveRequests.startDate, period.to),
        branchId === undefined ? undefined : eq(staff.branchId, branchId),
      ),
    )
    .groupBy(
      staff.id,
      staff.firstName,
      staff.lastName,
      staff.employeeCode,
      staff.department,
      branches.name,
    )
    .orderBy(desc(sql`sum(case when ${leaveRequests.status} = 'approved' then ${leaveRequests.totalDays} else 0 end)`));

  const totals = {
    requests: 0,
    approvedDays: 0,
    paidDays: 0,
    unpaidDays: 0,
    pending: 0,
    rejected: 0,
  };

  const out = rows.map((row) => {
    const cells = {
      requests: row.requests,
      approvedDays: num(row.approvedDays),
      paidDays: num(row.paidDays),
      unpaidDays: num(row.unpaidDays),
      pending: row.pending,
      rejected: row.rejected,
    };

    for (const key of Object.keys(totals) as Array<keyof typeof totals>) {
      totals[key] += cells[key];
    }

    return {
      staffName: `${row.firstName} ${row.lastName}`.trim(),
      employeeCode: row.employeeCode,
      department: row.department,
      branchName: row.branchName,
      ...cells,
    } satisfies ReportRow;
  });

  return {
    rows: out,
    totals: {
      staffName: `${out.length} staff`,
      employeeCode: null,
      department: null,
      branchName: null,
      requests: totals.requests,
      approvedDays: Math.round(totals.approvedDays * 10) / 10,
      paidDays: Math.round(totals.paidDays * 10) / 10,
      unpaidDays: Math.round(totals.unpaidDays * 10) / 10,
      pending: totals.pending,
      rejected: totals.rejected,
    },
  };
}

/* -----------------------------------------------------------------------------
 * 8. Enrollment funnel — one row per class applied to.
 * -------------------------------------------------------------------------- */

async function enrollmentFunnel(
  scope: ReportScope,
  params: ReportParams,
): Promise<ReportResult> {
  const branchId = effectiveBranch(scope, params);
  const academicYearId =
    params.academicYearId === '' ? undefined : params.academicYearId;

  const rows = await db
    .select({
      gradeName: grades.name,
      gradeDisplayName: grades.displayName,
      gradeSortOrder: grades.sortOrder,
      branchName: branches.name,
      applications: sql<number>`count(*)`.mapWith(Number),
      pending: COUNT(eq(admissionApplications.status, 'pending')),
      reviewing: COUNT(eq(admissionApplications.status, 'reviewing')),
      waitlisted: COUNT(eq(admissionApplications.status, 'waitlisted')),
      accepted: COUNT(eq(admissionApplications.status, 'accepted')),
      rejected: COUNT(eq(admissionApplications.status, 'rejected')),
      enrolled: COUNT(sql`${admissionApplications.convertedToStudentProfileId} is not null`),
    })
    .from(admissionApplications)
    // Left, because an application can arrive without a class named on it —
    // the public form allows it — and dropping those would make the funnel
    // narrower than the enquiries the school actually received.
    .leftJoin(grades, eq(grades.id, admissionApplications.gradeId))
    .leftJoin(branches, eq(branches.id, admissionApplications.branchId))
    .where(
      and(
        eq(admissionApplications.locationId, scope.locationId),
        academicYearId === undefined
          ? undefined
          : eq(admissionApplications.academicYearId, academicYearId),
        branchId === undefined
          ? undefined
          : eq(admissionApplications.branchId, branchId),
      ),
    )
    .groupBy(
      grades.id,
      grades.name,
      grades.displayName,
      grades.sortOrder,
      branches.name,
    )
    .orderBy(asc(grades.sortOrder));

  const totals = {
    applications: 0,
    pending: 0,
    reviewing: 0,
    waitlisted: 0,
    accepted: 0,
    rejected: 0,
    enrolled: 0,
  };

  const out = rows.map((row) => {
    for (const key of Object.keys(totals) as Array<keyof typeof totals>) {
      totals[key] += row[key];
    }

    return {
      className:
        row.gradeName === null
          ? 'No class named'
          : gradeLabel({ name: row.gradeName, displayName: row.gradeDisplayName }),
      branchName: row.branchName,
      applications: row.applications,
      open: row.pending + row.reviewing,
      waitlisted: row.waitlisted,
      accepted: row.accepted,
      rejected: row.rejected,
      enrolled: row.enrolled,
      conversion: rate(row.enrolled, row.applications),
    } satisfies ReportRow;
  });

  return {
    rows: out,
    totals: {
      className: 'All classes',
      branchName: null,
      applications: totals.applications,
      open: totals.pending + totals.reviewing,
      waitlisted: totals.waitlisted,
      accepted: totals.accepted,
      rejected: totals.rejected,
      enrolled: totals.enrolled,
      conversion: rate(totals.enrolled, totals.applications),
    },
  };
}

/* -----------------------------------------------------------------------------
 * 9. Monthly revenue — twelve months, on a cash basis.
 * -------------------------------------------------------------------------- */

/** The last twelve months, oldest first, as `YYYY-MM`. */
function lastTwelveMonths(today: Date = new Date()): string[] {
  const months: string[] = [];
  for (let back = 11; back >= 0; back -= 1) {
    const point = new Date(Date.UTC(today.getFullYear(), today.getMonth() - back, 1));
    months.push(point.toISOString().slice(0, 7));
  }
  return months;
}

/**
 * Two reads over two different date columns, stitched onto a fixed twelve-month
 * spine.
 *
 * The spine is why: a month in which the school billed nothing and collected
 * nothing is a fact worth seeing on a revenue chart, and a `group by` produces
 * no row for it. Every report here is built on the thing being reported rather
 * than on the events.
 */
async function monthlyRevenue(
  scope: ReportScope,
  params: ReportParams,
): Promise<ReportResult> {
  const branchId = effectiveBranch(scope, params);
  const months = lastTwelveMonths();
  const from = `${months[0]}-01`;

  const branchFilter =
    branchId === undefined
      ? undefined
      : sql`${feeChallans.studentProfileId} in (
          select ${studentEnrollments.studentProfileId}
          from ${studentEnrollments}
          join ${sections} on ${sections.id} = ${studentEnrollments.sectionId}
          join ${grades} on ${grades.id} = ${sections.gradeId}
          where ${studentEnrollments.locationId} = ${scope.locationId}
            and ${studentEnrollments.status} = 'active'
            and ${grades.branchId} = ${branchId}
        )`;

  const billedRows = await db
    .select({
      month: sql<string>`to_char(${feeChallans.issueDate}, 'YYYY-MM')`,
      billed: SUM(sql`${feeChallans.totalAmount}`),
    })
    .from(feeChallans)
    .where(
      and(
        eq(feeChallans.locationId, scope.locationId),
        gte(feeChallans.issueDate, from),
        ne(feeChallans.status, 'cancelled'),
        branchFilter,
      ),
    )
    .groupBy(sql`to_char(${feeChallans.issueDate}, 'YYYY-MM')`);

  const collectedRows = await db
    .select({
      month: sql<string>`to_char(${feePayments.paymentDate}, 'YYYY-MM')`,
      collected: SUM(sql`${feePayments.amount}`),
      cash: SUM(
        sql`case when ${feePayments.paymentMethod} = 'cash' then ${feePayments.amount} else 0 end`,
      ),
      bankTransfer: SUM(
        sql`case when ${feePayments.paymentMethod} = 'bank_transfer' then ${feePayments.amount} else 0 end`,
      ),
      cheque: SUM(
        sql`case when ${feePayments.paymentMethod} = 'cheque' then ${feePayments.amount} else 0 end`,
      ),
      payments: sql<number>`count(*)`.mapWith(Number),
    })
    .from(feePayments)
    .innerJoin(
      feeChallans,
      and(
        eq(feeChallans.id, feePayments.challanId),
        eq(feeChallans.locationId, scope.locationId),
      ),
    )
    .where(
      and(
        eq(feePayments.locationId, scope.locationId),
        gte(feePayments.paymentDate, from),
        branchFilter,
      ),
    )
    .groupBy(sql`to_char(${feePayments.paymentDate}, 'YYYY-MM')`);

  const billedBy = new Map(billedRows.map((row) => [row.month, money(row.billed)]));
  const collectedBy = new Map(collectedRows.map((row) => [row.month, row]));

  const totals = {
    billed: 0,
    collected: 0,
    cash: 0,
    bankTransfer: 0,
    cheque: 0,
    payments: 0,
  };

  const out = months.map((month) => {
    const takings = collectedBy.get(month);

    const cells = {
      billed: billedBy.get(month) ?? 0,
      collected: money(takings?.collected ?? 0),
      cash: money(takings?.cash ?? 0),
      bankTransfer: money(takings?.bankTransfer ?? 0),
      cheque: money(takings?.cheque ?? 0),
      payments: takings?.payments ?? 0,
    };

    for (const key of Object.keys(totals) as Array<keyof typeof totals>) {
      totals[key] += cells[key];
    }

    const [year, monthNumber] = month.split('-');

    return {
      period: `${MONTH_NAMES[Number(monthNumber) - 1] ?? month} ${year}`,
      ...cells,
    } satisfies ReportRow;
  });

  return {
    rows: out,
    totals: {
      period: '12 months',
      billed: Math.round(totals.billed * 100) / 100,
      collected: Math.round(totals.collected * 100) / 100,
      cash: Math.round(totals.cash * 100) / 100,
      bankTransfer: Math.round(totals.bankTransfer * 100) / 100,
      cheque: Math.round(totals.cheque * 100) / 100,
      payments: totals.payments,
    },
  };
}


/* -----------------------------------------------------------------------------
 * Sprint 13.5 — the seven financial statements.
 *
 * Every one of them reads `ledger_entries` joined to `ledger_transactions` for
 * the date and to `ledger_accounts` for the head, and none of them reads the
 * fee, payroll or expense tables for a figure. That is the point of having a
 * ledger: one set of books, and a profit and loss that cannot disagree with a
 * balance sheet because both are the same sum grouped differently.
 *
 * Arithmetic is in paise throughout and converted once, on the way into the
 * row (`lib/money.ts`). A `numeric` column summed by Postgres arrives as a
 * string; parsing it to a float and adding would lose a paisa per line, and a
 * balance sheet that is out by four rupees is a balance sheet nobody trusts
 * again.
 * -------------------------------------------------------------------------- */

interface LedgerTotalsRow {
  accountId: string;
  code: string;
  name: string;
  type: LedgerAccountType;
  debitPaise: number;
  creditPaise: number;
}

/**
 * Debit and credit totals per account over a window, scoped to the caller.
 *
 * The shared read behind five of the seven. `from` is optional because a
 * balance sheet is a position on a day rather than a period: it needs every
 * entry ever posted up to the end date, and passing the range's start would
 * silently turn it into a statement of the month's movement wearing a balance
 * sheet's title.
 */
async function ledgerTotals(
  scope: ReportScope,
  window: { from?: string; to: string; branchId?: string },
): Promise<LedgerTotalsRow[]> {
  const conditions: SQL[] = [
    eq(ledgerTransactions.locationId, scope.locationId),
    lte(ledgerTransactions.entryDate, window.to),
  ];
  if (window.from !== undefined) {
    conditions.push(gte(ledgerTransactions.entryDate, window.from));
  }
  if (window.branchId !== undefined) {
    conditions.push(eq(ledgerTransactions.branchId, window.branchId));
  }

  const rows = await db
    .select({
      accountId: ledgerAccounts.id,
      code: ledgerAccounts.code,
      name: ledgerAccounts.name,
      type: ledgerAccounts.type,
      debit: SUM(sql`${ledgerEntries.debit}`),
      credit: SUM(sql`${ledgerEntries.credit}`),
    })
    .from(ledgerEntries)
    .innerJoin(ledgerTransactions, eq(ledgerTransactions.id, ledgerEntries.transactionId))
    .innerJoin(ledgerAccounts, eq(ledgerAccounts.id, ledgerEntries.accountId))
    .where(and(...conditions))
    .groupBy(ledgerAccounts.id, ledgerAccounts.code, ledgerAccounts.name, ledgerAccounts.type)
    .orderBy(asc(ledgerAccounts.code));

  return rows.map((row) => ({
    accountId: row.accountId,
    code: row.code,
    name: row.name,
    type: row.type,
    debitPaise: toPaise(row.debit),
    creditPaise: toPaise(row.credit),
  }));
}

/** Sums one type's balances, in paise. */
function totalOfType(rows: readonly LedgerTotalsRow[], type: LedgerAccountType): number {
  return rows
    .filter((row) => row.type === type)
    .reduce((total, row) => total + balancePaise(type, row), 0);
}

/* -----------------------------------------------------------------------------
 * 10. Balance sheet.
 * -------------------------------------------------------------------------- */

async function balanceSheet(
  scope: ReportScope,
  params: ReportParams,
): Promise<ReportResult> {
  const { to } = range(params);
  const totals = await ledgerTotals(scope, {
    to,
    branchId: effectiveBranch(scope, params),
  });

  const rows: ReportRow[] = [];

  for (const type of ['asset', 'liability', 'equity'] as const) {
    for (const account of totals.filter((row) => row.type === type)) {
      const balance = balancePaise(type, account);
      // A head that has never been posted to is left off. A balance sheet is
      // read line by line, and a page of zeroes hides the four lines that are
      // not zero.
      if (balance === 0 && account.debitPaise === 0 && account.creditPaise === 0) continue;

      rows.push({
        section: ACCOUNT_TYPE_LABELS[type],
        code: account.code,
        account: account.name,
        balance: fromPaise(balance),
      });
    }
  }

  const assets = totalOfType(totals, 'asset');
  const liabilities = totalOfType(totals, 'liability');
  const equity = totalOfType(totals, 'equity');
  const profit = profitPaise(totalOfType(totals, 'income'), totalOfType(totals, 'expense'));

  // Not closed out to a reserve — see the definition's caveat. Shown as its own
  // line so that Assets = Liabilities + Equity holds on the page, visibly,
  // rather than holding somewhere the reader has to take on trust.
  rows.push({
    section: 'Equity',
    code: '',
    account: 'Profit to date (not yet closed)',
    balance: fromPaise(profit),
  });

  return {
    rows,
    totals: {
      section: 'Assets = Liabilities + Equity',
      code: '',
      account: `${formatAmountPlain(assets)} = ${formatAmountPlain(liabilities + equity + profit)}`,
      balance: fromPaise(assets),
    },
  };
}

/** Rupees, grouped, with no currency prefix — for the footer sentence above. */
function formatAmountPlain(paise: number): string {
  return new Intl.NumberFormat('en-PK', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(fromPaise(paise));
}

/* -----------------------------------------------------------------------------
 * 11. Profit and loss.
 * -------------------------------------------------------------------------- */

async function profitLoss(scope: ReportScope, params: ReportParams): Promise<ReportResult> {
  const { from, to } = range(params);
  const totals = await ledgerTotals(scope, {
    from,
    to,
    branchId: effectiveBranch(scope, params),
  });

  const rows: ReportRow[] = [];

  for (const type of ['income', 'expense'] as const) {
    for (const account of totals.filter((row) => row.type === type)) {
      const balance = balancePaise(type, account);
      if (balance === 0) continue;

      rows.push({
        section: type === 'income' ? 'Income' : 'Expenses',
        code: account.code,
        account: account.name,
        amount: fromPaise(balance),
      });
    }
  }

  const income = totalOfType(totals, 'income');
  const expense = totalOfType(totals, 'expense');

  rows.push({ section: 'Income', code: '', account: 'Total income', amount: fromPaise(income) });
  rows.push({
    section: 'Expenses',
    code: '',
    account: 'Total expenses',
    amount: fromPaise(expense),
  });

  return {
    rows,
    totals: {
      section: 'Profit',
      code: '',
      account: income >= expense ? 'Surplus for the period' : 'Deficit for the period',
      amount: fromPaise(profitPaise(income, expense)),
    },
  };
}

/* -----------------------------------------------------------------------------
 * 12. Day book.
 * -------------------------------------------------------------------------- */

async function dayBook(scope: ReportScope, params: ReportParams): Promise<ReportResult> {
  const { from, to } = range(params);
  const branchId = effectiveBranch(scope, params);

  const conditions: SQL[] = [
    eq(ledgerTransactions.locationId, scope.locationId),
    gte(ledgerTransactions.entryDate, from),
    lte(ledgerTransactions.entryDate, to),
  ];
  if (branchId !== undefined) conditions.push(eq(ledgerTransactions.branchId, branchId));

  // ── Two queries and a regroup, not one query with correlated sub-selects ──
  //
  // The first version of this read the amount and the two account names with
  // five correlated sub-selects in the SELECT list, and it did not work.
  // **Drizzle renders a column interpolated into a `sql` template unqualified
  // when the outer query has a single table in its FROM**, and qualifies the
  // same expression once a join is present — which is exactly why the
  // near-identical sub-selects in `lib/accounting-queries.ts` are correct and
  // these were not.
  //
  // Unqualified, `… from ledger_entries join ledger_accounts on "id" =
  // "account_id"` is ambiguous and Postgres refuses it outright. The amount
  // sub-select beside it did not even have the grace to fail: `where
  // "transaction_id" = "id"` is a legal comparison of two `ledger_entries`
  // columns that is simply never true. So the day book threw — and had it not
  // thrown, it would have printed a column of zeroes.
  //
  // The regroup below is the shape `listDayBook` already uses, and it is immune
  // to all of that: no interpolated column ever leaves the query it belongs to.
  const transactions = await db
    .select({
      id: ledgerTransactions.id,
      entryDate: ledgerTransactions.entryDate,
      memo: ledgerTransactions.memo,
      source: ledgerTransactions.source,
      reference: ledgerTransactions.referenceNumber,
      reversesTransactionId: ledgerTransactions.reversesTransactionId,
    })
    .from(ledgerTransactions)
    .where(and(...conditions))
    .orderBy(desc(ledgerTransactions.entryDate), desc(ledgerTransactions.createdAt))
    .limit(2000);

  if (transactions.length === 0) {
    return {
      rows: [],
      totals: {
        entryDate: '',
        memo: 'No entries',
        source: '',
        reference: '',
        debitAccount: '',
        creditAccount: '',
        amount: 0,
      },
    };
  }

  const ids = transactions.map((transaction) => transaction.id);

  const lines = await db
    .select({
      transactionId: ledgerEntries.transactionId,
      accountName: ledgerAccounts.name,
      debit: ledgerEntries.debit,
      credit: ledgerEntries.credit,
    })
    .from(ledgerEntries)
    .innerJoin(ledgerAccounts, eq(ledgerAccounts.id, ledgerEntries.accountId))
    .where(inArray(ledgerEntries.transactionId, ids));

  // Which of these were cancelled by a later entry. A separate read rather than
  // an `exists` sub-select, for the same reason as above.
  const reversals = await db
    .select({ reversesTransactionId: ledgerTransactions.reversesTransactionId })
    .from(ledgerTransactions)
    .where(
      and(
        eq(ledgerTransactions.locationId, scope.locationId),
        inArray(ledgerTransactions.reversesTransactionId, ids),
      ),
    );

  const reversed = new Set(
    reversals.flatMap((row) =>
      row.reversesTransactionId === null ? [] : [row.reversesTransactionId],
    ),
  );

  interface Side {
    names: string[];
    total: number;
  }

  const debitsBy = new Map<string, Side>();
  const creditsBy = new Map<string, Side>();

  for (const line of lines) {
    const debit = toPaise(line.debit);
    const credit = toPaise(line.credit);

    if (debit > 0) {
      const side = debitsBy.get(line.transactionId) ?? { names: [], total: 0 };
      side.names.push(line.accountName);
      side.total += debit;
      debitsBy.set(line.transactionId, side);
    }
    if (credit > 0) {
      const side = creditsBy.get(line.transactionId) ?? { names: [], total: 0 };
      side.names.push(line.accountName);
      side.total += credit;
      creditsBy.set(line.transactionId, side);
    }
  }

  /** The first account of a side, and how many more there were. */
  const describe = (side: Side | undefined): string => {
    if (side === undefined || side.names.length === 0) return '—';
    const [first, ...rest] = side.names;
    return rest.length === 0 ? (first ?? '—') : `${first ?? '—'} +${rest.length}`;
  };

  let total = 0;

  const out = transactions.map((transaction) => {
    const debitSide = debitsBy.get(transaction.id);
    const amount = debitSide?.total ?? 0;
    total += amount;

    return {
      entryDate: transaction.entryDate,
      // The strike-through cannot survive a CSV, so the marking is words. A
      // reversed entry that looked ordinary in a spreadsheet is how a figure
      // gets counted twice by somebody reconciling in Excel.
      memo:
        transaction.reversesTransactionId !== null
          ? `${transaction.memo} [reversal]`
          : reversed.has(transaction.id)
            ? `${transaction.memo} [reversed]`
            : transaction.memo,
      source: isLedgerSource(transaction.source)
        ? LEDGER_SOURCE_LABELS[transaction.source]
        : transaction.source,
      reference: transaction.reference ?? '',
      debitAccount: describe(debitSide),
      creditAccount: describe(creditsBy.get(transaction.id)),
      amount: fromPaise(amount),
    } satisfies ReportRow;
  });

  return {
    rows: out,
    totals: {
      entryDate: '',
      memo: `${out.length} ${out.length === 1 ? 'entry' : 'entries'}`,
      source: '',
      reference: '',
      debitAccount: '',
      creditAccount: '',
      amount: fromPaise(total),
    },
  };
}

/* -----------------------------------------------------------------------------
 * 13. Account summary, day by day.
 * -------------------------------------------------------------------------- */

async function accountSummary(
  scope: ReportScope,
  params: ReportParams,
): Promise<ReportResult> {
  const { from, to } = range(params);
  const branchId = effectiveBranch(scope, params);

  const rows = await db
    .select({
      entryDate: ledgerTransactions.entryDate,
      code: ledgerAccounts.code,
      name: ledgerAccounts.name,
      type: ledgerAccounts.type,
      entries: sql<number>`count(*)::int`,
      debit: SUM(sql`${ledgerEntries.debit}`),
      credit: SUM(sql`${ledgerEntries.credit}`),
    })
    .from(ledgerEntries)
    .innerJoin(ledgerTransactions, eq(ledgerTransactions.id, ledgerEntries.transactionId))
    .innerJoin(ledgerAccounts, eq(ledgerAccounts.id, ledgerEntries.accountId))
    .where(
      and(
        eq(ledgerTransactions.locationId, scope.locationId),
        gte(ledgerTransactions.entryDate, from),
        lte(ledgerTransactions.entryDate, to),
        // Item 9. A posting with **no** campus is excluded when one is chosen,
        // rather than folded into every campus: an opening balance or a
        // head-office cost belongs to no campus, and apportioning it here would
        // invent an allocation the school never made and make the four campus
        // sheets add up to more than the group's.
        branchId === undefined ? undefined : eq(ledgerTransactions.branchId, branchId),
      ),
    )
    .groupBy(
      ledgerTransactions.entryDate,
      ledgerAccounts.code,
      ledgerAccounts.name,
      ledgerAccounts.type,
    )
    .orderBy(desc(ledgerTransactions.entryDate), asc(ledgerAccounts.code));

  let debits = 0;
  let credits = 0;

  const out = rows.map((row) => {
    const debit = toPaise(row.debit);
    const credit = toPaise(row.credit);
    debits += debit;
    credits += credit;

    // Net, in the direction this account grows: a day's cash takings read
    // positive and a day's payments out read negative, and an income account
    // that earned 20,000 also reads positive.
    const movement =
      normalBalanceOf(row.type) === 'debit' ? debit - credit : credit - debit;

    return {
      entryDate: row.entryDate,
      account: `${row.code} ${row.name}`,
      entries: row.entries,
      debit: fromPaise(debit),
      credit: fromPaise(credit),
      movement: fromPaise(movement),
    } satisfies ReportRow;
  });

  return {
    rows: out,
    totals: {
      entryDate: '',
      account: `${out.length} account-days`,
      entries: out.reduce((total, row) => total + Number(row.entries ?? 0), 0),
      debit: fromPaise(debits),
      credit: fromPaise(credits),
      // Debits equal credits over any complete set of entries. A non-zero here
      // means something was posted unbalanced, which the poster refuses — so it
      // is a figure worth printing precisely because it should always be zero.
      movement: fromPaise(debits - credits),
    },
  };
}

/* -----------------------------------------------------------------------------
 * 14. Month by month.
 * -------------------------------------------------------------------------- */

async function monthlyAccounts(
  scope: ReportScope,
  params: ReportParams,
): Promise<ReportResult> {
  const year = params.year ?? new Date().getFullYear();
  const from = `${year}-01-01`;
  const to = `${year}-12-31`;
  const branchId = effectiveBranch(scope, params);

  const rows = await db
    .select({
      month: sql<string>`to_char(${ledgerTransactions.entryDate}, 'YYYY-MM')`,
      type: ledgerAccounts.type,
      entries: sql<number>`count(distinct ${ledgerTransactions.id})::int`,
      debit: SUM(sql`${ledgerEntries.debit}`),
      credit: SUM(sql`${ledgerEntries.credit}`),
    })
    .from(ledgerEntries)
    .innerJoin(ledgerTransactions, eq(ledgerTransactions.id, ledgerEntries.transactionId))
    .innerJoin(ledgerAccounts, eq(ledgerAccounts.id, ledgerEntries.accountId))
    .where(
      and(
        eq(ledgerTransactions.locationId, scope.locationId),
        gte(ledgerTransactions.entryDate, from),
        lte(ledgerTransactions.entryDate, to),
        inArray(ledgerAccounts.type, ['income', 'expense']),
        // Item 9. Same rule as the account summary above: a school-wide posting
        // is excluded rather than spread.
        branchId === undefined ? undefined : eq(ledgerTransactions.branchId, branchId),
      ),
    )
    .groupBy(sql`to_char(${ledgerTransactions.entryDate}, 'YYYY-MM')`, ledgerAccounts.type);

  const byMonth = new Map<string, { income: number; expenses: number; entries: number }>();

  for (const row of rows) {
    const cell = byMonth.get(row.month) ?? { income: 0, expenses: 0, entries: 0 };
    const balance =
      row.type === 'income'
        ? toPaise(row.credit) - toPaise(row.debit)
        : toPaise(row.debit) - toPaise(row.credit);

    if (row.type === 'income') cell.income += balance;
    else cell.expenses += balance;

    // Distinct transactions per type, so a transaction touching both an income
    // and an expense head would be counted twice. It is a count for the eye
    // rather than a figure anybody reconciles, and it is marked secondary.
    cell.entries += row.entries;
    byMonth.set(row.month, cell);
  }

  const totals = { income: 0, expenses: 0, entries: 0 };

  // All twelve months, including the empty ones: a missing month reads as an
  // oversight and a zero reads as a quiet month.
  const out = Array.from({ length: 12 }, (_unused, index) => {
    const key = `${year}-${String(index + 1).padStart(2, '0')}`;
    const cell = byMonth.get(key) ?? { income: 0, expenses: 0, entries: 0 };

    totals.income += cell.income;
    totals.expenses += cell.expenses;
    totals.entries += cell.entries;

    return {
      period: `${MONTH_NAMES[index] ?? key} ${year}`,
      income: fromPaise(cell.income),
      expenses: fromPaise(cell.expenses),
      profit: fromPaise(profitPaise(cell.income, cell.expenses)),
      entries: cell.entries,
    } satisfies ReportRow;
  });

  return {
    rows: out,
    totals: {
      period: String(year),
      income: fromPaise(totals.income),
      expenses: fromPaise(totals.expenses),
      profit: fromPaise(profitPaise(totals.income, totals.expenses)),
      entries: totals.entries,
    },
  };
}

/* -----------------------------------------------------------------------------
 * 15. Expenses by category.
 * -------------------------------------------------------------------------- */

async function expenseDetail(
  scope: ReportScope,
  params: ReportParams,
): Promise<ReportResult> {
  const { from, to } = range(params);
  const branchId = effectiveBranch(scope, params);

  const conditions: SQL[] = [
    eq(expenses.locationId, scope.locationId),
    gte(expenses.expenseDate, from),
    lte(expenses.expenseDate, to),
    // Approved only. A draft is a request for money and a rejected one is a
    // request that was refused; neither left the school.
    eq(expenses.status, 'approved'),
  ];
  if (branchId !== undefined) conditions.push(eq(expenses.branchId, branchId));

  const rows = await db
    .select({
      category: expenseCategories.name,
      account: ledgerAccounts.name,
      expenseDate: expenses.expenseDate,
      payee: expenses.payee,
      reference: expenses.referenceNumber,
      paidFrom: sql<string>`(
        select paid.name from ${ledgerAccounts} as paid
        where paid.id = ${expenses.paidFromAccountId}
      )`,
      approvedBy: schoolUsers.name,
      amount: expenses.amount,
    })
    .from(expenses)
    .innerJoin(expenseCategories, eq(expenseCategories.id, expenses.categoryId))
    .innerJoin(ledgerAccounts, eq(ledgerAccounts.id, expenseCategories.ledgerAccountId))
    .leftJoin(schoolUsers, eq(schoolUsers.id, expenses.approvedBy))
    .where(and(...conditions))
    .orderBy(asc(expenseCategories.name), desc(expenses.expenseDate))
    .limit(2000);

  let total = 0;

  const out = rows.map((row) => {
    const amount = toPaise(row.amount);
    total += amount;

    return {
      category: row.category,
      account: row.account,
      expenseDate: row.expenseDate,
      payee: row.payee ?? '',
      reference: row.reference ?? '',
      paidFrom: row.paidFrom,
      approvedBy: row.approvedBy ?? '',
      amount: fromPaise(amount),
    } satisfies ReportRow;
  });

  return {
    rows: out,
    totals: {
      category: `${out.length} ${out.length === 1 ? 'expense' : 'expenses'}`,
      account: '',
      expenseDate: '',
      payee: '',
      reference: '',
      paidFrom: '',
      approvedBy: '',
      amount: fromPaise(total),
    },
  };
}

/* -----------------------------------------------------------------------------
 * 16. Income and expense summary.
 * -------------------------------------------------------------------------- */

async function incomeExpenseSummary(
  scope: ReportScope,
  params: ReportParams,
): Promise<ReportResult> {
  const { from, to } = range(params);
  // Item 9. `ledgerTotals` has always taken a campus; this report simply never
  // offered one, so its figures were the group's under a heading that did not
  // say so.
  const totals = await ledgerTotals(scope, {
    from,
    to,
    branchId: effectiveBranch(scope, params),
  });

  const income = totalOfType(totals, 'income');
  const expense = totalOfType(totals, 'expense');

  const rows: ReportRow[] = [];

  for (const type of ['income', 'expense'] as const) {
    const sideTotal = type === 'income' ? income : expense;

    for (const account of totals.filter((row) => row.type === type)) {
      const balance = balancePaise(type, account);
      if (balance === 0) continue;

      rows.push({
        section: type === 'income' ? 'Income' : 'Expenses',
        code: account.code,
        account: account.name,
        amount: fromPaise(balance),
        // Share of its own side, not of the whole sheet. "Salaries are 62% of
        // what we spend" is a sentence a head teacher can act on; "salaries
        // are 31% of income plus expenses" is not a sentence at all.
        share: rate(balance, sideTotal),
      });
    }
  }

  return {
    rows,
    totals: {
      section: 'Net',
      code: '',
      account: income >= expense ? 'Surplus' : 'Deficit',
      amount: fromPaise(profitPaise(income, expense)),
      share: null,
    },
  };
}

/* -----------------------------------------------------------------------------
 * The runner.
 * -------------------------------------------------------------------------- */

const RUNNERS: Record<
  ReportKey,
  (scope: ReportScope, params: ReportParams) => Promise<ReportResult>
> = {
  'attendance-summary': attendanceSummary,
  'subject-attendance': subjectAttendance,
  'fee-collection': feeCollection,
  'outstanding-aging': outstandingAging,
  'academic-results': academicResults,
  'payroll-summary': payrollSummary,
  'leave-summary': leaveSummary,
  'enrollment-funnel': enrollmentFunnel,
  'monthly-revenue': monthlyRevenue,
  'balance-sheet': balanceSheet,
  'profit-loss': profitLoss,
  'day-book': dayBook,
  'account-summary': accountSummary,
  'monthly-accounts': monthlyAccounts,
  'expense-detail': expenseDetail,
  'income-expense-summary': incomeExpenseSummary,
};

/**
 * Runs one report.
 *
 * The single entry point on purpose: the screen, the print page and the CSV
 * route all call this with the same scope and the same parsed params, so the
 * three can never be looking at different data. Whoever adds the tenth report
 * adds a definition and a runner and gets all three renderers for free.
 */
export async function runReport(
  key: ReportKey,
  scope: ReportScope,
  params: ReportParams,
): Promise<ReportResult> {
  return RUNNERS[key](scope, params);
}
