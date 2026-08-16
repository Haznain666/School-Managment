import type { AttendanceStatus } from '@/db/schema';

/**
 * `lib/attendance-calendar.ts` — a month of attendance as a grid a parent reads.
 *
 * ── Why a calendar and not the list that was here before ─────────────────
 * A parent's question is not "which days was my child absent" but "is there a
 * pattern". A list answers the first; only a grid answers the second, and every
 * Monday in a column is what makes "off sick every Monday" visible at all.
 *
 * ── Dependency-free and pure, deliberately ───────────────────────────────
 * No database import, no `server-only`, no date library. `SPRINTS.md` §0.1 pins
 * the dependency list, and the arithmetic here is the part most likely to be
 * wrong in a way that renders perfectly: an off-by-one in the leading blanks
 * shifts every date by a day and the grid still looks like a calendar. Being
 * pure is what lets `scripts/check-portals.ts` assert it with no database.
 *
 * ── Dates are strings throughout ─────────────────────────────────────────
 * `YYYY-MM-DD`, the form the `date` columns hold, compared as strings. A `Date`
 * would drag the server's timezone into a value that has none: attendance is
 * recorded against a school day, and `new Date('2026-08-16')` is midnight UTC,
 * which is the 15th in half the world. Every helper here does the arithmetic on
 * the parts rather than reconstituting a Date and asking it for a day.
 */

/** One cell of the grid. `null` status = school day with nothing recorded. */
export interface CalendarDay {
  /** `YYYY-MM-DD`. */
  date: string;
  dayOfMonth: number;
  status: AttendanceStatus | null;
  notes: string | null;
  /** Saturday or Sunday. Drawn quietly; not counted as a missed day. */
  isWeekend: boolean;
  /** Later than today. A future date with no record is not a gap. */
  isFuture: boolean;
}

/** A month, padded to whole weeks starting Monday. `null` = padding. */
export interface CalendarMonth {
  year: number;
  /** 1–12, not the 0-based month a `Date` uses. */
  month: number;
  label: string;
  /** Seven per row, first row padded with nulls back to Monday. */
  weeks: (CalendarDay | null)[][];
  /** `YYYY-MM` of the month before and after, for the two arrows. */
  previous: string;
  next: string;
}

const MONTH_NAMES = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
] as const;

/** Column headings, Monday first — the school week in this market. */
export const WEEKDAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] as const;

/** Days in a month, 1-based month. Handles February without a lookup table. */
export function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/**
 * Weekday of a date, 0 = Monday … 6 = Sunday.
 *
 * `getUTCDay()` is 0 = Sunday, so this shifts by one and wraps. Monday-first
 * matches `timetable_entries.day_of_week` and the report queries, and keeping
 * one convention across the codebase is worth the six characters.
 */
export function mondayIndex(date: string): number {
  const [year, month, day] = date.split('-').map((part) => Number.parseInt(part, 10));
  const weekday = new Date(Date.UTC(year ?? 1970, (month ?? 1) - 1, day ?? 1)).getUTCDay();
  return (weekday + 6) % 7;
}

/** `YYYY-MM` for a month offset from another, handling the year boundary. */
export function shiftMonth(year: number, month: number, delta: number): string {
  // Work in absolute months so December → January needs no special case.
  const absolute = year * 12 + (month - 1) + delta;
  const shiftedYear = Math.floor(absolute / 12);
  const shiftedMonth = (absolute % 12) + 1;
  return `${shiftedYear}-${String(shiftedMonth).padStart(2, '0')}`;
}

/** Parses `YYYY-MM`, falling back to the given month when it is malformed. */
export function parseMonthParam(
  raw: string | undefined,
  fallback: { year: number; month: number },
): { year: number; month: number } {
  if (raw === undefined || !/^\d{4}-\d{2}$/.test(raw)) return fallback;

  const year = Number.parseInt(raw.slice(0, 4), 10);
  const month = Number.parseInt(raw.slice(5, 7), 10);

  // A stale bookmark showing `2026-13` gets this month rather than a 500 —
  // the same rule the report filters follow.
  if (month < 1 || month > 12) return fallback;
  return { year, month };
}

/** The first and last day of a month, as the range a query wants. */
export function monthBounds(year: number, month: number): { from: string; to: string } {
  const mm = String(month).padStart(2, '0');
  const last = String(daysInMonth(year, month)).padStart(2, '0');
  return { from: `${year}-${mm}-01`, to: `${year}-${mm}-${last}` };
}

/**
 * Builds the grid.
 *
 * `records` may hold at most one row per date — the unique key on
 * (location, date, student) guarantees it — so a later row silently winning is
 * not a case that can arise. `today` is passed in rather than read here so the
 * function stays pure and the check script can pin it.
 */
export function buildCalendarMonth(
  year: number,
  month: number,
  records: readonly { date: string; status: AttendanceStatus; notes: string | null }[],
  today: string,
): CalendarMonth {
  const byDate = new Map(records.map((record) => [record.date, record]));
  const mm = String(month).padStart(2, '0');
  const total = daysInMonth(year, month);

  const days: CalendarDay[] = [];
  for (let day = 1; day <= total; day += 1) {
    const date = `${year}-${mm}-${String(day).padStart(2, '0')}`;
    const record = byDate.get(date);
    const weekday = mondayIndex(date);

    days.push({
      date,
      dayOfMonth: day,
      status: record?.status ?? null,
      notes: record?.notes ?? null,
      isWeekend: weekday >= 5,
      isFuture: date > today,
    });
  }

  // Pad the front back to Monday and the tail forward to Sunday, so every row
  // has seven cells and the columns line up under their headings.
  const leading = days.length === 0 ? 0 : mondayIndex(days[0]!.date);
  const cells: (CalendarDay | null)[] = [...Array<null>(leading).fill(null), ...days];
  while (cells.length % 7 !== 0) cells.push(null);

  const weeks: (CalendarDay | null)[][] = [];
  for (let index = 0; index < cells.length; index += 7) {
    weeks.push(cells.slice(index, index + 7));
  }

  return {
    year,
    month,
    label: `${MONTH_NAMES[month - 1]} ${year}`,
    weeks,
    previous: shiftMonth(year, month, -1),
    next: shiftMonth(year, month, 1),
  };
}
