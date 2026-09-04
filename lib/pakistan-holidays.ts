import { islamicToGregorian, islamicYearsTouching } from './islamic-calendar';

import type { HolidayType } from '@/db/schema/holidays';

/**
 * Pakistan's public holidays for a Gregorian year (Sprint 27, item B2).
 *
 * ── Free of the database and of `server-only`, like `academic-year-runs.ts` ─
 * The seed dialog previews **exactly** the rows the route will write, and the
 * only way to guarantee that is for both to call this function. A preview
 * computed differently from the write is a preview that is occasionally a lie,
 * and the one time it matters is the one time somebody trusted it.
 *
 * ── Every Islamic holiday is tentative, without exception ────────────────
 * The dates come from the tabular Islamic calendar in `lib/islamic-calendar.ts`,
 * which is an arithmetical approximation. Pakistan decides its religious
 * holidays by **moon sighting**, typically landing within a day either side.
 *
 * That is not a defect to paper over with a confident date. It is the whole
 * reason the product owner asked for HR and the Branch Administrator to be able
 * to move them, and it is why:
 *
 *   · every religious row carries `isTentative: true`;
 *   · every screen showing one badges it *"Tentative — confirm the date"*;
 *   · editing the date clears the flag, because a human has now said what it
 *     is;
 *   · the seed **never overwrites** a row a school has already edited.
 *
 * The fixed-date national holidays carry `isTentative: false`, because 14
 * August is 14 August.
 *
 * ── What is deliberately not here ────────────────────────────────────────
 * Chaand Raat, Youm-e-Takbir, and the days a government announces two weeks
 * ahead as a one-off. A catalogue that guesses at those would be wrong more
 * often than it was right, and a school adds a day in two clicks. This is the
 * list a school would otherwise type in every January.
 */

export interface SeedHoliday {
  name: string;
  /** `YYYY-MM-DD`, inclusive. */
  startsOn: string;
  /** `YYYY-MM-DD`, inclusive. Equal to `startsOn` for a one-day holiday. */
  endsOn: string;
  holidayType: HolidayType;
  isTentative: boolean;
}

/** Fixed-date national holidays: month, day, name. */
const FIXED: ReadonlyArray<{ month: number; day: number; name: string }> = [
  { month: 2, day: 5, name: 'Kashmir Solidarity Day' },
  { month: 3, day: 23, name: 'Pakistan Day' },
  { month: 5, day: 1, name: 'Labour Day' },
  { month: 8, day: 14, name: 'Independence Day' },
  { month: 11, day: 9, name: 'Iqbal Day' },
  { month: 12, day: 25, name: 'Quaid-e-Azam Day & Christmas' },
];

/**
 * Islamic holidays, as an Islamic month and day plus a length.
 *
 * `days` is the *number of days*, so Eid-ul-Fitr's `{ month: 10, day: 1, days:
 * 3 }` is 1–3 Shawwal. The end date is derived in Gregorian terms from the
 * start rather than by converting `day + days - 1`, because the Islamic month
 * can end in between and 30 Dhu al-Hijjah + 1 is not 31 Dhu al-Hijjah.
 */
const ISLAMIC: ReadonlyArray<{
  month: number;
  day: number;
  days: number;
  name: string;
}> = [
  { month: 3, day: 12, days: 1, name: 'Eid Milad-un-Nabi' },
  { month: 1, day: 9, days: 2, name: 'Ashura' },
  { month: 10, day: 1, days: 3, name: 'Eid-ul-Fitr' },
  { month: 12, day: 10, days: 3, name: 'Eid-ul-Adha' },
];

const DAY_MS = 86_400_000;

/** `YYYY-MM-DD` plus n days, in UTC so no timezone can shift it. */
function plusDays(iso: string, days: number): string {
  return new Date(new Date(`${iso}T00:00:00Z`).getTime() + days * DAY_MS)
    .toISOString()
    .slice(0, 10);
}

/**
 * The year's catalogue, in date order.
 *
 * ── Why the Islamic side iterates over *years that touch* ────────────────
 * A Hijri year is about eleven days shorter than a Gregorian one, so a
 * Gregorian year overlaps two Hijri years and occasionally three. Computing
 * from a single Hijri year would silently drop whichever Eid fell in the other
 * one — and "silently" is the operative word: the seed would report a clean
 * run, the school would have a calendar, and one Eid would simply not be on it.
 *
 * Rows outside the requested Gregorian year are filtered out afterwards. A
 * holiday that *straddles* 31 December is kept if it starts inside the year,
 * because a three-day Eid beginning on the 30th is that year's holiday and
 * splitting it in two would produce two rows a school then has to reconcile.
 */
export function pakistanHolidaysFor(gregorianYear: number): SeedHoliday[] {
  const rows: SeedHoliday[] = [];

  for (const fixed of FIXED) {
    const iso = `${String(gregorianYear)}-${String(fixed.month).padStart(2, '0')}-${String(fixed.day).padStart(2, '0')}`;
    rows.push({
      name: fixed.name,
      startsOn: iso,
      endsOn: iso,
      holidayType: 'public',
      isTentative: false,
    });
  }

  for (const islamicYear of islamicYearsTouching(gregorianYear)) {
    for (const holiday of ISLAMIC) {
      const startsOn = islamicToGregorian(islamicYear, holiday.month, holiday.day);
      if (!startsOn.startsWith(String(gregorianYear))) continue;

      rows.push({
        name: holiday.name,
        startsOn,
        endsOn: plusDays(startsOn, holiday.days - 1),
        holidayType: 'religious',
        // Without exception. See the docblock.
        isTentative: true,
      });
    }
  }

  return rows.sort((left, right) => left.startsOn.localeCompare(right.startsOn));
}
