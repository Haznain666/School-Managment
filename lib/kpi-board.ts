import 'server-only';

import { and, count, desc, eq, gte, lt } from 'drizzle-orm';

import {
  gradeLabel,
  grades,
  leaveRequests,
  leaveTypes,
  lessonPlans,
  sections,
  staff,
  staffAttendance,
  subjects,
  teacherPrincipalTransfers,
  timetableEntries,
  type PrincipalTransferStatus,
  type StaffKpiPeriod,
  type StaffKpiTargetRole,
} from '@/db/schema';

import { db } from './drizzle';
import { liveTimetableEntries } from './timetable-history';
import {
  headIdentity,
  kpisFor,
  listKpis,
  listRatings,
  listYears,
  rateRefusal,
  visibilityOf,
  yearForMonth,
  type KpiContext,
  type StaffPerson,
  type YearRow,
} from './kpi-access';
import {
  cellKey,
  countingByCell,
  currentRatings,
  isMonthKey,
  monthKeyOf,
  monthLabel,
  monthStart,
  monthsOfYear,
  nextMonthKey,
  summarise,
  type KpiSettings,
  type MonthKey,
  type PerformanceSummary,
  type RatingRecord,
} from './kpis';

/**
 * `lib/kpi-board.ts` — Sprint 32. What the Staff performance screens show.
 *
 * Every function here takes a `KpiContext` and filters through
 * `visibilityOf` / `rateRefusal` before it reads a score, so a page and the
 * API route that re-fetches the same list after a save are one implementation
 * with two callers — the pattern §5ca asks the stale-list fix to use.
 */

export interface MonthOption {
  key: MonthKey;
  label: string;
}

export interface YearSummary {
  id: string;
  name: string;
}

function monthOptions(year: YearRow | null): MonthOption[] {
  return year === null ? [] : monthsOfYear(year).map((key) => ({ key, label: monthLabel(key) }));
}

/**
 * The month a screen opens on: the one asked for when it is real and inside a
 * known year, otherwise this month, otherwise the last month of the active
 * year — never a month nobody could have rated.
 */
function pickPeriod(
  years: readonly YearRow[],
  requested: string | null,
): { month: MonthKey; year: YearRow | null } {
  if (requested !== null && isMonthKey(requested)) {
    const year = yearForMonth(years, requested);
    if (year !== null) return { month: requested, year };
  }

  const now = monthKeyOf(new Date());
  const current = yearForMonth(years, now);
  if (current !== null) return { month: now, year: current };

  const active = years.find((year) => year.isActive) ?? years[0] ?? null;
  const months = active === null ? [] : monthsOfYear(active);
  return { month: months[months.length - 1] ?? now, year: active };
}

/* -------------------------------------------------------------- board */

export interface BoardRow {
  userId: string;
  name: string;
  role: StaffKpiTargetRole;
  branchName: string | null;
  designation: string | null;
  visibility: 'full' | 'overall';
  /** Null on an `overall` row: the monthly figure is not theirs to see. */
  monthly: number | null;
  monthlyRated: number;
  yearly: number | null;
  yearlyRated: number;
  kpiCount: number;
  canRate: boolean;
  principalName: string | null;
}

export interface Board {
  year: YearSummary | null;
  month: MonthKey;
  months: MonthOption[];
  rows: BoardRow[];
  /** The caller holds `kpis.overall` and not `kpis.read` — Finance. */
  overallOnly: boolean;
}

