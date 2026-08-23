import 'server-only';

import { and, asc, desc, eq, gte, inArray, isNull, lt, lte, or, sql } from 'drizzle-orm';

import {
  APPLICATION_STATUSES,
  APPLICATION_STATUS_LABELS,
} from '@/db/schema/admission-applications';
import {
  attendanceRecords,
  admissionApplications,
  examResults,
  examSubjects,
  exams,
  feeChallans,
  feePayments,
  gradeLabel,
  grades,
  sections,
  studentEnrollments,
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
