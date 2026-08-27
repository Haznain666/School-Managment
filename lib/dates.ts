/**
 * How a date reads on screen, everywhere in this product.
 *
 * ── One format, and why it is this one ───────────────────────────────────
 * `02-Aug-2026`. A Pakistani school office writes `02-08-2026` and a browser
 * left to `toLocaleDateString()` writes whatever the operator's machine is set
 * to — which on the same screen, in the same session, is `8/2/2026` for one
 * user and `02/08/2026` for the next. Those two strings are the same day and
 * the opposite day, and nothing on the page says which. Spelling the month
 * removes the ambiguity without asking anybody to configure anything.
 *
 * ── A `date` column is a calendar date, not an instant ───────────────────
 * `student_profiles.date_of_birth` and `fee_challans.due_date` come back from
 * postgres-js as the string `'2026-08-02'`. `new Date('2026-08-02')` reads that
 * as **UTC midnight**, so anywhere west of Greenwich it prints the first of
 * August — a birthday and a due date that are both a day early, on a screen
 * that has never been wrong for anyone in Karachi and is always wrong for
 * whoever is reviewing it from London.
 *
 * So a `YYYY-MM-DD` string is split on the hyphens and never handed to `Date`
 * at all. Anything else — a `Date`, a timestamptz string — is an instant and is
 * formatted in local time, which is what an instant means to a reader.
 *
 * ── Blank is an em dash, not an empty cell ───────────────────────────────
 * Every caller is a table cell or a definition list, and both of those need
 * something to occupy the row. `—` is what the rest of the product already
 * renders for "not recorded"; a blank reads as a rendering failure.
 *
 * Pure and dependency-free, because a print view renders on the server and a
 * `DataTable` cell renders in the browser and the two must agree exactly.
 */

/** What every function here returns for a value that is not a date. */
export const NO_DATE = '—';

/** Three letters, in the order a `Date` numbers its months. */
const SHORT_MONTHS: readonly string[] = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
];

/** A whole `date` column value, and nothing else. */
const CALENDAR_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

function pad(value: number): string {
  return value.toString().padStart(2, '0');
}

/** `2026, 8, 2` -> `02-Aug-2026`, or null when the parts name no real day. */
function assemble(year: number, month: number, day: number): string | null {
  const name = SHORT_MONTHS[month - 1];
  if (name === undefined) return null;
  if (day < 1 || day > 31) return null;

  return `${pad(day)}-${name}-${String(year)}`;
}

/**
 * The calendar-date half: a `YYYY-MM-DD` string, formatted without a timezone.
 *
 * Exported for the callers that already know they hold a column value and want
 * the null case to be their own — the print views, mostly. Most code wants
 * `formatDateOnly`, which takes whatever it has.
 */
export function formatCalendarDate(value: string): string | null {
  const parts = CALENDAR_DATE.exec(value.trim());
  if (parts === null) return null;

  return assemble(Number(parts[1]), Number(parts[2]), Number(parts[3]));
}

/** `'2026-08-02'` or a `Date` -> `02-Aug-2026`. `—` for anything absent. */
export function formatDateOnly(value: string | Date | null | undefined): string {
  if (value === null || value === undefined) return NO_DATE;

  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (trimmed === '') return NO_DATE;

    const calendar = formatCalendarDate(trimmed);
    if (calendar !== null) return calendar;

    const parsed = new Date(trimmed);
    if (Number.isNaN(parsed.getTime())) return NO_DATE;
    return formatDateOnly(parsed);
  }

  if (Number.isNaN(value.getTime())) return NO_DATE;

  return (
    assemble(value.getFullYear(), value.getMonth() + 1, value.getDate()) ?? NO_DATE
  );
}

/** `02-Aug-2026 14:30`, in the reader's own timezone. `—` for anything absent. */
export function formatDateTime(value: string | Date | null | undefined): string {
  if (value === null || value === undefined) return NO_DATE;

  if (typeof value === 'string' && value.trim() === '') return NO_DATE;

  // A bare `date` column has no time of day to show, so it degrades to the
  // date rather than inventing 00:00 — which would read as midnight, a fact
  // the column does not carry.
  if (typeof value === 'string' && CALENDAR_DATE.test(value.trim())) {
    return formatDateOnly(value);
  }

  const instant = typeof value === 'string' ? new Date(value) : value;
  if (Number.isNaN(instant.getTime())) return NO_DATE;

  const day = assemble(
    instant.getFullYear(),
    instant.getMonth() + 1,
    instant.getDate(),
  );
  if (day === null) return NO_DATE;

  return `${day} ${pad(instant.getHours())}:${pad(instant.getMinutes())}`;
}

/**
 * `8, 2026` -> `Aug 2026`. The billing period a voucher covers.
 *
 * Deliberately the short month, matching `formatDateOnly`, rather than the full
 * `August 2026` that `academicYearMonthLabel` produces for a dropdown. A filter
 * has room for the word; a table column and a printed slip do not.
 */
export function formatMonthYear(
  month: number | null | undefined,
  year: number | null | undefined,
): string {
  if (month === null || month === undefined) return NO_DATE;
  if (year === null || year === undefined) return NO_DATE;

  const name = SHORT_MONTHS[month - 1];
  if (name === undefined) return NO_DATE;

  return `${name} ${String(year)}`;
}

/**
 * The hint under every `<input type="date">` that asks for a date of birth.
 *
 * The control itself is the browser's, and its placeholder follows the
 * operator's locale — so a clerk types into `mm/dd/yyyy` on one machine and
 * `dd/mm/yyyy` on the next while the record they are creating will be read back
 * in one fixed shape. Saying so under the field is the only place that
 * mismatch can be explained.
 */
export const DATE_INPUT_HINT =
  'Day, month and year — shown as DD-MMM-YYYY once saved.';