export async function buildBoard(ctx: KpiContext, requestedMonth: string | null): Promise<Board> {
  const [years, kpis] = await Promise.all([
    listYears(ctx.locationId),
    listKpis(ctx.locationId, null),
  ]);
  const { month, year } = pickPeriod(years, requestedMonth);

  const visible = ctx.people.flatMap((person) => {
    const visibility = visibilityOf(ctx, person);
    return visibility === null ? [] : [{ person, visibility }];
  });

  const ratings =
    year === null
      ? []
      : await listRatings(
          ctx.locationId,
          year.id,
          visible.map((entry) => entry.person.userId),
        );

  const counting = countingByCell(ratings);
  const periods = new Map<string, StaffKpiPeriod>(kpis.map((kpi) => [kpi.id, kpi.period]));

  const rows = visible.map(({ person, visibility }): BoardRow => {
    const summary = summarise(person.userId, counting, periods, month);
    const answer = ctx.teacherPrincipal.get(person.userId);

    return {
      userId: person.userId,
      name: person.name,
      role: person.role,
      branchName: person.branchName,
      designation: person.designation,
      visibility,
      monthly: visibility === 'full' ? summary.monthly : null,
      monthlyRated: visibility === 'full' ? summary.monthlyRated : 0,
      yearly: summary.yearly,
      yearlyRated: summary.yearlyRated,
      kpiCount: kpisFor(kpis, person).length,
      canRate: visibility === 'full' && rateRefusal(ctx, person) === null,
      principalName:
        answer?.principalUserId == null
          ? null
          : (ctx.byId.get(answer.principalUserId)?.name ?? null),
    };
  });

  return {
    year: year === null ? null : { id: year.id, name: year.name },
    month,
    months: monthOptions(year),
    rows,
    overallOnly: !ctx.permissions.has('kpis.read'),
  };
}

/* ------------------------------------------------------- person sheet */

export interface SheetKpi {
  id: string;
  name: string;
  description: string | null;
  period: StaffKpiPeriod;
  /** The rating that counts for the period on screen, if any. */
  counting: RatingRecord | null;
  /** The caller's own current rating for that period, to prefill the grid. */
  mine: RatingRecord | null;
}

export interface HistoryEntry extends RatingRecord {
  kpiName: string;
  /** False for a superseded change or a junior rating the senior one outranks. */
  counts: boolean;
}

export interface TeacherProfile {
  designation: string | null;
  department: string | null;
  employmentType: string | null;
  joinedOn: string | null;
  qualification: string | null;
  email: string | null;
  phone: string | null;
  classes: Array<{ label: string; subject: string; periods: number }>;
  attendance: Array<{ status: string; days: number }>;
  leave: Array<{ type: string; from: string; to: string; status: string }>;
  lessonPlans: Array<{ weekStarting: string; title: string; status: string }>;
}

export interface PersonSheet {
  person: {
    userId: string;
    name: string;
    role: StaffKpiTargetRole;
    branchName: string | null;
    designation: string | null;
  };
  visibility: 'full' | 'overall';
  isSelf: boolean;
  year: YearSummary | null;
  month: MonthKey;
  months: MonthOption[];
  summary: PerformanceSummary;
  kpis: SheetKpi[];
  history: HistoryEntry[];
  canRate: boolean;
  refusal: string | null;
  principalName: string | null;
  profile: TeacherProfile | null;
}

