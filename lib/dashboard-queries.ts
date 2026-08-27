import 'server-only';

import { and, asc, desc, eq, gte, inArray, isNull, lt, lte, or, sql } from 'drizzle-orm';

import {
  APPLICATION_STATUSES,
  APPLICATION_STATUS_LABELS,
} from '@/db/schema/admission-applications';
import {
  attendanceRecords,
  admissionApplications,
  branches,
  examResults,
  examSubjects,
  exams,
  feeChallans,
  feePayments,
  feeStructures,
  feeTypes,
  gradeLabel,
  grades,
  principalAssignments,
  schoolUsers,
  schools,
  sections,
  staff,
  studentEnrollments,
  subjects,
  timetableEntries,
} from '@/db/schema';

import { academicYearBounds } from './academics-queries';
import { getActiveAcademicYear } from './admissions-queries';
import { db } from './drizzle';
import {
  bandsForTerm,
  getExamDetail,
  resultPicker,
  type CountingPaper,
} from './exam-queries';
import { toDateOnly } from './fee-queries';
import { percentageOf, resolveBand, toMark, type ResolvedBand } from './grading';

/**
 * The aggregate reads behind the dashboard charts.
 *
 * Separate from the feature query modules on purpose: these are *summaries*
 * over the same tables the feature screens read row by row, they are only ever
 * called from a dashboard, and keeping them together makes it obvious that
 * every one is a read with no write path near it.
 *
 * ── Tenancy ──────────────────────────────────────────────────────────────
 * `locationId` comes from the verified session in every caller and is applied
 * to every table in every query below, including the ones reached by join.
 * Hazard §4.4: the filters are the enforcement, not a formality, and an
 * aggregate that leaked would leak a whole other school's finances at once
 * rather than one row.
 *
 * ── Money ────────────────────────────────────────────────────────────────
 * `numeric` columns come back from postgres-js as strings. They are summed in
 * the database and converted once here, so nothing downstream has to remember.
 */

/** Months of history the trend charts show. */
const TREND_MONTHS = 12;

/* -----------------------------------------------------------------------------
 * Shared shapes.
 * -------------------------------------------------------------------------- */

export interface MonthPoint {
  /** `YYYY-MM`, for keys and sorting. */
  month: string;
  /** Short label for an axis: `Mar`. */
  label: string;
  value: number;
}

export interface NamedCount {
  label: string;
  value: number;
}

/* -----------------------------------------------------------------------------
 * Scope — BR4, expressed once for every aggregate below.
 * -------------------------------------------------------------------------- */

/**
 * The slice of a school an aggregate is allowed to count.
 *
 * `gradeIds: null` narrows nothing and is what every school administrator,
 * every accountant and every school on `principal_model = 'single'` gets. A
 * principal at a school running several heads gets the grades their assignments
 * reach, resolved once per request by `resolveDashboardScope` in
 * `lib/school-dashboard.ts`.
 *
 * ── Why *grades*, and not branches as well ───────────────────────────────
 * Because that is how the rest of the product already narrows a head. A branch
 * reaches the data through its grades — `lib/admissions-queries.ts` filters
 * students on `grades.branch_id` — so resolving both axes down to one list of
 * grade ids gives every aggregate here a single condition to apply and makes
 * "did this query get scoped" answerable by reading one line of it.
 *
 * ── An empty list is a real answer ───────────────────────────────────────
 * An unassigned head reaches no grade. `[]` means exactly that, and every
 * aggregate short-circuits on it rather than issuing `in ()` — which is both a
 * pointless round trip and, on some Drizzle versions, invalid SQL.
 */
export interface AggregateScope {
  gradeIds: string[] | null;
}

/** The scope that narrows nothing. */
export const EVERY_GRADE: AggregateScope = { gradeIds: null };

/** True when the reader reaches no grade at all, so there is nothing to count. */
function reachesNothing(scope: AggregateScope): boolean {
  return scope.gradeIds !== null && scope.gradeIds.length === 0;
}

/**
 * The students inside the scope, as a *subquery* rather than a fetched list.
 *
 * A materialised list would be thousands of uuids on a large school and would
 * be sent over the wire twice — once out, once back inside an `IN`. As a
 * subquery Postgres plans it as a semi-join against indexes it already has, and
 * the outer query keeps the exact shape it has when nothing is scoped, which is
 * what makes the unscoped path provably unchanged.
 */
function studentsInScope(locationId: string, gradeIds: string[]) {
  return db
    .selectDistinct({ id: studentEnrollments.studentProfileId })
    .from(studentEnrollments)
    .innerJoin(
      sections,
      and(eq(sections.id, studentEnrollments.sectionId), eq(sections.locationId, locationId)),
    )
    .where(
      and(
        eq(studentEnrollments.locationId, locationId),
        inArray(sections.gradeId, gradeIds),
      ),
    );
}

/** The challans belonging to those students — the door money-side reads use. */
function challansInScope(locationId: string, gradeIds: string[]) {
  return db
    .select({ id: feeChallans.id })
    .from(feeChallans)
    .where(
      and(
        eq(feeChallans.locationId, locationId),
        inArray(feeChallans.studentProfileId, studentsInScope(locationId, gradeIds)),
      ),
    );
}

/** The last `count` months ending with the current one, oldest first. */
function recentMonths(count: number): Array<{ month: string; label: string; start: string; end: string }> {
  const out: Array<{ month: string; label: string; start: string; end: string }> = [];
  const now = new Date();

  for (let back = count - 1; back >= 0; back -= 1) {
    const date = new Date(now.getFullYear(), now.getMonth() - back, 1);
    const next = new Date(date.getFullYear(), date.getMonth() + 1, 1);
    const month = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;

    out.push({
      month,
      label: date.toLocaleString('en-GB', { month: 'short' }),
      start: toDateOnly(date),
      end: toDateOnly(next),
    });
  }

  return out;
}

/**
 * Fills a sparse `YYYY-MM -> value` map onto the full month range.
 *
 * A month with no payments must render as a zero, not be missing: an axis that
 * silently skips December makes a closed month look like it never happened,
 * and the line either side of it joins across a gap that is real.
 */
function alignToMonths(
  rows: ReadonlyArray<{ month: string; value: number }>,
  months: ReadonlyArray<{ month: string; label: string }>,
): MonthPoint[] {
  const byMonth = new Map(rows.map((row) => [row.month, row.value]));
  return months.map((entry) => ({
    month: entry.month,
    label: entry.label,
    value: byMonth.get(entry.month) ?? 0,
  }));
}

/* -----------------------------------------------------------------------------
 * Failure isolation.
 * -------------------------------------------------------------------------- */

/**
 * Runs one dashboard read and turns a failure into an absent tile.
 *
 * ── The outage this exists for ───────────────────────────────────────────
 * On 2026-08-22 the whole school-admin dashboard rendered as "Could not load
 * the dashboard" with a digest and nothing else, at a school where every screen
 * behind it worked. The cause was one query: `getAccountingOverview` counting
 * `ledger_transactions`, a table migration `0027` creates and which had never
 * been applied to that database. `Promise.all` rejects on the first rejection,
 * so one missing table for one tile took the students count, the staff count,
 * three charts and every quick action with it.
 *
 * A dashboard is the screen its reader forms their impression of the product
 * from, and it is assembled from a dozen independent reads that have nothing to
 * do with each other. It degrades one tile at a time or it is not a dashboard.
 *
 * It lives here rather than beside one page because Sprint 15 put the same
 * assembly on all five portals, and the version that mattered was the one only
 * the school-admin page had.
 *
 * ── What must *not* be wrapped ───────────────────────────────────────────
 * The reads that decide whether there is a page at all — the caller's profile,
 * the module flags, the permission list, the active academic year. If those
 * fail there is nothing to render and an empty frame would say "your school has
 * nothing in it", which is worse than an error. They still throw.
 *
 * The failure is logged with the location id so it is findable, and the caller
 * falls back to `StatTile`'s `unavailable` state rather than to a zero. A zero
 * is indistinguishable from a real zero and is how a school comes to believe it
 * collected nothing today.
 */
