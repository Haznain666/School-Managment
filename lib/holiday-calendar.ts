/**
 * What is a working day, and which days are one holiday.
 *
 * ── Free of the database, deliberately ───────────────────────────────────
 * No `server-only`, no Drizzle import. The month grid renders in the browser
 * and the payroll's working-day count is computed on the server, and if the two
 * disagreed about whether the third Saturday is off, one of them would be
 * docking a teacher for a day the other says the school was shut. One function,
 * two callers, no drift.
 *
 * ── The three rules, in the order they are applied ───────────────────────
 *   1. Sunday is always off. Not configurable, and no school has asked.
 *   2. Saturday is off **unless its ordinal is in this person's set**. The
 *      requirement is per role *and* per person — teachers every Saturday, the
 *      principal on two, four coordinators on one distinct Saturday each — so
 *      the answer has to name *which* Saturdays and not how many.
 *   3. A holiday date is off for everybody, whatever the roster says.
 */

/** A holiday as this module needs it: a name and a closed range of dates. */
export interface HolidayRange {
  id?: string;
  name: string;
  /** `YYYY-MM-DD`, inclusive. */
  startsOn: string;
  /** `YYYY-MM-DD`, inclusive. Equal to `startsOn` for a one-day holiday. */
  endsOn: string;
  branchId?: string | null;
  isTentative?: boolean;
}

/** Adjacent or overlapping holidays, folded into one closure. */
export interface HolidayBlock {
  startsOn: string;
  endsOn: string;
  /** Every holiday inside it, in date order. Usually one; sometimes two. */
  holidays: HolidayRange[];
}

const DAY_MS = 86_400_000;

/** `YYYY-MM-DD` → a UTC `Date` at midnight, with no timezone in the answer. */
export function parseIsoDate(value: string): Date {
  return new Date(`${value}T00:00:00Z`);
}

/** A UTC `Date` → `YYYY-MM-DD`. */
export function toIsoDate(value: Date): string {
  return value.toISOString().slice(0, 10);
}

/** `YYYY-MM-DD` plus `days`, staying in UTC so a DST boundary cannot shift it. */
export function addDays(value: string, days: number): string {
  return toIsoDate(new Date(parseIsoDate(value).getTime() + days * DAY_MS));
}

/**
 * Which Saturday of its own month this date is: 1 to 5.
 *
 * ── 5 is real and is the trap ────────────────────────────────────────────
 * A month beginning on a Saturday has five of them, and so does a 31-day month
 * beginning on a Friday or Thursday. A policy that could only name four would
 * make every fifth Saturday a day off for the whole school — eight or nine days
 * a year, with nothing on any screen saying why.
 *
 * Returns 0 for a date that is not a Saturday, which is what lets a caller
 * write `ordinals.includes(saturdayOrdinal(date))` without a guard: no policy
 * contains 0.
 */
export function saturdayOrdinal(date: string): number {
  const parsed = parseIsoDate(date);
  if (parsed.getUTCDay() !== 6) return 0;

  return Math.floor((parsed.getUTCDate() - 1) / 7) + 1;
}

/**
 * The Saturdays this person actually works, given their own answer and their
 * role's.
 *
 * ⚠ `??`, never `||`. `staff.saturday_ordinals` distinguishes **null** — no
 * override, use the role — from **`[]`** — an override saying *no Saturdays*,
 * for the teacher excused from a rota her colleagues are on. `||` treats the
 * empty array as truthy, so it happens to be correct here; it is written `??`
 * anyway because the next person to touch this will reach for `||` on a
 * *number* field and be wrong, and one convention is easier to keep than two.
 */
export function effectiveSaturdayOrdinals(
  own: readonly number[] | null | undefined,
  rolePolicy: readonly number[] | null | undefined,
): number[] {
  if (own !== null && own !== undefined) return [...own];
  if (rolePolicy !== null && rolePolicy !== undefined) return [...rolePolicy];

  // No policy set at all. Nobody is called in on a Saturday, which is the safe
  // reading of "the school has not decided": a wrong "off" is a teacher not
  // docked, a wrong "on" is a teacher docked for a day nobody told them about.
  return [];
}