export async function buildPersonSheet(
  ctx: KpiContext,
  target: StaffPerson,
  requestedMonth: string | null,
): Promise<PersonSheet | null> {
  const visibility = visibilityOf(ctx, target);
  if (visibility === null) return null;

  const [years, allKpis] = await Promise.all([
    listYears(ctx.locationId),
    listKpis(ctx.locationId, null),
  ]);
  const { month, year } = pickPeriod(years, requestedMonth);

  const ratings = year === null ? [] : await listRatings(ctx.locationId, year.id, [target.userId]);
  const counting = countingByCell(ratings);
  const periods = new Map<string, StaffKpiPeriod>(allKpis.map((kpi) => [kpi.id, kpi.period]));
  const summary = summarise(target.userId, counting, periods, month);

  const isSelf = ctx.caller.userId === target.userId;
  const refusal = rateRefusal(ctx, target);
  const answer = ctx.teacherPrincipal.get(target.userId);
  const principalName =
    answer?.principalUserId == null ? null : (ctx.byId.get(answer.principalUserId)?.name ?? null);

  const base: PersonSheet = {
    person: {
      userId: target.userId,
      name: target.name,
      role: target.role,
      branchName: target.branchName,
      designation: target.designation,
    },
    visibility,
    isSelf,
    year: year === null ? null : { id: year.id, name: year.name },
    month,
    months: monthOptions(year),
    summary:
      visibility === 'full'
        ? summary
        : { monthly: null, monthlyRated: 0, yearly: summary.yearly, yearlyRated: summary.yearlyRated },
    kpis: [],
    history: [],
    canRate: false,
    refusal: null,
    principalName,
    profile: null,
  };

  // Rule 9: the overall-only reader gets one figure and nothing it is made of.
  if (visibility === 'overall') return base;

  const current = currentRatings(ratings);
  const countingIds = new Set([...counting.values()].map((rating) => rating.id));
  const names = new Map(allKpis.map((kpi) => [kpi.id, kpi.name]));

  const kpis = kpisFor(allKpis, target).map((kpi): SheetKpi => {
    const period = kpi.period === 'monthly' ? month : null;
    const mine =
      current.find(
        (rating) =>
          rating.kpiId === kpi.id &&
          rating.month === period &&
          ctx.caller.userId !== null &&
          rating.raterUserId === ctx.caller.userId,
      ) ?? null;

    return {
      id: kpi.id,
      name: kpi.name,
      description: kpi.description,
      period: kpi.period,
      counting: counting.get(cellKey(kpi.id, target.userId, period)) ?? null,
      mine,
    };
  });

  const history = ratings
    .map((rating): HistoryEntry => ({
      ...rating,
      kpiName: names.get(rating.kpiId) ?? 'Deleted KPI',
      counts: countingIds.has(rating.id),
    }))
    .reverse();

  const profile =
    !isSelf && (target.role === 'teacher' || target.role === 'coordinator')
      ? await teacherProfile(ctx.locationId, target, month)
      : null;

  return {
    ...base,
    kpis,
    history,
    canRate: refusal === null,
    refusal,
    profile,
  };
}

/**
 * Rule 8: a coordinator sees everything about a supervised teacher **except
 * salary** — built as an allow-list.
 *
 * Nothing here selects a whole `staff` row and removes columns. Each field is
 * named, so the next column somebody adds to `staff` — or the next payroll
 * table — does not reach a coordinator's screen by default. Bank details, CNIC,
 * date of birth and home address are left out with salary: none of them is the
 * work being appraised.
 */