export async function settle<T>(
  label: string,
  locationId: string,
  read: () => Promise<T>,
): Promise<T | null> {
  try {
    return await read();
  } catch (error) {
    console.error(`[dashboard] ${label} failed for ${locationId}:`, error);
    return null;
  }
}

/* -----------------------------------------------------------------------------
 * Fees.
 * -------------------------------------------------------------------------- */

/** Collections per month, from payments actually received. */
export async function getCollectionTrend(
  locationId: string,
  scope: AggregateScope = EVERY_GRADE,
): Promise<MonthPoint[]> {
  const months = recentMonths(TREND_MONTHS);
  const first = months[0]!.start;

  if (reachesNothing(scope)) return alignToMonths([], months);

  const rows = await db
    .select({
      month: sql<string>`to_char(${feePayments.paymentDate}, 'YYYY-MM')`,
      value: sql<string>`coalesce(sum(${feePayments.amount}), 0)`,
    })
    .from(feePayments)
    .where(
      and(
        eq(feePayments.locationId, locationId),
        gte(feePayments.paymentDate, first),
        scope.gradeIds === null
          ? undefined
          : inArray(feePayments.challanId, challansInScope(locationId, scope.gradeIds)),
      ),
    )
    .groupBy(sql`to_char(${feePayments.paymentDate}, 'YYYY-MM')`);

  return alignToMonths(
    rows.map((row) => ({ month: row.month, value: Number(row.value) })),
    months,
  );
}

export interface FeeStatusSplit {
  collected: number;
  outstanding: number;
  overdue: number;
}

/**
 * The current academic year's billing, split three ways.
 *
 * **Outstanding and overdue do not overlap.** A challan past its due date is
 * counted only as overdue, never in both — a donut whose slices double-count
 * sums to more than the total it claims to divide, which is worse than no
 * chart. The three therefore add up to everything billed this year.
 */
export async function getFeeStatusSplit(
  locationId: string,
  scope: AggregateScope = EVERY_GRADE,
): Promise<FeeStatusSplit | null> {
  const activeYear = await getActiveAcademicYear(locationId);
  if (activeYear === null) return null;
  if (reachesNothing(scope)) return { collected: 0, outstanding: 0, overdue: 0 };

  const today = toDateOnly(new Date());

  const rows = await db
    .select({
      paid: sql<string>`coalesce(sum(${feeChallans.paidAmount}), 0)`,
      overdue: sql<string>`coalesce(sum(case when ${feeChallans.dueDate} < ${today} then ${feeChallans.totalAmount} - ${feeChallans.paidAmount} else 0 end), 0)`,
      outstanding: sql<string>`coalesce(sum(case when ${feeChallans.dueDate} >= ${today} then ${feeChallans.totalAmount} - ${feeChallans.paidAmount} else 0 end), 0)`,
    })
    .from(feeChallans)
    .where(
      and(
        eq(feeChallans.locationId, locationId),
        eq(feeChallans.academicYearId, activeYear.id),
        // Cancelled and waived challans are not money anybody expects, so they
        // are excluded rather than shown as permanently outstanding.
        inArray(feeChallans.status, ['unpaid', 'partial', 'paid']),
        scope.gradeIds === null
          ? undefined
          : inArray(
              feeChallans.studentProfileId,
              studentsInScope(locationId, scope.gradeIds),
            ),
      ),
    );

  const row = rows[0];
  if (row === undefined) return null;

  return {
    collected: Number(row.paid),
    outstanding: Number(row.outstanding),
    overdue: Number(row.overdue),
  };
}

export interface AgingBucket {
  label: string;
  value: number;
}

/**
 * Outstanding balance by how long it has been overdue.
 *
 * The buckets are the ones a bursar chases in: not yet due, then in months.
 * `90+` is deliberately open-ended — past a quarter the exact age stops
 * changing what anybody does about it.
 */
export async function getAgingBuckets(
  locationId: string,
  scope: AggregateScope = EVERY_GRADE,
): Promise<AgingBucket[]> {
  const today = toDateOnly(new Date());

  if (reachesNothing(scope)) return [];

  const rows = await db
    .select({
      notYetDue: sql<string>`coalesce(sum(case when ${feeChallans.dueDate} >= ${today} then ${feeChallans.totalAmount} - ${feeChallans.paidAmount} else 0 end), 0)`,
      upTo30: sql<string>`coalesce(sum(case when ${feeChallans.dueDate} < ${today} and ${feeChallans.dueDate} >= ${today}::date - 30 then ${feeChallans.totalAmount} - ${feeChallans.paidAmount} else 0 end), 0)`,
      upTo60: sql<string>`coalesce(sum(case when ${feeChallans.dueDate} < ${today}::date - 30 and ${feeChallans.dueDate} >= ${today}::date - 60 then ${feeChallans.totalAmount} - ${feeChallans.paidAmount} else 0 end), 0)`,
      upTo90: sql<string>`coalesce(sum(case when ${feeChallans.dueDate} < ${today}::date - 60 and ${feeChallans.dueDate} >= ${today}::date - 90 then ${feeChallans.totalAmount} - ${feeChallans.paidAmount} else 0 end), 0)`,
      beyond90: sql<string>`coalesce(sum(case when ${feeChallans.dueDate} < ${today}::date - 90 then ${feeChallans.totalAmount} - ${feeChallans.paidAmount} else 0 end), 0)`,
    })
    .from(feeChallans)
    .where(
      and(
        eq(feeChallans.locationId, locationId),
        inArray(feeChallans.status, ['unpaid', 'partial']),
        scope.gradeIds === null
          ? undefined
          : inArray(
              feeChallans.studentProfileId,
              studentsInScope(locationId, scope.gradeIds),
            ),
      ),
    );

  const row = rows[0];
  if (row === undefined) return [];

  return [
    { label: 'Not due', value: Number(row.notYetDue) },
    { label: '1–30d', value: Number(row.upTo30) },
    { label: '31–60d', value: Number(row.upTo60) },
    { label: '61–90d', value: Number(row.upTo90) },
    { label: '90d+', value: Number(row.beyond90) },
  ];
}

/* -----------------------------------------------------------------------------
 * Attendance.
 * -------------------------------------------------------------------------- */

/**
 * How attendance rate is defined here, once, so every chart agrees.
 *
 * Attended = present + late. A late student was there.
 * Considered = present + absent + late + excused.
 *
 * **`holiday` is excluded from both.** It is not a day anybody failed to
 * attend, and counting it as an absence would drop every school's rate every
 * time a term break is marked — which would make the chart's worst-looking
 * months the ones where nothing happened at all.
 */
const ATTENDED = sql`count(*) filter (where ${attendanceRecords.status} in ('present', 'late'))`;
const CONSIDERED = sql`count(*) filter (where ${attendanceRecords.status} <> 'holiday')`;

/** Attendance rate per month, as a percentage. `null` where nothing was marked. */
export async function getAttendanceTrend(
  locationId: string,
  scope: AggregateScope = EVERY_GRADE,
): Promise<Array<MonthPoint & { value: number }>> {
  const months = recentMonths(TREND_MONTHS);
  const first = months[0]!.start;

  if (reachesNothing(scope)) return alignToMonths([], months);

  const rows = await db
    .select({
      month: sql<string>`to_char(${attendanceRecords.date}, 'YYYY-MM')`,
      // Guarded against a month of nothing but holidays, which would divide by
      // zero rather than simply having no rate.
      value: sql<string>`case when ${CONSIDERED} = 0 then 0 else round(100.0 * ${ATTENDED} / ${CONSIDERED}, 1) end`,
    })
    .from(attendanceRecords)
    .where(
      and(
        eq(attendanceRecords.locationId, locationId),
        gte(attendanceRecords.date, first),
        scope.gradeIds === null
          ? undefined
          : inArray(
              attendanceRecords.studentProfileId,
              studentsInScope(locationId, scope.gradeIds),
            ),
      ),
    )
    .groupBy(sql`to_char(${attendanceRecords.date}, 'YYYY-MM')`);

  return alignToMonths(
    rows.map((row) => ({ month: row.month, value: Number(row.value) })),
    months,
  );
}

