/**
 * The tabular (arithmetical) Islamic calendar, as a pure function.
 *
 * ── What this is, and what it is not ─────────────────────────────────────
 * It is a closed-form conversion between the Hijri and Gregorian calendars
 * through the Julian day number. There is no table of years to go stale, no
 * network call, and no dependency — which is the whole reason it is here rather
 * than pulled in: a school calendar that stops working in 2029 because a
 * package stopped being maintained is worse than one that is a day out.
 *
 * It is **not** the calendar Pakistan actually observes. The real dates are
 * decided by moon sighting and land within a day or two of these, in either
 * direction. That is not a rounding error to hide behind a confident date — it
 * is the reason every religious holiday this produces is written
 * `is_tentative = true`, badged on every screen, and editable by HR and by a
 * Branch Administrator. Editing the date clears the flag, because a human has
 * now said what it is.
 *
 * ── The variant: civil epoch, 15-based leap rule ─────────────────────────
 * There are several tabular variants and they differ by a day. This is the
 * **civil** epoch — 1 Muharram 1 AH = Friday 16 July 622 CE, Julian day
 * 1948440 — with the *Kuwaiti* / 15-based leap sequence, which is the one
 * almost every implementation of "the tabular Islamic calendar" means. Changing
 * either constant moves every date this file produces by a day or more, which
 * is why `check-sprint27` asserts against known Gregorian dates rather than
 * against the arithmetic.
 *
 * Deliberately free of `server-only` and of any database import: the seed
 * dialog previews exactly the rows the route will write, and it can only do
 * that if the same function answers in the browser and on the server.
 */

/** 1 Muharram 1 AH in the civil variant: Friday 16 July 622 CE. */
const ISLAMIC_EPOCH = 1948440;

/** Days in a 30-year tabular cycle: 19 common years of 354 and 11 leap of 355. */
const DAYS_PER_CYCLE = 10631;

export interface IslamicDate {
  year: number;
  /** 1–12. 1 is Muharram, 9 is Ramadan, 10 is Shawwal, 12 is Dhu al-Hijjah. */
  month: number;
  day: number;
}

export const ISLAMIC_MONTH_NAMES: readonly string[] = [
  'Muharram',
  'Safar',
  'Rabi al-Awwal',
  'Rabi al-Thani',
  'Jumada al-Awwal',
  'Jumada al-Thani',
  'Rajab',
  'Shaban',
  'Ramadan',
  'Shawwal',
  'Dhu al-Qadah',
  'Dhu al-Hijjah',
];

/**
 * Gregorian → Julian day number, for a proleptic Gregorian calendar.
 *
 * The standard Fliegel–Van Flandern expression, integer arithmetic throughout.
 * `Math.trunc` rather than `Math.floor` is wrong here for negative years and
 * right for none this product will ever see; `Math.floor` is used anyway
 * because being correct for 1 CE costs nothing.
 */
function gregorianToJdn(year: number, month: number, day: number): number {
  const a = Math.floor((14 - month) / 12);
  const y = year + 4800 - a;
  const m = month + 12 * a - 3;

  return (
    day +
    Math.floor((153 * m + 2) / 5) +
    365 * y +
    Math.floor(y / 4) -
    Math.floor(y / 100) +
    Math.floor(y / 400) -
    32045
  );
}

/** Julian day number → Gregorian `{ year, month, day }`. */
function jdnToGregorian(jdn: number): { year: number; month: number; day: number } {
  const a = jdn + 32044;
  const b = Math.floor((4 * a + 3) / 146097);
  const c = a - Math.floor((146097 * b) / 4);
  const d = Math.floor((4 * c + 3) / 1461);
  const e = c - Math.floor((1461 * d) / 4);
  const m = Math.floor((5 * e + 2) / 153);

  return {
    day: e - Math.floor((153 * m + 2) / 5) + 1,
    month: m + 3 - 12 * Math.floor(m / 10),
    year: 100 * b + d - 4800 + Math.floor(m / 10),
  };
}

/**
 * An Islamic date → the Julian day number of its first moment.
 *
 * The month term is `ceil(29.5 × (month − 1))`, which is what makes odd months
 * 30 days and even months 29 in the tabular scheme. The year term spreads the
 * eleven leap days of a 30-year cycle by `(11y + 3) / 30`.
 */
export function islamicToJdn(year: number, month: number, day: number): number {
  return (
    day +
    Math.ceil(29.5 * (month - 1)) +
    (year - 1) * 354 +
    Math.floor((3 + 11 * year) / 30) +
    ISLAMIC_EPOCH -
    1
  );
}

/** The Gregorian date an Islamic one falls on, as `YYYY-MM-DD`. */
export function islamicToGregorian(year: number, month: number, day: number): string {
  const { year: gy, month: gm, day: gd } = jdnToGregorian(islamicToJdn(year, month, day));

  return `${String(gy).padStart(4, '0')}-${String(gm).padStart(2, '0')}-${String(gd).padStart(2, '0')}`;
}

/** The Islamic date a Gregorian one falls on. */
export function gregorianToIslamic(
  year: number,
  month: number,
  day: number,
): IslamicDate {
  const jdn = gregorianToJdn(year, month, day);
  const elapsed = jdn - ISLAMIC_EPOCH;

  // The cycle the date falls in, then the year within it. Solving the year
  // directly from `elapsed` is possible and unreadable; two steps are cheap and
  // one of them is a plain division.
  const cycle = Math.floor(elapsed / DAYS_PER_CYCLE);
  let remaining = elapsed - cycle * DAYS_PER_CYCLE;
  let yearInCycle = 1;

  while (yearInCycle <= 30) {
    const length = isIslamicLeapYear(yearInCycle) ? 355 : 354;
    if (remaining < length) break;
    remaining -= length;
    yearInCycle += 1;
  }

  const islamicYear = cycle * 30 + yearInCycle;

  let islamicMonth = 1;
  while (islamicMonth < 12) {
    const length = islamicMonth % 2 === 1 ? 30 : 29;
    if (remaining < length) break;
    remaining -= length;
    islamicMonth += 1;
  }

  return { year: islamicYear, month: islamicMonth, day: remaining + 1 };
}

/**
 * Whether a year in the 30-year cycle carries the extra day.
 *
 * The 15-based (Kuwaiti) sequence: 2, 5, 7, 10, 13, 16, 18, 21, 24, 26, 29.
 * The 16-based variant swaps 16 for 15 and shifts a decade of dates by a day —
 * `check-sprint27` is what stops that being chosen by accident.
 */
export function isIslamicLeapYear(year: number): boolean {
  const inCycle = ((year - 1) % 30) + 1;
  return [2, 5, 7, 10, 13, 16, 18, 21, 24, 26, 29].includes(inCycle);
}

/**
 * Every Islamic year that touches a Gregorian one.
 *
 * A Hijri year is about eleven days shorter than a Gregorian one, so a
 * Gregorian year almost always overlaps two of them and occasionally three —
 * which is why Ramadan can fall twice in one Gregorian year, and why a seed
 * that assumed one Hijri year would silently miss an Eid.
 */
export function islamicYearsTouching(gregorianYear: number): number[] {
  const first = gregorianToIslamic(gregorianYear, 1, 1).year;
  const last = gregorianToIslamic(gregorianYear, 12, 31).year;

  const years: number[] = [];
  for (let year = first; year <= last; year += 1) years.push(year);
  return years;
}