export async function teacherProfile(
  locationId: string,
  target: StaffPerson,
  month: MonthKey,
): Promise<TeacherProfile> {
  const [record] =
    target.staffId === null
      ? [undefined]
      : await db
          .select({
            designation: staff.designation,
            department: staff.department,
            employmentType: staff.employmentType,
            joinedOn: staff.joinedOn,
            qualification: staff.qualification,
            email: staff.email,
            phone: staff.phone,
          })
          .from(staff)
          .where(and(eq(staff.locationId, locationId), eq(staff.id, target.staffId)))
          .limit(1);

  const monthFirst = monthStart(month);
  const nextMonthFirst = monthStart(nextMonthKey(month));

  const [classes, attendance, leave, plans] = await Promise.all([
    db
      .select({
        sectionName: sections.name,
        gradeName: grades.name,
        gradeDisplayName: grades.displayName,
        subject: subjects.name,
        periods: count(),
      })
      .from(timetableEntries)
      .innerJoin(sections, eq(sections.id, timetableEntries.sectionId))
      .innerJoin(grades, eq(grades.id, sections.gradeId))
      .innerJoin(subjects, eq(subjects.id, timetableEntries.subjectId))
      .where(
        and(
          eq(timetableEntries.locationId, locationId),
          eq(timetableEntries.teacherId, target.userId),
          eq(timetableEntries.isActive, true),
          // Sprint 33c: the version in force today. `lib/timetable-history.ts`.
          liveTimetableEntries(),
        ),
      )
      .groupBy(sections.name, grades.name, grades.displayName, subjects.name),
    target.staffId === null
      ? Promise.resolve([] as Array<{ status: string; days: number }>)
      : db
          .select({ status: staffAttendance.status, days: count() })
          .from(staffAttendance)
          .where(
            and(
              eq(staffAttendance.locationId, locationId),
              eq(staffAttendance.staffId, target.staffId),
              gte(staffAttendance.date, monthFirst),
              lt(staffAttendance.date, nextMonthFirst),
            ),
          )
          .groupBy(staffAttendance.status),
    target.staffId === null
      ? Promise.resolve([] as Array<{ type: string; from: string; to: string; status: string }>)
      : db
          .select({
            type: leaveTypes.name,
            from: leaveRequests.startDate,
            to: leaveRequests.endDate,
            status: leaveRequests.status,
          })
          .from(leaveRequests)
          .innerJoin(leaveTypes, eq(leaveTypes.id, leaveRequests.leaveTypeId))
          .where(
            and(
              eq(leaveRequests.locationId, locationId),
              eq(leaveRequests.staffId, target.staffId),
            ),
          )
          .orderBy(desc(leaveRequests.startDate))
          .limit(6),
    db
      .select({
        weekStarting: lessonPlans.weekStarting,
        title: lessonPlans.title,
        status: lessonPlans.status,
      })
      .from(lessonPlans)
      .where(and(eq(lessonPlans.locationId, locationId), eq(lessonPlans.teacherId, target.userId)))
      .orderBy(desc(lessonPlans.weekStarting))
      .limit(6),
  ]);

  return {
    designation: record?.designation ?? null,
    department: record?.department ?? null,
    employmentType: record?.employmentType ?? null,
    joinedOn: record?.joinedOn ?? null,
    qualification: record?.qualification ?? null,
    email: record?.email ?? null,
    phone: record?.phone ?? null,
    classes: classes
      .map((row) => ({
        label: `${gradeLabel({ name: row.gradeName, displayName: row.gradeDisplayName })} ${row.sectionName}`,
        subject: row.subject,
        periods: Number(row.periods),
      }))
      .sort((left, right) => left.label.localeCompare(right.label)),
    attendance: attendance.map((row) => ({ status: row.status, days: Number(row.days) })),
    leave,
    lessonPlans: plans,
  };
}

/* --------------------------------------------------------------- setup */

export interface TransferView {
  id: string;
  teacherUserId: string;
  teacherName: string;
  fromName: string | null;
  toName: string;
  requestedByName: string;
  status: PrincipalTransferStatus;
  note: string | null;
  createdAt: string;
  canDecide: boolean;
  canCancel: boolean;
}

export interface SetupData {
  model: 'single' | 'multiple';
  me: string | null;
  canManageSettings: boolean;
  canAssignCoordinators: boolean;
  isHead: boolean;
  settings: KpiSettings;
  principals: Array<{ userId: string; name: string }>;
  vicePrincipals: Array<{ userId: string; name: string; principalUserId: string | null }>;
  coordinators: Array<{
    userId: string;
    name: string;
    branchId: string | null;
    branchName: string | null;
    teacherUserIds: string[];
  }>;
  teachers: Array<{
    userId: string;
    name: string;
    branchId: string | null;
    branchName: string | null;
    principalUserId: string | null;
    principalName: string | null;
    source: string | null;
    reason: string | null;
    candidateNames: string[];
    /** At a several-principal school, whether the caller's principal holds them. */
    mine: boolean;
  }>;
  transfers: TransferView[];
}

function inScope(ctx: KpiContext, branchId: string | null): boolean {
  return ctx.branchIds === null || branchId === null || ctx.branchIds.includes(branchId);
}