/** Attendance rate per class for the last 30 days. */
export async function getAttendanceByClass(
  locationId: string,
  scope: AggregateScope = EVERY_GRADE,
): Promise<NamedCount[]> {
  const since = toDateOnly(new Date(Date.now() - 30 * 24 * 60 * 60 * 1000));

  if (reachesNothing(scope)) return [];

  const rows = await db
    .select({
      grade: grades.name,
      section: sections.name,
      value: sql<string>`case when ${CONSIDERED} = 0 then 0 else round(100.0 * ${ATTENDED} / ${CONSIDERED}, 1) end`,
    })
    .from(attendanceRecords)
    .innerJoin(
      studentEnrollments,
      and(
        eq(studentEnrollments.id, attendanceRecords.enrollmentId),
        // The join is tenant-filtered too. A join predicate that omits it is
        // how a scoped query stops being scoped.
        eq(studentEnrollments.locationId, locationId),
      ),
    )
    .innerJoin(
      sections,
      and(eq(sections.id, studentEnrollments.sectionId), eq(sections.locationId, locationId)),
    )
    .innerJoin(
      grades,
      and(eq(grades.id, sections.gradeId), eq(grades.locationId, locationId)),
    )
    .where(
      and(
        eq(attendanceRecords.locationId, locationId),
        gte(attendanceRecords.date, since),
        scope.gradeIds === null ? undefined : inArray(sections.gradeId, scope.gradeIds),
      ),
    )
    .groupBy(grades.name, sections.name, grades.sortOrder)
    .orderBy(grades.sortOrder, sections.name);

  return rows.map((row) => ({
    label: `${row.grade} ${row.section}`,
    value: Number(row.value),
  }));
}

/* -----------------------------------------------------------------------------
 * Enrolment.
 * -------------------------------------------------------------------------- */

/** Active students per class in the active year. */
export async function getClassStrength(
  locationId: string,
  scope: AggregateScope = EVERY_GRADE,
): Promise<NamedCount[]> {
  const activeYear = await getActiveAcademicYear(locationId);
  if (activeYear === null) return [];
  if (reachesNothing(scope)) return [];

  const rows = await db
    .select({
      grade: grades.name,
      section: sections.name,
      value: sql<number>`count(*)`.mapWith(Number),
    })
    .from(studentEnrollments)
    .innerJoin(
      sections,
      and(eq(sections.id, studentEnrollments.sectionId), eq(sections.locationId, locationId)),
    )
    .innerJoin(
      grades,
      and(eq(grades.id, sections.gradeId), eq(grades.locationId, locationId)),
    )
    .where(
      and(
        eq(studentEnrollments.locationId, locationId),
        eq(studentEnrollments.academicYearId, activeYear.id),
        eq(studentEnrollments.status, 'active'),
        scope.gradeIds === null ? undefined : inArray(sections.gradeId, scope.gradeIds),
      ),
    )
    .groupBy(grades.name, sections.name, grades.sortOrder)
    .orderBy(grades.sortOrder, sections.name);

  return rows.map((row) => ({ label: `${row.grade} ${row.section}`, value: row.value }));
}

/** Admission applications by status — the funnel, in the order it is walked. */
export async function getAdmissionsFunnel(
  locationId: string,
  scope: AggregateScope = EVERY_GRADE,
): Promise<NamedCount[]> {
  const rows = reachesNothing(scope)
    ? []
    : await db
        .select({
          status: admissionApplications.status,
          value: sql<number>`count(*)`.mapWith(Number),
        })
        .from(admissionApplications)
        .where(
          and(
            eq(admissionApplications.locationId, locationId),
            // A grade-less application is admitted by every scope, exactly as
            // `scopeAdmitsGrade` admits a grade-less record: an applicant who
            // has not named a class yet belongs to the school, and hiding them
            // from every head is how an admission goes unactioned.
            scope.gradeIds === null
              ? undefined
              : or(
                  isNull(admissionApplications.gradeId),
                  inArray(admissionApplications.gradeId, scope.gradeIds),
                ),
          ),
        )
        .groupBy(admissionApplications.status);

  const byStatus = new Map(rows.map((row) => [row.status, row.value]));

  // Fixed order, and zeroes kept: a funnel with a missing stage reads as a
  // stage that does not exist rather than one nobody has reached. Labels come
  // from the schema so this cannot drift from what the applications screen
  // calls the same status.
  return APPLICATION_STATUSES.map((status) => ({
    label: APPLICATION_STATUS_LABELS[status],
    value: byStatus.get(status) ?? 0,
  }));
}

/* -----------------------------------------------------------------------------
 * Exams.
 *
 * ── Why these are not shaped like the other aggregates ───────────────────
 * The seven above are answered by Postgres and read once. These cannot be: a
 * grade band is *the school's*, resolved through `lib/grading.ts` against the
 * scheme the term names, so two schools with identical marks must produce
 * different distributions. Bucketing by fixed percentages in SQL would be
 * faster and would contradict the report card printed from the same marks,
 * which is the one thing a chart beside it must never do.
 *
 * So the marks are fetched scoped and narrow — one section's published papers —
 * and folded here, through the same `resolveBand` the report card calls and the
 * same `resultPicker` that decides which sitting counts. The volume is a class:
 * a few hundred rows for one exam, a couple of thousand for the overview's most
 * recent few.
 *
 * ── Absence ──────────────────────────────────────────────────────────────
 * An absent student is in no grade band and in no pass-rate denominator, the
 * same way `holiday` is in neither side of the attendance rate. They sat
 * nothing to be graded on, and folding them in as a zero would report a school
 * as failing children who were at home with flu. They are *counted* and
 * returned separately, so every chart can say who it left out rather than
 * quietly showing a smaller class.
 *
 * ── Only published papers ────────────────────────────────────────────────
 * The tabulation sheet deliberately shows unpublished marks, flagged, because
 * reviewing them is its purpose. A chart cannot flag a bar. These read what the
 * report card reads, and the pages say how many papers that leaves out.
 * -------------------------------------------------------------------------- */

/** A paper as the fold needs it: its marks, its pass mark, and which sitting counts. */
export interface FoldablePaper extends CountingPaper {
  maxMarks: number;
  passingMarks: number;
}

/** A result row as the fold needs it. */
export interface FoldableResult {
  examSubjectId: string;
  studentProfileId: string;
  attempt: number;
  marksObtained: string | null;
  isAbsent: boolean;
}

/**
 * Every mark on a set of papers, tenant-scoped.
 *
 * Its own function so both aggregates issue the same read, and so
 * `scripts/check-dashboard-queries.ts` can execute it against the real schema —
 * both callers guard on an empty paper list, which is correct (an `in ()` is a
 * round trip that can only return nothing) and would otherwise mean the one
 * query that touches `exam_results` was the one the check never ran.
 */
export async function readExamMarks(
  locationId: string,
  paperIds: readonly string[],
): Promise<FoldableResult[]> {
  if (paperIds.length === 0) return [];

  return db
    .select({
      examSubjectId: examResults.examSubjectId,
      studentProfileId: examResults.studentProfileId,
      attempt: examResults.attempt,
      marksObtained: examResults.marksObtained,
      isAbsent: examResults.isAbsent,
    })
    .from(examResults)
    .where(
      and(
        eq(examResults.locationId, locationId),
        inArray(examResults.examSubjectId, [...paperIds]),
      ),
    );
}

export interface StudentTotals {
  /** Students with a mark on every published paper — the only ones graded. */
  graded: number;
  /** Excluded: absent from at least one paper. */
  absent: number;
  /** Excluded: a published paper with no mark entered for them. */
  unmarked: number;
  /** Of `graded`, those who reached the pass mark on every paper. */
  passed: number;
  /** One overall percentage per graded student, in no particular order. */
  percentages: number[];
}

/**
 * Folds one exam's marks into per-student totals.
 *
 * The students considered are those with at least one result row: a child
 * enrolled after the exam has no row anywhere and is not a failure, they are
 * absent from the data. Marks available is the sum over every published paper,
 * never over the papers a particular student happened to sit — a denominator
 * that shrank itself would let missing your weakest paper improve your
 * percentage, which is the rule `lib/exam-queries.ts` already states.
 */
