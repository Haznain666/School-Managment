import type { HolidaySpan } from '@/db/schema/branch-leave-settings';

import { addDays } from './holiday-calendar';

/**
 * `lib/leave-quota.ts` — how many days a leave request costs, and how many are
 * left. Sprint 33b.
 *
 * ── One module, three callers ────────────────────────────────────────────
 * The form in the browser, the API on the server and
 * `scripts/check-sprint33b.ts` all call these functions. That is the whole
 * point of the module and the reason it is free of `server-only` and of any
 * query: a form that counted days one way and a route that counted them
 * another would tell a teacher she was spending four days and deduct five, and
 * the first anybody would know is a balance that does not add up in March.
 * `lib/leave-queries.ts` is the half that reads Postgres and calls in here.
 *
 * ── What a day is ────────────────────────────────────────────────────────
 * **Calendar days**, inclusive of both ends, minus the gazetted holidays inside
 * the range when the campus says to skip them (decision 8). Weekends are
 * deliberately *not* excluded: whether a Saturday is a working day is per role
 * **and** per person in this product — `saturday_duty_policies` and
 * `staff.saturday_ordinals` — so a counter that guessed would be wrong for
 * somebody on every school that runs a rota. It is also what Part A shipped and
 * what `leave_requests.total_days` already holds, so no existing row changes
 * meaning. The field stays editable for exactly this reason, and the screen
 * says what it counted.
 *
 * ── Entitlement pro-rates and lapses ─────────────────────────────────────
 * Decisions 5 and 10. Leave accrues from `staff.permanent_from` against the
 * school's own academic year — an April–March school and an August–July school
 * both exist — and whatever is unused at the end of it is gone. There is no
 * carry-forward and no column that could hold one.
 */

/** Inclusive calendar days between two ISO dates. 0 when the range is unusable. */
export function calendarSpan(startDate: string, endDate: string): number {
  const from = Date.parse(`${startDate}T00:00:00Z`);
  const to = Date.parse(`${endDate}T00:00:00Z`);
  if (Number.isNaN(from) || Number.isNaN(to) || to < from) return 0;
  return Math.round((to - from) / 86_400_000) + 1;
}

/** Every ISO date in an inclusive range. Bounded: a bad range yields nothing. */
export function datesIn(startDate: string, endDate: string): string[] {
  if (calendarSpan(startDate, endDate) === 0) return [];

  const out: string[] = [];
  let cursor = startDate;
  // 400 is a year and a bit. A range longer than that is a data-entry mistake
  // and is refused by `spanProblem` before anybody counts it.
  for (let guard = 0; guard < 400 && cursor <= endDate; guard += 1) {
    out.push(cursor);
    cursor = addDays(cursor, 1);
  }
  return out;
}

export interface LeaveDayCount {
  /** What the request costs the person's entitlement. */
  days: number;
  /** Gazetted holidays inside the range, counted or not. */
  holidayDays: number;
  /** True when those holidays were left out of `days`. */
  skipped: boolean;
}

/**
 * What a range costs, given the campus's holiday rule.
 *
 * `holidayDates` is the person's own calendar — `staffHolidayDates` in
 * `lib/staff-calendar-queries.ts` — not the raw holiday table, because a
 * holiday HR has cancelled for teaching staff is a working day for them.
 */
export function countLeaveDays(
  startDate: string,
  endDate: string,
  holidayDates: ReadonlySet<string>,
  span: HolidaySpan,
): LeaveDayCount {
  const dates = datesIn(startDate, endDate);
  const holidayDays = dates.filter((date) => holidayDates.has(date)).length;

  return {
    days: span === 'skip' ? dates.length - holidayDays : dates.length,
    holidayDays,
    skipped: span === 'skip' && holidayDays > 0,
  };
}

/** The longest range anybody may apply for in one request. */
export const MAX_LEAVE_SPAN_DAYS = 365;