/** Whether this caller decides a transfer. */
export function canDecideTransfer(
  ctx: KpiContext,
  transfer: {
    fromPrincipalUserId: string | null;
    toPrincipalUserId: string;
    requestedBy: string | null;
    status: string;
  },
): boolean {
  if (transfer.status !== 'requested') return false;
  if (ctx.caller.role === 'school_admin' && ctx.permissions.has('permissions.manage')) return true;
  if (ctx.caller.role !== 'principal' || ctx.caller.userId === null) return false;
  // The *other* principal accepts. A request about an unassigned teacher has no
  // other principal, so it waits for the School Administrator.
  if (transfer.fromPrincipalUserId === null) return false;
  const party =
    ctx.caller.userId === transfer.fromPrincipalUserId ||
    ctx.caller.userId === transfer.toPrincipalUserId;
  return party && ctx.caller.userId !== transfer.requestedBy;
}

export async function listTransfers(ctx: KpiContext): Promise<TransferView[]> {
  const rows = await db
    .select()
    .from(teacherPrincipalTransfers)
    .where(eq(teacherPrincipalTransfers.locationId, ctx.locationId))
    .orderBy(desc(teacherPrincipalTransfers.createdAt))
    .limit(50);

  const nameOf = (id: string | null): string | null =>
    id === null ? null : (ctx.byId.get(id)?.name ?? null);

  return rows.map((row) => ({
    id: row.id,
    teacherUserId: row.teacherUserId,
    teacherName: nameOf(row.teacherUserId) ?? 'A former teacher',
    fromName: nameOf(row.fromPrincipalUserId),
    toName: nameOf(row.toPrincipalUserId) ?? 'A former principal',
    requestedByName: nameOf(row.requestedBy) ?? 'The school office',
    status: row.status,
    note: row.note,
    createdAt: row.createdAt.toISOString(),
    canDecide: canDecideTransfer(ctx, row),
    canCancel:
      row.status === 'requested' &&
      ctx.caller.userId !== null &&
      row.requestedBy === ctx.caller.userId,
  }));
}

export async function buildSetup(ctx: KpiContext): Promise<SetupData> {
  const head = headIdentity(ctx);
  const transfers = ctx.model === 'multiple' ? await listTransfers(ctx) : [];

  return {
    model: ctx.model,
    me: ctx.caller.userId,
    canManageSettings: ctx.permissions.has('permissions.manage'),
    canAssignCoordinators: ctx.caller.role === 'principal' || ctx.caller.role === 'vice_principal',
    isHead: head !== null,
    settings: ctx.settings,
    principals: ctx.principals.map((person) => ({ userId: person.userId, name: person.name })),
    vicePrincipals: ctx.people
      .filter((person) => person.role === 'vice_principal')
      .map((person) => ({
        userId: person.userId,
        name: person.name,
        principalUserId: ctx.vicePrincipalOf.get(person.userId) ?? null,
      })),
    coordinators: ctx.people
      .filter((person) => person.role === 'coordinator' && inScope(ctx, person.branchId))
      .map((person) => ({
        userId: person.userId,
        name: person.name,
        branchId: person.branchId,
        branchName: person.branchName,
        teacherUserIds: [...(ctx.supervised.get(person.userId) ?? [])],
      })),
    teachers: ctx.people
      .filter((person) => person.role === 'teacher' && inScope(ctx, person.branchId))
      .map((person) => {
        const answer = ctx.teacherPrincipal.get(person.userId);
        return {
          userId: person.userId,
          name: person.name,
          branchId: person.branchId,
          branchName: person.branchName,
          principalUserId: answer?.principalUserId ?? null,
          principalName:
            answer?.principalUserId == null
              ? null
              : (ctx.byId.get(answer.principalUserId)?.name ?? null),
          source: answer?.source ?? null,
          reason: answer?.reason ?? null,
          candidateNames: (answer?.candidates ?? []).map(
            (id) => ctx.byId.get(id)?.name ?? 'A principal',
          ),
          mine: head === 'all' || (head !== null && answer?.principalUserId === head),
        };
      }),
    transfers,
  };
}