export function foldStudentTotals(
  papers: readonly FoldablePaper[],
  results: readonly FoldableResult[],
): StudentTotals {
  const pick = resultPicker(results);
  const students = new Set(results.map((row) => row.studentProfileId));
  const available = papers.reduce((sum, paper) => sum + paper.maxMarks, 0);

  const totals: StudentTotals = {
    graded: 0,
    absent: 0,
    unmarked: 0,
    passed: 0,
    percentages: [],
  };

  for (const studentProfileId of students) {
    let obtained = 0;
    let failed = 0;
    let absent = false;
    let unmarked = false;

    for (const paper of papers) {
      const row = pick(paper, studentProfileId);
      const marks = toMark(row?.marksObtained);

      if (row?.isAbsent === true) {
        absent = true;
      } else if (marks === null) {
        // No row at all, or one the marks screen has not filled in yet.
        unmarked = true;
      } else {
        obtained += marks;
        if (marks < paper.passingMarks) failed += 1;
      }
    }

    // Absence is reported first: a child who missed a paper is a different
    // story from one whose teacher has not typed the marks in, and a school
    // asked "who is not in this chart" wants the first answer.
    if (absent) {
      totals.absent += 1;
    } else if (unmarked || available <= 0) {
      totals.unmarked += 1;
    } else {
      totals.graded += 1;
      totals.percentages.push(percentageOf(obtained, available));
      if (failed === 0) totals.passed += 1;
    }
  }

  return totals;
}

/** The mean of a set of percentages, to one decimal. Null when the set is empty. */
function meanPercentage(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  return Math.round((10 * values.reduce((sum, value) => sum + value, 0)) / values.length) / 10;
}

/** Counts per band, highest band first, zeroes kept. */
export function distribute(
  percentages: readonly number[],
  // `ResolvedBand`, not the row type: this needs a label and a minimum, and
  // nothing about where the band was stored.
  bands: readonly ResolvedBand[],
): { distribution: NamedCount[]; ungraded: number } {
  const counts = new Map<string, number>(bands.map((band) => [band.label, 0]));
  let ungraded = 0;

  for (const percentage of percentages) {
    const band = resolveBand(percentage, bands);
    if (band === null) {
      // Below every band the school defined. The report card prints a dash
      // here rather than inventing an F, so the chart does not invent one
      // either — it says how many, beside the chart, in the school's own words.
      ungraded += 1;
      continue;
    }
    counts.set(band.label, (counts.get(band.label) ?? 0) + 1);
  }

  // `bandsForTerm` returns them highest first, and empty bands stay in: a band
  // nobody reached is a fact about the exam, and dropping it would redraw the
  // axis every time a cohort happened to miss one.
  return {
    distribution: bands.map((band) => ({ label: band.label, value: counts.get(band.label) ?? 0 })),
    ungraded,
  };
}

/** Average of one paper's percentages, and how many passed it. */
export interface SubjectAverage {
  label: string;
  /** Mean percentage of the students who sat it. */
  value: number;
  /** Students with a mark — absentees are in neither this nor the average. */
  sat: number;
  passed: number;
}

export interface ExamPerformance {
  title: string;
  className: string;
  termName: string;
  /** Papers whose marks are published, of every paper scheduled. */
  publishedPapers: number;
  totalPapers: number;
  /** Counts per grade band, highest first. Empty when the school grades in no scheme. */
  distribution: NamedCount[];
  /** Graded students below every band the school defined. */
  ungraded: number;
  subjects: SubjectAverage[];
  graded: number;
  absent: number;
  unmarked: number;
  passed: number;
  /** `passed / graded` as a percentage. Null when nobody is graded yet. */
  passRate: number | null;
  /** Mean overall percentage across graded students. Null when there are none. */
  average: number | null;
}

/**
 * One exam, charted: grade distribution, subject averages and pass rate.
 *
 * "Passed" is passing *every* published paper, which is what a school means by
 * it and what the tabulation sheet's failed-paper count already implies. A rate
 * built from per-paper passes would be a different and much kinder number
 * wearing the same label.
 */
export async function getExamPerformance(
  locationId: string,
  examId: string,
): Promise<ExamPerformance | null> {
  const exam = await getExamDetail(locationId, examId);
  if (exam === null) return null;

  const published = exam.papers.filter((paper) => paper.resultsStatus === 'published');

  const empty: ExamPerformance = {
    title: exam.title,
    className: `${exam.gradeName} — ${exam.sectionName}`,
    termName: exam.termName,
    publishedPapers: published.length,
    totalPapers: exam.papers.length,
    distribution: [],
    ungraded: 0,
    subjects: [],
    graded: 0,
    absent: 0,
    unmarked: 0,
    passed: 0,
    passRate: null,
    average: null,
  };

  if (published.length === 0) return empty;

  const [bands, results] = await Promise.all([
    bandsForTerm(locationId, exam.termId),
    readExamMarks(
      locationId,
      published.map((paper) => paper.id),
    ),
  ]);

  const totals = foldStudentTotals(published, results);
  const { distribution, ungraded } = distribute(totals.percentages, bands);

  const pick = resultPicker(results);
  const students = new Set(results.map((row) => row.studentProfileId));

  const subjects: SubjectAverage[] = published.map((paper) => {
    let sat = 0;
    let passed = 0;
    let sum = 0;

    for (const studentProfileId of students) {
      const row = pick(paper, studentProfileId);
      const marks = toMark(row?.marksObtained);
      // Absent from *this* paper only. A child who missed Physics still belongs
      // in the Mathematics average, so this is decided per paper rather than
      // per student.
      if (row === undefined || row.isAbsent || marks === null) continue;

      sat += 1;
      sum += percentageOf(marks, paper.maxMarks);
      if (marks >= paper.passingMarks) passed += 1;
    }

    return {
      label: paper.subjectName,
      value: sat === 0 ? 0 : Math.round((10 * sum) / sat) / 10,
      sat,
      passed,
    };
  });

  return {
    ...empty,
    distribution,
    ungraded,
    subjects,
    graded: totals.graded,
    absent: totals.absent,
    unmarked: totals.unmarked,
    passed: totals.passed,
    passRate:
      totals.graded === 0 ? null : Math.round((1000 * totals.passed) / totals.graded) / 10,
    average: meanPercentage(totals.percentages),
  };
}

export interface ExamOutcome {
  examId: string;
  title: string;
  className: string;
  examDate: string;
  graded: number;
  absent: number;
  passRate: number | null;
  average: number | null;
}

/** How many exams the overview compares. */
const OUTCOME_EXAMS = 6;

/**
 * The most recent exams that have published marks, each as one pass rate and
 * one average.
 *
 * **No grade distribution here, deliberately.** Each exam is graded against its
 * own term's scheme, and a school that changed schemes between terms would get
 * an "A" column stacking two different meanings of A. Percentages survive that
 * comparison; letters do not.
 */
