import {
  STAFF_KPI_PERIODS,
  STAFF_KPI_TARGET_ROLES,
  type StaffKpiPeriod,
  type StaffKpiTargetRole,
} from '@/db/schema/staff-kpis';
import type { UserRole } from '@/types/school-auth';

import type { Permission } from './permissions';

/**
 * `lib/kpis.ts` — Sprint 32. The rules of staff KPIs that need no database.
 *
 * Deliberately free of `server-only` and of any query: the rating grid in the
 * browser, the routes on the server and `scripts/check-sprint32.ts` all ask the
 * same functions, so "who counts", "what is the average" and "which principal
 * is this teacher's" cannot come to have two answers. `lib/kpi-access.ts` is
 * the half that reads Postgres and decides who may do what to whom.
 */

export { STAFF_KPI_PERIODS, STAFF_KPI_TARGET_ROLES };
export type { StaffKpiPeriod, StaffKpiTargetRole };

export const KPI_PERIOD_LABELS: Record<StaffKpiPeriod, string> = {
  monthly: 'Monthly',
  annual: 'Annual',
};

export function isKpiPeriod(value: unknown): value is StaffKpiPeriod {
  return typeof value === 'string' && (STAFF_KPI_PERIODS as readonly string[]).includes(value);
}

export function isKpiTargetRole(value: unknown): value is StaffKpiTargetRole {
  return (
    typeof value === 'string' && (STAFF_KPI_TARGET_ROLES as readonly string[]).includes(value)
  );
}

/** Non-teaching staff: rated by a branch admin, never by default by a principal. */
export const NON_TEACHING_ROLES: readonly StaffKpiTargetRole[] = [
  'hr_manager',
  'accountant',
  'marketing',
];

/**
 * The permission that lets somebody rate a role, or null where a School Admin
 * setting answers instead.
 *
 * Principals and branch admins have no key on purpose (rule 7): a key beside a
 * setting could disagree with it, and "may rate a principal" would then have
 * two answers.
 */
export function rateKeyFor(role: StaffKpiTargetRole): Permission | null {
  switch (role) {
    case 'teacher':
      return 'kpis.rate.teacher';
    case 'coordinator':
      return 'kpis.rate.coordinator';
    case 'vice_principal':
      return 'kpis.rate.vice_principal';
    case 'section_head':
      return 'kpis.rate.section_head';
    case 'hr_manager':
      return 'kpis.rate.hr_manager';
    case 'accountant':
      return 'kpis.rate.accountant';
    case 'marketing':
      return 'kpis.rate.marketing';
    case 'principal':
    case 'branch_admin':
      return null;
  }
}

/**
 * Rule 5: when two people rate the same thing, the senior rater's score counts.
 *
 * School Admin > Principal > Vice Principal > Branch Admin > Section Head >
 * Coordinator. The Vice Principal sits directly under the Principal because
 * they hold the Principal's rights (rule 7c). Anybody else a school has granted
 * a rate key ranks below all six.
 *
 * Sprint 33b inserted `section_head` below `branch_admin` (decision 14) and
 * renumbered rather than wedging a fraction in: the numbers are an ordering and
 * nothing reads their magnitude. `check-branch-scope` asserts this order and the
 * chat grant ranks in `db/schema/chat-grants.ts` still agree, which is the only
 * thing standing between the two features disagreeing about who outranks whom.
 */
export const RATER_SENIORITY: Readonly<Partial<Record<UserRole, number>>> = {
  school_admin: 6,
  principal: 5,
  vice_principal: 4,
  branch_admin: 3,
  section_head: 2,
  coordinator: 1,
};

export function seniorityOf(role: string): number {
  return RATER_SENIORITY[role as UserRole] ?? 0;
}

/**
 * Rule 3: which roles a creator may write KPIs for.
 *
 * The key (`kpis.create`) is the door; this is the room. A Principal and a
 * Branch Admin may not define for each other or for themselves, a Vice
 * Principal is a Principal who additionally may not define for their own role,
 * and a Coordinator defines for nobody. A role a school has granted the key to
 * beyond the defaults may define for the rank-and-file roles other than its own.
 */