/**
 * Every date a set of holiday rows closes, indexed by `YYYY-MM-DD`.
 *
 * Bounded by `from`/`to` so a school with fifteen years of history does not
 * expand all of it to draw one month. A date can carry more than one holiday —
 * Eid and a national day landing together is exactly the case the notice text
 * has to handle — so the value is an array.
 */
export function expandHolidays(
  rows: readonly HolidayRange[],
  from: string,
  to: string,
): Map<string, HolidayRange[]> {
  const byDate = new Map<string, HolidayRange[]>();

  for (const row of rows) {
    let cursor = row.startsOn < from ? from : row.startsOn;
    const last = row.endsOn > to ? to : row.endsOn;

    while (cursor <= last) {
      byDate.set(cursor, [...(byDate.get(cursor) ?? []), row]);
      cursor = addDays(cursor, 1);
    }
  }

  return byDate;
}

/**
 * Whether the school is open to this person on this date.
 *
 * `holidayDates` is the expansion above, or any set of `YYYY-MM-DD` — a `Set`
 * would do and a `Map` is what `expandHolidays` returns, so both are accepted.
 */
export function isWorkingDay(
  date: string,
  holidayDates: ReadonlySet<string> | ReadonlyMap<string, unknown>,
  saturdayOrdinals: readonly number[],
): boolean {
  if (holidayDates.has(date)) return false;

  const weekday = parseIsoDate(date).getUTCDay();
  if (weekday === 0) return false;
  if (weekday !== 6) return true;

  return saturdayOrdinals.includes(saturdayOrdinal(date));
}

/**
 * Adjacent or overlapping holidays, folded into one block.
 *
 * ── Why this exists, in one example ──────────────────────────────────────
 * *"The school will be closed from Friday 30 October to Sunday 1 November for
 * Eid Milad-un-Nabi and Kashmir Day."* One notice, not three, and not two —
 * which means the merge has to cross **a month boundary** and **two different
 * holidays**, because that sentence does both. A merge keyed on the holiday, or
 * one that compared `getMonth()`, would send three.
 *
 * Two ranges merge when the second starts on or before the day after the first
 * ends. That is *adjacent*, not merely overlapping: 30–31 October and 1
 * November are separate ranges with no shared day, and they are obviously one
 * closure to anybody looking at a calendar.
 */
export function mergeConsecutive(rows: readonly HolidayRange[]): HolidayBlock[] {
  if (rows.length === 0) return [];

  const sorted = [...rows].sort(
    (left, right) =>
      left.startsOn.localeCompare(right.startsOn) ||
      left.endsOn.localeCompare(right.endsOn),
  );

  const blocks: HolidayBlock[] = [];

  for (const row of sorted) {
    const current = blocks[blocks.length - 1];

    if (current !== undefined && row.startsOn <= addDays(current.endsOn, 1)) {
      // `endsOn` only ever grows: a short holiday nested inside a long one must
      // not shrink the block it is inside.
      if (row.endsOn > current.endsOn) current.endsOn = row.endsOn;
      current.holidays.push(row);
      continue;
    }

    blocks.push({ startsOn: row.startsOn, endsOn: row.endsOn, holidays: [row] });
  }

  return blocks;
}

/**
 * Working days in a month, for one person's roster.
 *
 * The payroll's denominator. It arrives correct rather than defaulting to 26,
 * and the run may still override it — the number is the school's — but a school
 * that never touches it is no longer docking a teacher a twenty-sixth of their
 * salary for a month that had twenty-two working days in it.
 */
export function workingDaysInMonth(
  year: number,
  month: number,
  holidayDates: ReadonlySet<string> | ReadonlyMap<string, unknown>,
  saturdayOrdinals: readonly number[],
): number {
  const first = `${String(year)}-${String(month).padStart(2, '0')}-01`;
  const last = toIsoDate(new Date(Date.UTC(year, month, 0)));

  let count = 0;
  let cursor = first;

  while (cursor <= last) {
    if (isWorkingDay(cursor, holidayDates, saturdayOrdinals)) count += 1;
    cursor = addDays(cursor, 1);
  }

  return count;
}