export async function getRecentExamOutcomes(
  locationId: string,
  limit: number = OUTCOME_EXAMS,
  scope: AggregateScope = EVERY_GRADE,
): Promise<ExamOutcome[]> {
  if (reachesNothing(scope)) return [];

  const examRows = await db
    .select({
      id: exams.id,
      title: exams.title,
      examDate: exams.examDate,
      gradeName: grades.name,
      gradeDisplayName: grades.displayName,
      sectionName: sections.name,
    })
    .from(exams)
    .innerJoin(grades, and(eq(grades.id, exams.gradeId), eq(grades.locationId, locationId)))
    .innerJoin(
      sections,
      and(eq(sections.id, exams.sectionId), eq(sections.locationId, locationId)),
    )
    // Only exams with something published to read. The join is the filter, so
    // an exam still being marked never appears as a school with no results.
    .innerJoin(
      examSubjects,
      and(
        eq(examSubjects.examId, exams.id),
        eq(examSubjects.locationId, locationId),
        eq(examSubjects.resultsStatus, 'published'),
      ),
    )
    .where(
      and(
        eq(exams.locationId, locationId),
        scope.gradeIds === null ? undefined : inArray(exams.gradeId, scope.gradeIds),
      ),
    )
    .groupBy(exams.id, grades.id, sections.id)
    .orderBy(desc(exams.examDate), asc(exams.title))
    .limit(limit);

  if (examRows.length === 0) return [];

  const examIds = examRows.map((row) => row.id);

  const paperRows = await db
    .select({
      id: examSubjects.id,
      examId: examSubjects.examId,
      maxMarks: examSubjects.maxMarks,
      passingMarks: examSubjects.passingMarks,
      resitStatus: examSubjects.resitStatus,
    })
    .from(examSubjects)
    .where(
      and(
        eq(examSubjects.locationId, locationId),
        inArray(examSubjects.examId, examIds),
        eq(examSubjects.resultsStatus, 'published'),
      ),
    );

  const results = await readExamMarks(
    locationId,
    paperRows.map((paper) => paper.id),
  );

  // Oldest first: this is read left to right as a sequence of terms.
  return [...examRows].reverse().map((exam) => {
    const papers: FoldablePaper[] = paperRows
      .filter((paper) => paper.examId === exam.id)
      .map((paper) => ({
        id: paper.id,
        resitStatus: paper.resitStatus,
        maxMarks: toMark(paper.maxMarks) ?? 0,
        passingMarks: toMark(paper.passingMarks) ?? 0,
      }));

    const paperIds = new Set(papers.map((paper) => paper.id));
    const mine = results.filter((row) => paperIds.has(row.examSubjectId));
    const totals = foldStudentTotals(papers, mine);

    return {
      examId: exam.id,
      title: exam.title,
      className: `${gradeLabel({ name: exam.gradeName, displayName: exam.gradeDisplayName })} — ${exam.sectionName}`,
      examDate: exam.examDate,
      graded: totals.graded,
      absent: totals.absent,
      passRate:
        totals.graded === 0 ? null : Math.round((1000 * totals.passed) / totals.graded) / 10,
      average: meanPercentage(totals.percentages),
    };
  });
}

/* -----------------------------------------------------------------------------
 * Today.
 * -------------------------------------------------------------------------- */

export interface TodaySnapshot {
  collectedToday: number;
  attendanceRateToday: number | null;
}

/**
 * The two figures that change during a working day.
 *
 * `attendanceRateToday` is `null` rather than `0` when no register has been
 * taken yet, because at 8am those are opposite statements and a tile reading
 * "0%" first thing every morning trains people to ignore it.
 */
export async function getTodaySnapshot(
  locationId: string,
  scope: AggregateScope = EVERY_GRADE,
): Promise<TodaySnapshot> {
  const today = toDateOnly(new Date());
  const tomorrow = toDateOnly(new Date(Date.now() + 24 * 60 * 60 * 1000));

  if (reachesNothing(scope)) {
    return { collectedToday: 0, attendanceRateToday: null };
  }

  const [collected, attendance] = await Promise.all([
    db
      .select({ value: sql<string>`coalesce(sum(${feePayments.amount}), 0)` })
      .from(feePayments)
      .where(
        and(
          eq(feePayments.locationId, locationId),
          gte(feePayments.paymentDate, today),
          lt(feePayments.paymentDate, tomorrow),
          scope.gradeIds === null
            ? undefined
            : inArray(feePayments.challanId, challansInScope(locationId, scope.gradeIds)),
        ),
      ),
    db
      .select({
        considered: sql<number>`${CONSIDERED}`.mapWith(Number),
        attended: sql<number>`${ATTENDED}`.mapWith(Number),
      })
      .from(attendanceRecords)
      .where(
        and(
          eq(attendanceRecords.locationId, locationId),
          eq(attendanceRecords.date, today),
          scope.gradeIds === null
            ? undefined
            : inArray(
                attendanceRecords.studentProfileId,
                studentsInScope(locationId, scope.gradeIds),
              ),
        ),
      ),
  ]);

  const considered = attendance[0]?.considered ?? 0;
  const attended = attendance[0]?.attended ?? 0;

  return {
    collectedToday: Number(collected[0]?.value ?? '0'),
    attendanceRateToday:
      considered === 0 ? null : Math.round((1000 * attended) / considered) / 10,
  };
}

/* -----------------------------------------------------------------------------
 * Comparisons.
 *
 * Every headline tile on the school-admin dashboard carries one. A KPI without
 * a benchmark is a number, not an indicator: "PKR 812,000 collected" is a fact
 * nobody can act on, and "PKR 812,000, 14% behind this point last month" is a
 * morning's work. Four of the five tiles on the old screen had none.
 *
 * The comparisons are all *like for like in the period elapsed*. Comparing a
 * month that is nine days old against a whole month reports every school as
 * collapsing until the 28th, which is the one way to make a comparison worse
 * than no comparison at all.
 * -------------------------------------------------------------------------- */

/** Two figures and the same number of days of each month behind them. */
export interface MonthComparison {
  thisMonth: number;
  /** Last month, cut at the same day of the month. */
  lastMonthToDate: number;
}

/**
 * Collections so far this month, against the same point last month.
 *
 * The cut is the day of the month, clamped to the length of the shorter month —
 * so the 31st of March compares against the whole of February rather than
 * against a date that does not exist.
 */
export async function getCollectionComparison(
  locationId: string,
  scope: AggregateScope = EVERY_GRADE,
  now: Date = new Date(),
): Promise<MonthComparison> {
  if (reachesNothing(scope)) return { thisMonth: 0, lastMonthToDate: 0 };

  const year = now.getFullYear();
  const month = now.getMonth();
  const day = now.getDate();

  const thisStart = new Date(year, month, 1);
  const lastStart = new Date(year, month - 1, 1);
  const lastMonthLength = new Date(year, month, 0).getDate();
  const lastCut = new Date(year, month - 1, Math.min(day, lastMonthLength));

  const narrow =
    scope.gradeIds === null
      ? undefined
      : inArray(feePayments.challanId, challansInScope(locationId, scope.gradeIds));

  const sumBetween = async (from: Date, to: Date): Promise<number> => {
    const rows = await db
      .select({ value: sql<string>`coalesce(sum(${feePayments.amount}), 0)` })
      .from(feePayments)
      .where(
        and(
          eq(feePayments.locationId, locationId),
          gte(feePayments.paymentDate, toDateOnly(from)),
          lte(feePayments.paymentDate, toDateOnly(to)),
          narrow,
        ),
      );

    return Number(rows[0]?.value ?? '0');
  };

  const [thisMonth, lastMonthToDate] = await Promise.all([
    sumBetween(thisStart, now),
    sumBetween(lastStart, lastCut),
  ]);

  return { thisMonth, lastMonthToDate };
}

/** What is still owed, and how many families are behind on it. */
export interface OutstandingSummary {
  /** PKR still owed on challans billed for the current calendar month. */
  outstandingThisMonth: number;
  /** Challans past their due date and not settled — of any month. */
  overdueCount: number;
  /** Distinct students behind on at least one challan. */
  defaulterCount: number;
}

/**
 * The outstanding tile, scoped.
 *
 * `getFeeOverview` answers the same first two figures and is what the fee
 * module's own screens use, but it takes no scope and never will — it is the
 * bursar's view of the whole school. A principal's dashboard must not print the
 * school's arrears under a heading that says "yours", so the dashboard has its
 * own read. The definitions are deliberately identical to `getFeeOverview`'s so
 * an unscoped head teacher sees the same number on both screens.
 */
export async function getOutstandingSummary(
  locationId: string,
  scope: AggregateScope = EVERY_GRADE,
  now: Date = new Date(),
): Promise<OutstandingSummary> {
  if (reachesNothing(scope)) {
    return { outstandingThisMonth: 0, overdueCount: 0, defaulterCount: 0 };
  }

  const today = toDateOnly(now);
  const narrow =
    scope.gradeIds === null
      ? undefined
      : inArray(feeChallans.studentProfileId, studentsInScope(locationId, scope.gradeIds));

  const rows = await db
    .select({
      outstanding: sql<string>`coalesce(sum(${feeChallans.totalAmount} - ${feeChallans.paidAmount}) filter (where ${feeChallans.billingMonth} = ${now.getMonth() + 1} and ${feeChallans.billingYear} = ${now.getFullYear()}), 0)`,
      overdue: sql<number>`count(*) filter (where ${feeChallans.dueDate} < ${today})`.mapWith(
        Number,
      ),
      defaulters:
        sql<number>`count(distinct ${feeChallans.studentProfileId}) filter (where ${feeChallans.dueDate} < ${today})`.mapWith(
          Number,
        ),
    })
    .from(feeChallans)
    .where(
      and(
        eq(feeChallans.locationId, locationId),
        inArray(feeChallans.status, ['unpaid', 'partial']),
        narrow,
      ),
    );

  const row = rows[0];

  return {
    outstandingThisMonth: Number(row?.outstanding ?? '0'),
    overdueCount: row?.overdue ?? 0,
    defaulterCount: row?.defaulters ?? 0,
  };
}