export function definableTargets(creatorRole: UserRole): StaffKpiTargetRole[] {
  switch (creatorRole) {
    case 'school_admin':
      return [...STAFF_KPI_TARGET_ROLES];
    case 'principal':
    case 'branch_admin':
      return STAFF_KPI_TARGET_ROLES.filter(
        (role) => role !== 'principal' && role !== 'branch_admin',
      );
    case 'vice_principal':
      return STAFF_KPI_TARGET_ROLES.filter(
        (role) => role !== 'principal' && role !== 'branch_admin' && role !== 'vice_principal',
      );
    case 'coordinator':
    case 'student':
    case 'parent':
      return [];
    default:
      return (['teacher', 'coordinator', ...NON_TEACHING_ROLES] as StaffKpiTargetRole[]).filter(
        (role) => role !== creatorRole,
      );
  }
}

/* ------------------------------------------------------------ settings */

export const PRINCIPAL_RATER_OPTIONS = ['school_admin', 'self', 'branch_admin'] as const;
export const BRANCH_ADMIN_RATER_OPTIONS = ['school_admin', 'self', 'principal'] as const;
export type PrincipalRater = (typeof PRINCIPAL_RATER_OPTIONS)[number];
export type BranchAdminRater = (typeof BRANCH_ADMIN_RATER_OPTIONS)[number];

export const RATER_OPTION_LABELS: Record<string, string> = {
  school_admin: 'School Administrator',
  self: 'Themselves',
  branch_admin: 'Branch Administrator',
  principal: 'Principal',
};

export interface KpiSettings {
  ratePrincipals: boolean;
  principalRaters: PrincipalRater[];
  rateBranchAdmins: boolean;
  branchAdminRaters: BranchAdminRater[];
}

export const DEFAULT_KPI_SETTINGS: KpiSettings = {
  ratePrincipals: false,
  principalRaters: ['school_admin'],
  rateBranchAdmins: false,
  branchAdminRaters: ['school_admin'],
};

/** Reads rule 7's two settings off a request body, or says what is wrong. */
export function parseKpiSettings(raw: unknown): KpiSettings | string {
  if (typeof raw !== 'object' || raw === null) return 'Expected the two rating settings.';
  const value = raw as Record<string, unknown>;

  if (typeof value['ratePrincipals'] !== 'boolean' || typeof value['rateBranchAdmins'] !== 'boolean') {
    return 'Say Yes or No for principals and for branch admins.';
  }

  const principalRaters = readRaterList(value['principalRaters'], PRINCIPAL_RATER_OPTIONS);
  const branchAdminRaters = readRaterList(value['branchAdminRaters'], BRANCH_ADMIN_RATER_OPTIONS);

  if (principalRaters === null || branchAdminRaters === null) {
    return 'One of the raters chosen is not offered for that role.';
  }

  if (value['ratePrincipals'] === true && principalRaters.length === 0) {
    return 'Choose at least one person to rate principals, or turn it off.';
  }
  if (value['rateBranchAdmins'] === true && branchAdminRaters.length === 0) {
    return 'Choose at least one person to rate branch admins, or turn it off.';
  }

  return {
    ratePrincipals: value['ratePrincipals'],
    principalRaters: principalRaters as PrincipalRater[],
    rateBranchAdmins: value['rateBranchAdmins'],
    branchAdminRaters: branchAdminRaters as BranchAdminRater[],
  };
}

function readRaterList(raw: unknown, allowed: readonly string[]): string[] | null {
  if (!Array.isArray(raw)) return null;
  const out: string[] = [];
  for (const entry of raw) {
    if (typeof entry !== 'string' || !allowed.includes(entry)) return null;
    if (!out.includes(entry)) out.push(entry);
  }
  return out;
}

/* ---------------------------------------------------------- validation */

export const MAX_KPI_NAME_LENGTH = 80;
export const MAX_KPI_DESCRIPTION_LENGTH = 500;
export const MAX_RATING_COMMENT_LENGTH = 1000;
export const MIN_SCORE = 1;
export const MAX_SCORE = 10;