/** Why this range cannot be applied for at all, or null. */
export function spanProblem(startDate: string, endDate: string): string | null {
  const span = calendarSpan(startDate, endDate);
  if (span === 0) {
    return 'Enter a start and an end date, with the end on or after the start.';
  }
  if (span > MAX_LEAVE_SPAN_DAYS) {
    return 'A single request cannot cover more than a year. Apply for it in parts.';
  }
  return null;
}

/**
 * The holiday refusal — decision 11, and it is deliberately narrow.
 *
 * **A one-day request on a gazetted holiday is refused**: the school is already
 * shut, so there is nothing to be absent from, and approving it would spend a
 * day of somebody's entitlement on a day they were never expected in.
 *
 * **A range whose first or last day is a holiday is accepted.** Somebody taking
 * the whole of Eid week off is doing something ordinary, and refusing it would
 * make them apply for two requests either side of the holiday — which is more
 * work for them, more work for the approver, and two rows where the school
 * means one. Whether those holidays *count* is the campus's setting.
 */
export function holidayProblem(
  startDate: string,
  endDate: string,
  holidayDates: ReadonlySet<string>,
  holidayNameFor?: (date: string) => string | null,
): string | null {
  if (startDate !== endDate) return null;
  if (!holidayDates.has(startDate)) return null;

  const name = holidayNameFor?.(startDate) ?? null;
  return name === null
    ? 'The school is already closed that day, so there is no leave to take.'
    : `The school is already closed that day for ${name}, so there is no leave to take.`;
}

/** A leave row as the overlap test needs it. */
export interface LeaveSpanLike {
  id: string;
  startDate: string;
  endDate: string;
  status: string;
  leaveTypeName?: string;
}

/**
 * Why this range collides with leave the person already has, or null.
 *
 * Pending counts as well as approved: two overlapping applications in a queue
 * is an approver being asked the same question twice with no way to tell which
 * answer the person wanted. Rejected and cancelled rows are ignored — those are
 * history, and a day refused in March is free again.
 */
export function overlapProblem(
  startDate: string,
  endDate: string,
  existing: readonly LeaveSpanLike[],
  excludeId: string | null = null,
): string | null {
  const clash = existing.find(
    (row) =>
      row.id !== excludeId &&
      (row.status === 'pending' || row.status === 'approved') &&
      row.startDate <= endDate &&
      row.endDate >= startDate,
  );

  if (clash === undefined) return null;

  const what = clash.leaveTypeName === undefined ? 'leave' : clash.leaveTypeName;
  const state = clash.status === 'pending' ? 'applied for' : 'approved';

  return `They already have ${what} ${state} from ${clash.startDate} to ${clash.endDate}. Withdraw that request first, or choose other dates.`;
}

/* ------------------------------------------------------------- the quota */

/** An academic year as the pro-ration needs it. */
export interface AcademicYearLike {
  startMonth: number;
  startYear: number;
  endMonth: number;
  endYear: number;
}

/** The first and last date of an academic year, as ISO dates. */
export function academicYearRange(year: AcademicYearLike): { start: string; end: string } {
  const start = `${String(year.startYear)}-${String(year.startMonth).padStart(2, '0')}-01`;
  // Day 0 of the following month is the last day of this one, and it is the
  // only spelling that never produces `2026-09-31` — which Postgres refuses
  // outright with 22008, as `check-sprint32` found on a different query.
  const last = new Date(Date.UTC(year.endYear, year.endMonth, 0));
  return { start, end: last.toISOString().slice(0, 10) };
}

/** Half-day granularity, which is what `NUMERIC(4,1)` and payroll both hold. */
export function roundToHalf(value: number): number {
  return Math.round(value * 2) / 2;
}

export interface EntitlementInput {
  /** The head's own annual figure. 0 means uncapped — checked by hand. */
  annualQuotaDays: number;
  /** `staff.permanent_from`. Null = the whole year, see below. */
  permanentFrom: string | null;
  year: AcademicYearLike;
}