/**
 * The average attendance rate over the last `days` days.
 *
 * `null` when nothing was marked in the window — the same distinction
 * `getTodaySnapshot` makes, for the same reason: a school on holiday and a
 * school where the register is broken are not the same fact, and averaging them
 * both to zero says the second.
 */
export async function getAttendanceAverage(
  locationId: string,
  scope: AggregateScope = EVERY_GRADE,
  days = 30,
): Promise<number | null> {
  if (reachesNothing(scope)) return null;

  const since = toDateOnly(new Date(Date.now() - days * 24 * 60 * 60 * 1000));

  const rows = await db
    .select({
      considered: sql<number>`${CONSIDERED}`.mapWith(Number),
      attended: sql<number>`${ATTENDED}`.mapWith(Number),
    })
    .from(attendanceRecords)
    .where(
      and(
        eq(attendanceRecords.locationId, locationId),
        gte(attendanceRecords.date, since),
        scope.gradeIds === null
          ? undefined
          : inArray(
              attendanceRecords.studentProfileId,
              studentsInScope(locationId, scope.gradeIds),
            ),
      ),
    );

  const considered = rows[0]?.considered ?? 0;
  if (considered === 0) return null;

  return Math.round((1000 * (rows[0]?.attended ?? 0)) / considered) / 10;
}

/** Enrolment now, against how many were on the roll when the year opened. */
export interface EnrolmentComparison {
  now: number;
  atYearStart: number;
  activeYearName: string | null;
}

/**
 * How the roll has moved since the academic year opened.
 *
 * "At year start" is enrolments dated on or before the first day of the year,
 * counted from `enrollment_date` rather than `created_at` — a school entering
 * its existing roll in September records the date the child actually joined,
 * and `created_at` would report every one of them as a new admission on the day
 * the office typed them in.
 */
export async function getEnrolmentComparison(
  locationId: string,
  scope: AggregateScope = EVERY_GRADE,
): Promise<EnrolmentComparison> {
  const activeYear = await getActiveAcademicYear(locationId);
  if (activeYear === null) return { now: 0, atYearStart: 0, activeYearName: null };
  if (reachesNothing(scope)) {
    return { now: 0, atYearStart: 0, activeYearName: activeYear.name };
  }

  const bounds = academicYearBounds(activeYear);

  const rows = await db
    .select({
      now: sql<number>`count(*)`.mapWith(Number),
      atStart:
        sql<number>`count(*) filter (where ${studentEnrollments.enrollmentDate} <= ${bounds.start})`.mapWith(
          Number,
        ),
    })
    .from(studentEnrollments)
    .innerJoin(
      sections,
      and(eq(sections.id, studentEnrollments.sectionId), eq(sections.locationId, locationId)),
    )
    .where(
      and(
        eq(studentEnrollments.locationId, locationId),
        eq(studentEnrollments.academicYearId, activeYear.id),
        eq(studentEnrollments.status, 'active'),
        scope.gradeIds === null ? undefined : inArray(sections.gradeId, scope.gradeIds),
      ),
    );

  return {
    now: rows[0]?.now ?? 0,
    atYearStart: rows[0]?.atStart ?? 0,
    activeYearName: activeYear.name,
  };
}

/* -----------------------------------------------------------------------------
 * Setup progress.
 * -------------------------------------------------------------------------- */

/**
 * One measured area of a school's setup.
 *
 * ── Why `done`/`total` and not a boolean (Sprint 17) ─────────────────────
 * The panel used to answer six yes/no questions, and three of them were
 * effectively unanswerable that way. "Classes: 22" told a school it had
 * finished creating classes while nine of its fourteen grades had no section;
 * "Timetable: 40" said the same about a week that covered a third of the
 * school. A tick against a partly done job is worse than no tick, because it
 * stops anybody looking.
 *
 * So every KPI now carries the two numbers it is really made of, and
 * `complete` is derived from them rather than asserted.
 */
export interface SetupStep {
  /**
   * Stable within a run, and *not* a closed union any more: the fee-head KPIs
   * are one per `fee_types` row and are keyed `fee:<uuid>`. A component
   * switching on this key would break the moment a school added a fee head,
   * which is why nothing does — `group` is what the card lays out by.
   */
  key: string;
  label: string;
  /** Which heading this KPI sits under on the card. */
  group: 'school' | 'fees';
  /** How many of this thing exist. The headcount the requirement asks for. */
  count: number;
  /** How many of `total` are in place. */
  done: number;
  /** What the whole of this KPI would be. Never zero — see `percentOfStep`. */
  total: number;
  /** `round(100 * done / total)`, always 0..100. */
  percent: number;
  /** True exactly when `percent === 100`. Kept so callers never recompute it. */
  complete: boolean;
  /** What to do about it while it is short. Null once it is complete. */
  href: string | null;
  /** One line saying why it matters, shown while it is outstanding. */
  hint: string;
}

export interface SetupProgress {
  steps: SetupStep[];
  /** How many steps are at 100%. Drives the "4 of 11" line. */
  completed: number;
  total: number;
  /**
   * The **unweighted mean of every step's own percentage**, rounded.
   *
   * Deliberately not `completed / total`: that is what it used to be, and it
   * reported a school with eleven KPIs at 90% as 0% complete. A mean of the
   * parts is the only headline that moves when the work moves.
   */
  percent: number;
}

/**
 * One KPI's arithmetic, in the one place that can divide by zero.
 *
 * `total` of 0 is a real state — a school with no grades, no sections, no fee
 * heads — and every one of them must read 0%, not NaN%. The caller passes the
 * floor it wants (always 1) rather than this guessing, because "0 grades" and
 * "0 of 1" are different sentences and only the caller knows which it means.
 */
function stepPercent(done: number, total: number): number {
  if (total <= 0) return 0;
  return Math.round((100 * Math.min(done, total)) / total);
}

/**
 * How far a school is from being usable, as a set of KPIs and a bar.
 *
 * ── Setup progress is school-wide and is never narrowed (Sprint 17) ──────
 * This function used to take an `AggregateScope` and the dashboard used to pass
 * the principal's. That was wrong, and it was wrong in a way a principal could
 * see and nobody could explain: Lahore Grammar School runs
 * `principal_model = 'multiple'` and has **no `principal_assignments` rows at
 * all**, so `resolvePrincipalScope` returned `unassigned` and the dashboard
 * turned that into `gradeIds: []`. Three of the six steps — Classes, Timetable,
 * Enrolled students — are the grade-scoped ones and short-circuited to zero.
 * Three of six is 50%, to the digit, against the administrator's 100%.
 *
 * Whether the school has created its classes, priced its fees or enrolled
 * anybody is a **fact about the school**, not about one head's division. A
 * principal assigned the O-Levels must not be told the school is half built
 * because the junior school belongs to somebody else. So this counts the whole
 * tenant, always. Every *other* aggregate on that dashboard keeps its scope;
 * this is the one function that drops it.
 *
 * The empty-scope warning a head genuinely needs is a different thing and is
 * rendered separately — `describeScope` already writes the sentence, and the
 * dashboard shows it as a warning callout rather than as grey helper text.
 * `resolvePrincipalScope` is **not** relaxed: "no assignment" must never
 * resolve to "no filter", and STATE.md is right about that.
 *
 * ── Every KPI is a fraction, not a tick (Sprint 17) ──────────────────────
 * "Is there at least one" was the old rule and it flattered every school that
 * had started a job and stopped. Classes now counts *grades that have a
 * section* out of all grades; the timetable counts *sections with an entry* out
 * of all sections; and the fee structure gets **one KPI per fee head**, priced
 * grades over total grades. LGS reads Tuition 100%, Admission 100%, Annual
 * 100%, Library 100% and Examination **0%** — which is that school's real
 * state and was invisible on the old panel.
 *
 * Teachers, Subjects and Enrolled students stay 1-of-1 on `> 0`, because there
 * is no denominator for them that this code would not have invented. A
 * threshold of "at least five teachers" is a number every school it did not fit
 * would be told off by.
 *
 * ── An amount of 0 is complete; a missing row is not ─────────────────────
 * Verbatim from the requirement: *if a fee does not need to be charged, then
 * the user to mark it as 0. Leaving it empty would mean that the KPI has not
 * been completed.* `fee_structures.amount` is NOT NULL with a `>= 0` check, so
 * this is simply the existence of the row — the fee-head query counts rows and
 * must never filter on `amount > 0`.
 *
 * ── Why a principal is counted from `school_users`, not `schools` ────────
 * `schools.principal_name` is a text field on the school profile — it is the
 * name printed on a report card, and a school can fill it in without anybody
 * being able to sign in. This KPI asks whether a *person* exists.
 *
 * At a `multiple` school it asks something sharper: how many **branches have a
 * current assignment**. That is the number LGS needed and never saw — one
 * branch, zero assignments, and a principal signing in to an empty school with
 * nothing on the panel to say why.
 *
 * ── One round trip each, in parallel ─────────────────────────────────────
 * They touch unrelated tables, so a single query would be sequential scans
 * behind one plan. Joining them would be worse still: a join multiplies rows
 * before counting, which is the classic way this kind of tile comes out wrong —
 * six sections and four subjects reporting twenty-four of each.
 */