export function kpiNameProblem(name: string): string | null {
  const trimmed = name.trim();
  if (trimmed === '') return 'Give the KPI a name, for example Punctuality.';
  if (trimmed.length > MAX_KPI_NAME_LENGTH) {
    return `Keep the name to ${String(MAX_KPI_NAME_LENGTH)} characters.`;
  }
  return null;
}

export function scoreProblem(score: unknown): string | null {
  if (typeof score !== 'number' || !Number.isInteger(score)) {
    return 'A rating is a whole number from 1 to 10.';
  }
  if (score < MIN_SCORE || score > MAX_SCORE) return 'A rating is a whole number from 1 to 10.';
  return null;
}

/* -------------------------------------------------------------- months */

const SHORT_MONTHS = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
] as const;

/** `2026-09`. The unit a monthly rating is entered against. */
export type MonthKey = string;

export function isMonthKey(value: unknown): value is MonthKey {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}$/.test(value)) return false;
  const month = Number(value.slice(5, 7));
  return month >= 1 && month <= 12;
}

export function monthKeyOf(date: Date): MonthKey {
  return `${String(date.getFullYear())}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

/** `2026-09` → `2026-09-01`, the form `period_month` holds. */
export function monthStart(key: MonthKey): string {
  return `${key}-01`;
}

/**
 * `2026-09` → `2026-10`. The exclusive upper bound of a month.
 *
 * Never `${key}-31`: Postgres refuses `2026-09-31` outright (22008), which
 * `check-sprint32` caught on the register read before it shipped.
 */
export function nextMonthKey(key: MonthKey): MonthKey {
  const year = Number(key.slice(0, 4));
  const month = Number(key.slice(5, 7));
  return month === 12
    ? `${String(year + 1)}-01`
    : `${String(year)}-${String(month + 1).padStart(2, '0')}`;
}

/** `2026-09-01` → `2026-09`. */
export function monthKeyFromDate(value: string | null): MonthKey | null {
  return value === null ? null : value.slice(0, 7);
}

/** `2026-09` → `Sep 2026`. */
export function monthLabel(key: MonthKey): string {
  const month = Number(key.slice(5, 7));
  return `${SHORT_MONTHS[month - 1] ?? '?'} ${key.slice(0, 4)}`;
}

/** Every month an academic year spans, in order. */
export function monthsOfYear(year: {
  startMonth: number;
  startYear: number;
  endMonth: number;
  endYear: number;
}): MonthKey[] {
  const months: MonthKey[] = [];
  let y = year.startYear;
  let m = year.startMonth;
  // Bounded: a malformed year cannot spin this forever.
  for (let guard = 0; guard < 36; guard += 1) {
    months.push(`${String(y)}-${String(m).padStart(2, '0')}`);
    if (y === year.endYear && m === year.endMonth) break;
    m += 1;
    if (m === 13) {
      m = 1;
      y += 1;
    }
  }
  return months;
}

/* ------------------------------------------------------------- scoring */

/** One rating as every reader of it sees it. */
export interface RatingRecord {
  id: string;
  kpiId: string;
  ratedUserId: string;
  /** `YYYY-MM` for a monthly KPI; null for an annual one. */
  month: MonthKey | null;
  score: number;
  comment: string | null;
  raterUserId: string | null;
  raterRole: string;
  raterName: string;
  /** ISO string. Orders a rater's own changes. */
  createdAt: string;
}

/** The cell a rating belongs to: one KPI, one person, one period. */
export function cellKey(kpiId: string, ratedUserId: string, month: MonthKey | null): string {
  return `${kpiId}|${ratedUserId}|${month ?? 'year'}`;
}

/**
 * Each rater's current answer: their latest row per cell.
 *
 * Ratings are append-only, so a rater who changed a 6 to an 8 has two rows and
 * means the second. Rows without a rater id (the account was deleted) are
 * keyed by name, which keeps them one rater rather than none.
 */
export function currentRatings(ratings: readonly RatingRecord[]): RatingRecord[] {
  const latest = new Map<string, RatingRecord>();
  for (const rating of ratings) {
    const rater = rating.raterUserId ?? `name:${rating.raterName}`;
    const key = `${cellKey(rating.kpiId, rating.ratedUserId, rating.month)}|${rater}`;
    const held = latest.get(key);
    if (held === undefined || held.createdAt < rating.createdAt) latest.set(key, rating);
  }
  return [...latest.values()];
}

/**
 * The one rating that counts for a cell (rule 5), or null.
 *
 * Highest seniority wins; between equals — two coordinators, say — the most
 * recent. The others are still returned by `currentRatings` and still shown in
 * the history: kept, and not counted.
 */
export function countingRating(cell: readonly RatingRecord[]): RatingRecord | null {
  let best: RatingRecord | null = null;
  for (const rating of cell) {
    if (best === null) {
      best = rating;
      continue;
    }
    const a = seniorityOf(rating.raterRole);
    const b = seniorityOf(best.raterRole);
    if (a > b || (a === b && rating.createdAt > best.createdAt)) best = rating;
  }
  return best;
}

/** Counting ratings for every cell, keyed by `cellKey`. */
export function countingByCell(ratings: readonly RatingRecord[]): Map<string, RatingRecord> {
  const cells = new Map<string, RatingRecord[]>();
  for (const rating of currentRatings(ratings)) {
    const key = cellKey(rating.kpiId, rating.ratedUserId, rating.month);
    const list = cells.get(key) ?? [];
    list.push(rating);
    cells.set(key, list);
  }

  const out = new Map<string, RatingRecord>();
  for (const [key, list] of cells) {
    const counting = countingRating(list);
    if (counting !== null) out.set(key, counting);
  }
  return out;
}

/** Rule 6: a plain average. Null for nothing, never zero. */
export function averageScore(scores: readonly number[]): number | null {
  if (scores.length === 0) return null;
  return scores.reduce((sum, score) => sum + score, 0) / scores.length;
}

/** A score out of ten as a percentage, to one decimal. `8.5` → `85`. */
export function scorePercent(score: number | null): number | null {
  return score === null ? null : Math.round(score * 100) / 10;
}

export function formatPercent(percent: number | null): string {
  if (percent === null) return '—';
  return Number.isInteger(percent) ? `${String(percent)}%` : `${percent.toFixed(1)}%`;
}

export interface PerformanceSummary {
  /** Monthly overall for the month asked about, as a percentage. */
  monthly: number | null;
  monthlyRated: number;
  /** Yearly overall across the academic year, as a percentage. */
  yearly: number | null;
  yearlyRated: number;
}

/**
 * One person's two figures.
 *
 * Monthly overall: the plain average of their counting scores on **monthly**
 * KPIs for that month. Yearly overall: the plain average of every counting
 * score in the academic year — each monthly KPI in each month it was rated,
 * and each annual KPI once. No weights (rule 6). KPIs that have been deleted
 * are left out by the caller, which passes only live ids.
 */
export function summarise(
  ratedUserId: string,
  counting: ReadonlyMap<string, RatingRecord>,
  liveKpis: ReadonlyMap<string, StaffKpiPeriod>,
  month: MonthKey | null,
): PerformanceSummary {
  const monthScores: number[] = [];
  const yearScores: number[] = [];

  for (const rating of counting.values()) {
    if (rating.ratedUserId !== ratedUserId) continue;
    const period = liveKpis.get(rating.kpiId);
    if (period === undefined) continue;
    if (period === 'monthly' && rating.month === null) continue;
    if (period === 'annual' && rating.month !== null) continue;

    yearScores.push(rating.score);
    if (period === 'monthly' && month !== null && rating.month === month) {
      monthScores.push(rating.score);
    }
  }

  return {
    monthly: scorePercent(averageScore(monthScores)),
    monthlyRated: monthScores.length,
    yearly: scorePercent(averageScore(yearScores)),
    yearlyRated: yearScores.length,
  };
}

/* ------------------------------------------ one teacher, one principal */

/** A principal assignment in force, as the derivation needs it. */
export interface AssignmentLike {
  principalUserId: string;
  branchId: string | null;
  gradeIds: readonly string[];
}

/** A teacher's timetabled periods in one grade. */
export interface GradePeriods {
  gradeId: string;
  branchId: string;
  periods: number;
}

/**
 * The principals a grade falls under — the most specific assignments only.
 *
 * An assignment admits a grade when its campus matches (or it has none) **and**
 * its grade list names the grade (or is empty, which the resolver has always
 * read as *every grade*). Both halves: without the campus half a campus-wide
 * head with no grade list would reach every grade in the school.
 *
 * A group with an overall head and division heads has two assignments admitting
 * Year 8, and counting the period for both would make every teacher a tie. The
 * named grade beats the empty list, and the named campus beats every campus.
 */
export function principalsForGrade(
  assignments: readonly AssignmentLike[],
  gradeId: string,
  branchId: string,
): string[] {
  let best = -1;
  let winners: string[] = [];

  for (const assignment of assignments) {
    const branchOk = assignment.branchId === null || assignment.branchId === branchId;
    const gradeOk = assignment.gradeIds.length === 0 || assignment.gradeIds.includes(gradeId);
    if (!branchOk || !gradeOk) continue;

    const specificity =
      (assignment.gradeIds.length > 0 ? 2 : 0) + (assignment.branchId !== null ? 1 : 0);

    if (specificity > best) {
      best = specificity;
      winners = [assignment.principalUserId];
    } else if (specificity === best && !winners.includes(assignment.principalUserId)) {
      winners.push(assignment.principalUserId);
    }
  }

  return winners;
}

export type DerivedPrincipal =
  | {
      principalUserId: string;
      periods: number;
      reason: 'most_periods' | 'class_teacher';
    }
  | {
      principalUserId: null;
      periods: number;
      /** `tie`: the School Admin picks. `no_periods`: listed as unassigned. */
      reason: 'tie' | 'no_periods';
      candidates: string[];
    };

/**
 * Rule 7b, and the fourth pass's confirmations 1 and 2.
 *
 * Count active periods per principal; the most wins. On a tie, the principal of
 * the section the teacher is class teacher of breaks it — if that is one of the
 * tied. With no periods at all, the class-teacher section's principal; failing
 * that, nobody, and the screen names the teacher rather than hiding them.
 */
export function derivePrincipal(
  assignments: readonly AssignmentLike[],
  periods: readonly GradePeriods[],
  classTeacherGrades: readonly { gradeId: string; branchId: string }[],
): DerivedPrincipal {
  const totals = new Map<string, number>();
  for (const row of periods) {
    for (const principal of principalsForGrade(assignments, row.gradeId, row.branchId)) {
      totals.set(principal, (totals.get(principal) ?? 0) + row.periods);
    }
  }

  const homeRoom = new Set<string>();
  for (const grade of classTeacherGrades) {
    for (const principal of principalsForGrade(assignments, grade.gradeId, grade.branchId)) {
      homeRoom.add(principal);
    }
  }

  if (totals.size === 0) {
    if (homeRoom.size === 1) {
      return { principalUserId: [...homeRoom][0]!, periods: 0, reason: 'class_teacher' };
    }
    return { principalUserId: null, periods: 0, reason: 'no_periods', candidates: [...homeRoom] };
  }

  const most = Math.max(...totals.values());
  const tied = [...totals.entries()].filter(([, count]) => count === most).map(([id]) => id);

  if (tied.length === 1) {
    return { principalUserId: tied[0]!, periods: most, reason: 'most_periods' };
  }

  const breakers = tied.filter((id) => homeRoom.has(id));
  if (breakers.length === 1) {
    return { principalUserId: breakers[0]!, periods: most, reason: 'class_teacher' };
  }

  return { principalUserId: null, periods: most, reason: 'tie', candidates: tied.sort() };
}