/**
 * This year's entitlement for one leave head, pro-rated from `permanent_from`.
 *
 * ── Null is the whole year, and that is the safe direction ───────────────
 * Every `staff` row in production carries null today. Reading null as "not
 * permanent, therefore nothing" would take every teacher's entitlement away on
 * the morning this deploys — silently, on a screen that had always shown a
 * number, with no event anywhere to explain it. So null means the school has
 * not started recording the date, and the person gets the head's full figure.
 *
 * A date **before** the year starts is also the full figure: they were already
 * permanent when the year opened. A date after it ends is 0 — they are not
 * permanent in this year at all.
 */
export function proratedEntitlement(input: EntitlementInput): number {
  const { annualQuotaDays, permanentFrom, year } = input;
  if (annualQuotaDays <= 0) return 0;

  const { start, end } = academicYearRange(year);
  if (permanentFrom === null || permanentFrom <= start) return annualQuotaDays;
  if (permanentFrom > end) return 0;

  const total = calendarSpan(start, end);
  const remaining = calendarSpan(permanentFrom, end);
  if (total === 0) return 0;

  return roundToHalf((annualQuotaDays * remaining) / total);
}

export interface LeaveQuota {
  /** This year's entitlement, pro-rated. */
  entitled: number;
  /** Approved days already spent this year. */
  taken: number;
  /** Days sitting in applications nobody has decided. */
  pending: number;
  /** `entitled - taken - pending`, floored at 0. */
  remaining: number;
  /** True when the head has no annual cap at all. */
  uncapped: boolean;
}

export interface QuotaInput extends EntitlementInput {
  takenDays: number;
  pendingDays: number;
}

/**
 * `{ entitled, taken, pending, remaining }` for one person and one leave head.
 *
 * Pending is subtracted as well as taken, deliberately: an approver looking at
 * a request needs to know what is left *including* the requests in front of it
 * in the queue, or three applications each inside the entitlement are approved
 * one by one into an overdraft nothing reports.
 */
export function computeQuota(input: QuotaInput): LeaveQuota {
  const entitled = proratedEntitlement(input);
  const uncapped = input.annualQuotaDays <= 0;
  const taken = roundToHalf(input.takenDays);
  const pending = roundToHalf(input.pendingDays);

  return {
    entitled,
    taken,
    pending,
    remaining: uncapped ? 0 : Math.max(0, roundToHalf(entitled - taken - pending)),
    uncapped,
  };
}

/** `2.5 days` / `1 day`, so a refusal reads like a sentence. */
export function dayLabel(value: number): string {
  return `${String(value)} day${value === 1 ? '' : 's'}`;
}

/**
 * Why this request exceeds what is left — with the numbers in the sentence, or
 * null.
 *
 * An uncapped head (`annual_quota_days = 0`, which is what Unpaid Leave is)
 * never refuses. That is the head a school uses precisely when somebody is out
 * of entitlement, and refusing it would leave them with nothing to apply for.
 */
export function quotaProblem(
  quota: LeaveQuota,
  days: number,
  leaveTypeName: string,
): string | null {
  if (quota.uncapped) return null;
  if (days <= quota.remaining) return null;

  const spent =
    quota.pending > 0
      ? `${dayLabel(quota.taken)} taken and ${dayLabel(quota.pending)} awaiting a decision`
      : `${dayLabel(quota.taken)} taken`;

  return `${leaveTypeName} allows ${dayLabel(quota.entitled)} this year, with ${spent}. That leaves ${dayLabel(quota.remaining)}, and this request is ${dayLabel(days)}.`;
}

/** What the form prints under the day count: "5 days, 1 holiday not counted". */
export function countedSentence(count: LeaveDayCount): string {
  if (count.days === 0) return 'Enter both dates.';
  if (count.holidayDays === 0) return `${dayLabel(count.days)}.`;

  return count.skipped
    ? `${dayLabel(count.days)} — ${dayLabel(count.holidayDays)} the school is closed ${count.holidayDays === 1 ? 'is' : 'are'} not counted.`
    : `${dayLabel(count.days)}, including ${dayLabel(count.holidayDays)} the school is closed.`;
}