export async function getSetupProgress(locationId: string): Promise<SetupProgress> {
  const activeYear = await getActiveAcademicYear(locationId);

  const [
    principalKpi,
    staffRecords,
    unlinkedTeachers,
    gradeTotals,
    subjectCount,
    timetableTotals,
    students,
    feeHeadKpis,
  ] = await Promise.all([
    resolvePrincipalKpi(locationId),
    /*
     * Teaching staff, counted from **both** places a school can enter one.
     *
     * ── Why not just one of them ─────────────────────────────────────────
     * QA on 2026-08-26 caught this the only way it could be caught: against a
     * real school. Lahore Grammar School has an active `staff` record for a
     * class teacher and **zero** `school_users` rows with the role `teacher` —
     * the person is on the HR register and has never been invited to the
     * portal. Counting accounts alone reported "Teachers 0" to a school that
     * had entered one, which is the single most misleading thing a setup
     * checklist can do: it tells you to redo work you have already done.
     *
     * Counting `staff` alone is wrong in the other direction — the register
     * holds the accountant and the caretaker too — but it is the *smaller*
     * error here, because a school that has entered any staff at all has
     * started this step. And the inverse case is real as well: a school that
     * invites teachers to the portal before HR records exist.
     *
     * So: every active staff record, plus every active teacher account that
     * has no staff record behind it. The `is null` join is what stops the one
     * person who is both from being counted twice, which is why this is two
     * counts and not two independent ones added together carelessly.
     */
    countRows(
      db
        .select({ value: sql<number>`count(*)`.mapWith(Number) })
        .from(staff)
        .where(and(eq(staff.locationId, locationId), eq(staff.status, 'active'))),
    ),
    countRows(
      db
        .select({ value: sql<number>`count(*)`.mapWith(Number) })
        .from(schoolUsers)
        .leftJoin(
          staff,
          and(
            eq(staff.schoolUserId, schoolUsers.id),
            eq(staff.locationId, locationId),
            eq(staff.status, 'active'),
          ),
        )
        .where(
          and(
            eq(schoolUsers.locationId, locationId),
            eq(schoolUsers.isActive, true),
            eq(schoolUsers.role, 'teacher'),
            isNull(staff.id),
          ),
        ),
    ),
    /*
     * Classes: grades that have at least one active section, over all grades.
     *
     * Counting sections alone — which is what this did until Sprint 17 — says
     * "22 classes" to a school where nine of fourteen grades have none, and
     * ticks the step. The denominator is what makes the number actionable:
     * 5/14 sends somebody to the grades screen, "22" sends nobody anywhere.
     */
    gradeSectionCoverage(locationId),
    countRows(
      db
        .select({ value: sql<number>`count(*)`.mapWith(Number) })
        .from(subjects)
        .where(and(eq(subjects.locationId, locationId), eq(subjects.isActive, true))),
    ),
    // Timetable: sections with at least one active entry, over all active
    // sections. Same argument as Classes — a week that covers a third of the
    // school is not a timetable, and "40 entries" cannot say which third.
    timetableCoverage(locationId),
    activeYear === null
      ? Promise.resolve(0)
      : countRows(
          db
            .select({ value: sql<number>`count(*)`.mapWith(Number) })
            .from(studentEnrollments)
            .where(
              and(
                eq(studentEnrollments.locationId, locationId),
                eq(studentEnrollments.academicYearId, activeYear.id),
                eq(studentEnrollments.status, 'active'),
              ),
            ),
        ),
    feeStructureCoverage(locationId, activeYear?.id ?? null),
  ]);

  const teachers = staffRecords + unlinkedTeachers;

  const steps: SetupStep[] = [
    {
      key: 'principal',
      label: principalKpi.label,
      group: 'school',
      count: principalKpi.done,
      done: principalKpi.done,
      total: principalKpi.total,
      percent: stepPercent(principalKpi.done, principalKpi.total),
      complete: stepPercent(principalKpi.done, principalKpi.total) === 100,
      href: principalKpi.href,
      hint: principalKpi.hint,
    },
    simpleStep({
      key: 'teachers',
      label: 'Teachers & staff',
      count: teachers,
      href: '/dashboard/hr/staff',
      hint: 'Add teaching staff. Nothing can be timetabled without them.',
    }),
    {
      key: 'classes',
      label: 'Classes',
      group: 'school',
      count: gradeTotals.done,
      done: gradeTotals.done,
      // A school with no grades at all reads 0 of 1 rather than 0 of 0: the
      // work is outstanding, and a KPI that divides by zero would report it as
      // complete.
      total: Math.max(gradeTotals.total, 1),
      percent: stepPercent(gradeTotals.done, Math.max(gradeTotals.total, 1)),
      complete: gradeTotals.total > 0 && gradeTotals.done >= gradeTotals.total,
      href: '/dashboard/admissions/grades',
      hint: 'Create your grades and give each one at least one section.',
    },
    simpleStep({
      key: 'subjects',
      label: 'Subjects',
      count: subjectCount,
      href: '/dashboard/academics/subjects',
      hint: 'Name what is taught. The timetable and exams both read this.',
    }),
    {
      key: 'timetable',
      label: 'Timetable',
      group: 'school',
      count: timetableTotals.done,
      done: timetableTotals.done,
      total: Math.max(timetableTotals.total, 1),
      percent: stepPercent(timetableTotals.done, Math.max(timetableTotals.total, 1)),
      complete:
        timetableTotals.total > 0 && timetableTotals.done >= timetableTotals.total,
      href: '/dashboard/academics/timetable',
      hint: 'Lay out the week for every section. The register follows it.',
    },
    simpleStep({
      key: 'students',
      label: 'Enrolled students',
      count: students,
      href: '/dashboard/admissions/enroll',
      hint: 'Enrol or import the roll.',
    }),
    ...feeHeadKpis,
  ];

  const completed = steps.filter((step) => step.complete).length;

  return {
    // A finished step keeps its count and loses its link: the tile is a
    // headcount as much as a checklist, and "6 classes" with nowhere to click
    // is the right resting state for a school that set them up last year.
    steps: steps.map((step) => (step.complete ? { ...step, href: null } : step)),
    completed,
    total: steps.length,
    // The unweighted mean of every KPI's own percentage. See `SetupProgress`.
    percent: Math.round(
      steps.reduce((sum, step) => sum + step.percent, 0) / Math.max(steps.length, 1),
    ),
  };
}

