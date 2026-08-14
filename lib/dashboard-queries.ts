import 'server-only';

import { and, eq, gte, inArray, lt, sql } from 'drizzle-orm';

import {
  APPLICATION_STATUSES,
  APPLICATION_STATUS_LABELS,
} from '@/db/schema/admission-applications';
import {
  attendanceRecords,
  admissionApplications,
  feeChallans,
  feePayments,
  grades,
  sections,
  studentEnrollments,
} from '@/db/schema';

import { getActiveAcademicYear } from './admissions-queries';
import { db } from './drizzle';
import { toDateOnly } from './fee-queries';

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
 * Fees.
 * -------------------------------------------------------------------------- */

/** Collections per month, from payments actually received. */
export async function getCollectionTrend(locationId: string): Promise<MonthPoint[]> {
  const months = recentMonths(TREND_MONTHS);
  const first = months[0]!.start;

  const rows = await db
    .select({
      month: sql<string>`to_char(${feePayments.paymentDate}, 'YYYY-MM')`,
      value: sql<string>`coalesce(sum(${feePayments.amount}), 0)`,
    })
    .from(feePayments)
    .where(and(eq(feePayments.locationId, locationId), gte(feePayments.paymentDate, first)))
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
export async function getFeeStatusSplit(locationId: string): Promise<FeeStatusSplit | null> {
  const activeYear = await getActiveAcademicYear(locationId);
  if (activeYear === null) return null;

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
export async function getAgingBuckets(locationId: string): Promise<AgingBucket[]> {
  const today = toDateOnly(new Date());

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
): Promise<Array<MonthPoint & { value: number }>> {
  const months = recentMonths(TREND_MONTHS);
  const first = months[0]!.start;

  const rows = await db
    .select({
      month: sql<string>`to_char(${attendanceRecords.date}, 'YYYY-MM')`,
      // Guarded against a month of nothing but holidays, which would divide by
      // zero rather than simply having no rate.
      value: sql<string>`case when ${CONSIDERED} = 0 then 0 else round(100.0 * ${ATTENDED} / ${CONSIDERED}, 1) end`,
    })
    .from(attendanceRecords)
    .where(and(eq(attendanceRecords.locationId, locationId), gte(attendanceRecords.date, first)))
    .groupBy(sql`to_char(${attendanceRecords.date}, 'YYYY-MM')`);

  return alignToMonths(
    rows.map((row) => ({ month: row.month, value: Number(row.value) })),
    months,
  );
}

/** Attendance rate per class for the last 30 days. */
export async function getAttendanceByClass(locationId: string): Promise<NamedCount[]> {
  const since = toDateOnly(new Date(Date.now() - 30 * 24 * 60 * 60 * 1000));

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
    .where(and(eq(attendanceRecords.locationId, locationId), gte(attendanceRecords.date, since)))
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
export async function getClassStrength(locationId: string): Promise<NamedCount[]> {
  const activeYear = await getActiveAcademicYear(locationId);
  if (activeYear === null) return [];

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
      ),
    )
    .groupBy(grades.name, sections.name, grades.sortOrder)
    .orderBy(grades.sortOrder, sections.name);

  return rows.map((row) => ({ label: `${row.grade} ${row.section}`, value: row.value }));
}

/** Admission applications by status — the funnel, in the order it is walked. */
export async function getAdmissionsFunnel(locationId: string): Promise<NamedCount[]> {
  const rows = await db
    .select({
      status: admissionApplications.status,
      value: sql<number>`count(*)`.mapWith(Number),
    })
    .from(admissionApplications)
    .where(eq(admissionApplications.locationId, locationId))
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
export async function getTodaySnapshot(locationId: string): Promise<TodaySnapshot> {
  const today = toDateOnly(new Date());
  const tomorrow = toDateOnly(new Date(Date.now() + 24 * 60 * 60 * 1000));

  const [collected, attendance] = await Promise.all([
    db
      .select({ value: sql<string>`coalesce(sum(${feePayments.amount}), 0)` })
      .from(feePayments)
      .where(
        and(
          eq(feePayments.locationId, locationId),
          gte(feePayments.paymentDate, today),
          lt(feePayments.paymentDate, tomorrow),
        ),
      ),
    db
      .select({
        considered: sql<number>`${CONSIDERED}`.mapWith(Number),
        attended: sql<number>`${ATTENDED}`.mapWith(Number),
      })
      .from(attendanceRecords)
      .where(
        and(eq(attendanceRecords.locationId, locationId), eq(attendanceRecords.date, today)),
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