/** A KPI whose only honest denominator is one: it exists, or it does not. */
function simpleStep(input: {
  key: string;
  label: string;
  count: number;
  href: string;
  hint: string;
}): SetupStep {
  const done = input.count > 0 ? 1 : 0;

  return {
    key: input.key,
    label: input.label,
    group: 'school',
    count: input.count,
    done,
    total: 1,
    percent: done * 100,
    complete: done === 1,
    href: input.href,
    hint: input.hint,
  };
}

/**
 * The Principals KPI, which is two different questions at two kinds of school.
 *
 * At a `single` school — every school by default — it is "has a head been
 * invited": one active `principal` or `vice_principal` account, out of one.
 *
 * At a `multiple` school it is "does every campus have a head **now**": branches
 * with a current `principal_assignments` row, over total branches. That is the
 * number LGS needed and never saw. It runs `multiple`, has one branch and zero
 * assignments, so its principal signed in to an empty school with nothing on
 * any screen to say why. A school set to `multiple` with no branches falls back
 * to the `single` question, because there is nothing to divide by and refusing
 * to answer would be worse than answering the simpler question.
 *
 * "Current" means started and not ended, evaluated on today's date through the
 * operators rather than a raw `sql` template — a date value handed straight to
 * the driver is the failure CLAUDE.md documents at length.
 */
async function resolvePrincipalKpi(locationId: string): Promise<{
  label: string;
  done: number;
  total: number;
  href: string;
  hint: string;
}> {
  const today = toDateOnly(new Date());

  const [modelRows, branchRows] = await Promise.all([
    db
      .select({ principalModel: schools.principalModel })
      .from(schools)
      .where(eq(schools.locationId, locationId))
      .limit(1),
    db
      .select({ id: branches.id })
      .from(branches)
      .where(and(eq(branches.locationId, locationId), eq(branches.isActive, true))),
  ]);

  const multiple = modelRows[0]?.principalModel === 'multiple';

  if (!multiple || branchRows.length === 0) {
    const accounts = await countRows(
      db
        .select({ value: sql<number>`count(*)`.mapWith(Number) })
        .from(schoolUsers)
        .where(
          and(
            eq(schoolUsers.locationId, locationId),
            eq(schoolUsers.isActive, true),
            inArray(schoolUsers.role, ['principal', 'vice_principal']),
          ),
        ),
    );

    return {
      label: 'Principal',
      done: accounts > 0 ? 1 : 0,
      total: 1,
      href: '/dashboard/users/invite',
      hint: 'Invite the head of the school so they can sign in.',
    };
  }

  const assigned = await db
    .selectDistinct({ branchId: principalAssignments.branchId })
    .from(principalAssignments)
    .where(
      and(
        eq(principalAssignments.locationId, locationId),
        lte(principalAssignments.startsOn, today),
        or(
          isNull(principalAssignments.endsOn),
          gte(principalAssignments.endsOn, today),
        ),
      ),
    );

  // A row with a null `branchId` is a head who runs every campus — a legal and
  // real arrangement (see `principal_assignments`). It covers all of them.
  const coversEverything = assigned.some((row) => row.branchId === null);
  const named = new Set(
    assigned.map((row) => row.branchId).filter((id): id is string => id !== null),
  );

  const done = coversEverything
    ? branchRows.length
    : branchRows.filter((branch) => named.has(branch.id)).length;

  return {
    label: 'Principals',
    done,
    total: branchRows.length,
    href: '/dashboard/settings',
    hint: 'Assign a principal to every campus, or nobody sees anything there.',
  };
}

/** Grades with at least one active section, over every active grade. */
async function gradeSectionCoverage(
  locationId: string,
): Promise<{ done: number; total: number }> {
  const rows = await db
    .select({
      total: sql<number>`count(distinct ${grades.id})`.mapWith(Number),
      done: sql<number>`count(distinct ${sections.gradeId})`.mapWith(Number),
    })
    .from(grades)
    .leftJoin(
      sections,
      and(eq(sections.gradeId, grades.id), eq(sections.isActive, true)),
    )
    .where(and(eq(grades.locationId, locationId), eq(grades.isActive, true)));

  return { done: rows[0]?.done ?? 0, total: rows[0]?.total ?? 0 };
}

/** Active sections with at least one active timetable entry, over all of them. */
async function timetableCoverage(
  locationId: string,
): Promise<{ done: number; total: number }> {
  const rows = await db
    .select({
      total: sql<number>`count(distinct ${sections.id})`.mapWith(Number),
      done: sql<number>`count(distinct ${timetableEntries.sectionId})`.mapWith(Number),
    })
    .from(sections)
    .leftJoin(
      timetableEntries,
      and(
        eq(timetableEntries.sectionId, sections.id),
        eq(timetableEntries.isActive, true),
      ),
    )
    .where(and(eq(sections.locationId, locationId), eq(sections.isActive, true)));

  return { done: rows[0]?.done ?? 0, total: rows[0]?.total ?? 0 };
}

/**
 * One KPI per fee head: grades priced under it, over every grade.
 *
 * The product owner's requirement stated exactly — *each fee in the fee type
 * structure should be its own KPI.* For LGS today that reads Tuition 100%,
 * Admission 100%, Annual 100%, Library 100% and **Examination 0%**, which is
 * the real state of that school and was invisible on the panel as it stood.
 *
 * **Rows are counted, never amounts.** A stored `0` is the school saying "this
 * grade pays nothing under this head", which is a completed decision;
 * filtering on `amount > 0` would un-complete it and push the school towards
 * inventing a price for a fee it does not charge.
 *
 * With no active academic year there is nothing to price against, so every head
 * reads 0 of its grades — outstanding, which it is. With no fee heads at all a
 * single 0/1 row stands in for the group, so the card never renders an empty
 * *Fee structure* heading; after Sprint 17's provisioning seed that state
 * exists only for schools created before this deploy.
 */
async function feeStructureCoverage(
  locationId: string,
  academicYearId: string | null,
): Promise<SetupStep[]> {
  const [heads, gradeCount] = await Promise.all([
    db
      .select({ id: feeTypes.id, name: feeTypes.name })
      .from(feeTypes)
      .where(and(eq(feeTypes.locationId, locationId), eq(feeTypes.isActive, true)))
      .orderBy(asc(feeTypes.sortOrder), asc(feeTypes.name)),
    countRows(
      db
        .select({ value: sql<number>`count(*)`.mapWith(Number) })
        .from(grades)
        .where(and(eq(grades.locationId, locationId), eq(grades.isActive, true))),
    ),
  ]);

  if (heads.length === 0) {
    return [
      {
        key: 'fee:none',
        label: 'Fee heads',
        group: 'fees',
        count: 0,
        done: 0,
        total: 1,
        percent: 0,
        complete: false,
        href: '/dashboard/fees/types',
        hint: 'Create the fee heads this school bills under.',
      },
    ];
  }

  const priced =
    academicYearId === null
      ? []
      : await db
          .select({
            feeTypeId: feeStructures.feeTypeId,
            value: sql<number>`count(distinct ${feeStructures.gradeId})`.mapWith(Number),
          })
          .from(feeStructures)
          .innerJoin(
            grades,
            and(eq(grades.id, feeStructures.gradeId), eq(grades.isActive, true)),
          )
          .where(
            and(
              eq(feeStructures.locationId, locationId),
              eq(feeStructures.academicYearId, academicYearId),
            ),
          )
          .groupBy(feeStructures.feeTypeId);

  const pricedByHead = new Map(priced.map((row) => [row.feeTypeId, row.value]));
  const total = Math.max(gradeCount, 1);

  return heads.map((head) => {
    const done = pricedByHead.get(head.id) ?? 0;
    const percent = stepPercent(done, total);

    return {
      key: `fee:${head.id}`,
      label: head.name,
      group: 'fees' as const,
      count: done,
      done,
      total,
      percent,
      complete: gradeCount > 0 && done >= gradeCount,
      href: '/dashboard/fees/structures',
      hint: `Price ${head.name} for every grade. Enter 0 where it is not charged.`,
    };
  });
}

/** One `count(*)` statement, reduced to the number. */
async function countRows(
  statement: PromiseLike<Array<{ value: number }>>,
): Promise<number> {
  const rows = await statement;
  return rows[0]?.value ?? 0;
}
