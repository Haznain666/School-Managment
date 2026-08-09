/**
 * Bands to letters, and marks to percentages.
 *
 * Deliberately dependency-free — no `server-only`, no database import — for the
 * same reason `lib/permissions.ts` is: the grading editor renders the school's
 * own bands in the browser and must resolve a preview grade with exactly the
 * rule the report card will use on the server. Two implementations of "what
 * grade is 79.5%" is one implementation too many.
 *
 * Marks arrive from Postgres as NUMERIC strings. Everything here parses to a
 * number once, at the edge, and never adds two strings — the same discipline
 * `lib/money.ts` imposes, for the same reason: a report card that computes a
 * different total than the tabulation sheet is worse than one that computes
 * none.
 */

/** A band as the resolver needs it. Percentages and GPA already parsed. */
export interface ResolvedBand {
  label: string;
  minPercentage: number;
  maxPercentage: number;
  gpa: number | null;
  remark: string | null;
}

/**
 * Parses a mark into a number.
 *
 * Takes `unknown` on purpose: the two places marks come from are a NUMERIC
 * column (a string) and a request body (anything at all), and a narrower
 * signature would only mean every route casting on the way in. Anything that
 * is not a finite number or a string spelling one becomes null.
 *
 * Returns null rather than 0 for the unparseable case. Zero is a real mark —
 * a child who sat the paper and scored nothing — so it cannot double as
 * "no answer here" the way it can in a money column.
 */
export function toMark(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;

  const numeric =
    typeof value === 'number'
      ? value
      : typeof value === 'string'
        ? Number.parseFloat(value)
        : Number.NaN;

  return Number.isFinite(numeric) ? numeric : null;
}

/** A mark as the string a NUMERIC(6,2) column expects. */
export function markToNumeric(value: number): string {
  return value.toFixed(2);
}

/** Marks as a percentage of the maximum, to one decimal place. */
export function percentageOf(obtained: number, maximum: number): number {
  if (!Number.isFinite(maximum) || maximum <= 0) return 0;
  return Math.round((obtained / maximum) * 1000) / 10;
}

/**
 * The band a percentage falls in, or null when the scheme covers nothing.
 *
 * ── The rule, and why it is not a literal range test ─────────────────────
 * Schools write their bands as "80–89, 70–79, 60–69". Taken literally that
 * leaves 89.5 in no band at all, and a report card with a blank grade for the
 * second-best mark in the class is the kind of defect that gets found at the
 * prize-giving. So: bands are sorted high to low and the first whose *minimum*
 * the score reaches wins. The maximum is only ever used to order and to
 * display; it never excludes.
 *
 * A score below every band's minimum returns null, which the report card prints
 * as a dash. That is a real state — a school whose lowest band starts at 33 has
 * said what it thinks of 20% — and inventing an "F" for it would be putting
 * words in the school's mouth.
 */
export function resolveBand(
  percentage: number,
  bands: readonly ResolvedBand[],
): ResolvedBand | null {
  if (!Number.isFinite(percentage)) return null;

  const ordered = [...bands].sort((a, b) => b.minPercentage - a.minPercentage);

  for (const band of ordered) {
    if (percentage >= band.minPercentage) return band;
  }

  return null;
}

/**
 * Bands highest first — the order they are shown and resolved in.
 *
 * Generic so a caller carrying its own id alongside the band keeps its type
 * rather than being widened to `ResolvedBand` and cast back.
 */
export function sortBands<T extends ResolvedBand>(bands: readonly T[]): T[] {
  return [...bands].sort((a, b) => b.minPercentage - a.minPercentage);
}

/**
 * What is wrong with a set of bands, or null when they are usable.
 *
 * Overlaps are reported rather than refused by a constraint: a school
 * mid-edit will legitimately have two bands overlapping for a few seconds, and
 * a database that rejected the intermediate state would make the editor
 * unusable. The editor shows this; the API refuses a save that still has it.
 */
export function bandsProblem(bands: readonly ResolvedBand[]): string | null {
  if (bands.length === 0) return 'Add at least one band.';

  for (const band of bands) {
    if (band.label.trim() === '') return 'Every band needs a label.';
    if (!Number.isFinite(band.minPercentage) || !Number.isFinite(band.maxPercentage)) {
      return 'Every band needs a minimum and a maximum percentage.';
    }
    if (band.minPercentage < 0 || band.maxPercentage > 100) {
      return 'Percentages must be between 0 and 100.';
    }
    if (band.minPercentage > band.maxPercentage) {
      return `"${band.label}" starts above where it ends.`;
    }
  }

  const ordered = sortBands(bands);
  for (let index = 1; index < ordered.length; index += 1) {
    const higher = ordered[index - 1];
    const lower = ordered[index];
    if (higher === undefined || lower === undefined) continue;

    if (lower.maxPercentage >= higher.minPercentage) {
      return `"${lower.label}" overlaps "${higher.label}".`;
    }
  }

  const labels = new Set(bands.map((band) => band.label.trim().toLowerCase()));
  if (labels.size !== bands.length) return 'Two bands share a label.';

  return null;
}

/**
 * Parses the band list a scheme is created or replaced with.
 *
 * Returns the bands, or the message to show the person who sent them. It lives
 * here rather than in either route because both the create and the replace
 * path need it and a Next route module may only export its handlers — an
 * exported helper there is a build error, not a style question.
 */
export function parseBandsInput(raw: unknown): ResolvedBand[] | string {
  if (!Array.isArray(raw)) return 'Send the bands as a list.';
  if (raw.length > 20) return 'Twenty bands is already more than any school uses.';

  const bands: ResolvedBand[] = [];

  for (const entry of raw as Record<string, unknown>[]) {
    const label = typeof entry['label'] === 'string' ? entry['label'].trim() : '';
    const min = toMark(entry['minPercentage']);
    const max = toMark(entry['maxPercentage']);
    const gpa = toMark(entry['gpa']);
    const remarkRaw = entry['remark'];
    const remark =
      typeof remarkRaw === 'string' && remarkRaw.trim() !== '' ? remarkRaw.trim() : null;

    if (label === '' || label.length > 12) {
      return 'Every band needs a label of 12 characters or fewer.';
    }
    if (min === null || max === null) {
      return 'Every band needs a minimum and a maximum percentage.';
    }
    if (gpa !== null && (gpa < 0 || gpa > 10)) {
      return 'A GPA must be between 0 and 10, or left blank.';
    }

    bands.push({ label, minPercentage: min, maxPercentage: max, gpa, remark });
  }

  return bands;
}

/**
 * The bands a school gets when it has never configured any.
 *
 * A starting point offered by the editor, not a fallback the resolver reaches
 * for. A school with no scheme gets no letter grades at all, and the report
 * card says so — silently grading a school's children against numbers nobody
 * at that school chose is exactly what `grading_schemes` exists to prevent.
 * These match the common Pakistani Matric ladder.
 */
export const SUGGESTED_BANDS: readonly ResolvedBand[] = [
  { label: 'A+', minPercentage: 80, maxPercentage: 100, gpa: 4, remark: 'Outstanding' },
  { label: 'A', minPercentage: 70, maxPercentage: 79.99, gpa: 3.7, remark: 'Excellent' },
  { label: 'B', minPercentage: 60, maxPercentage: 69.99, gpa: 3, remark: 'Very good' },
  { label: 'C', minPercentage: 50, maxPercentage: 59.99, gpa: 2.5, remark: 'Good' },
  { label: 'D', minPercentage: 40, maxPercentage: 49.99, gpa: 2, remark: 'Satisfactory' },
  { label: 'E', minPercentage: 33, maxPercentage: 39.99, gpa: 1, remark: 'Pass' },
  /*
   * The ladder has to reach the floor.
   *
   * Without this band a mark below 33 falls outside every band and the resolver
   * — correctly, by the "no invented grade" rule — prints a dash. That rule is
   * about a school which has configured *nothing*: a dash then means "this
   * school does not grade", which is honest. It is the wrong answer for a
   * school that has configured a ladder and simply had a child fail, where a
   * blank grade beside 22% reads as a broken report card rather than as a fail.
   *
   * Found in the dress rehearsal: a card printed `Mathematics 22% —` next to
   * `Science 71% A`. Adding F to what the editor *suggests* changes nothing
   * about the resolver, and a school that would rather leave failures blank
   * simply deletes the band.
   */
  { label: 'F', minPercentage: 0, maxPercentage: 32.99, gpa: 0, remark: 'Fail' },
];

/**
 * Positions from a list of totals, sharing a position on a tie.
 *
 * Ties share the position and the next one is skipped — two firsts and then a
 * third, never two firsts and a second. Schools award a prize per position, so
 * the rank has to survive being read out loud.
 *
 * Students with no marks at all are given no position rather than last place:
 * a child who joined the school after the exam did not come bottom of it.
 */
export function assignPositions<T>(
  rows: readonly T[],
  totalOf: (row: T) => number | null,
): Map<T, number | null> {
  const positions = new Map<T, number | null>();

  const ranked = rows
    .filter((row) => totalOf(row) !== null)
    .sort((a, b) => (totalOf(b) ?? 0) - (totalOf(a) ?? 0));

  let position = 0;
  let seen = 0;
  let previous: number | null = null;

  for (const row of ranked) {
    const total = totalOf(row);
    seen += 1;
    if (previous === null || total !== previous) {
      position = seen;
      previous = total;
    }
    positions.set(row, position);
  }

  for (const row of rows) {
    if (!positions.has(row)) positions.set(row, null);
  }

  return positions;
}

/** `3` -> `3rd`. For printing a position on a report card. */
export function ordinal(position: number): string {
  const tens = position % 100;
  if (tens >= 11 && tens <= 13) return `${position}th`;

  switch (position % 10) {
    case 1:
      return `${position}st`;
    case 2:
      return `${position}nd`;
    case 3:
      return `${position}rd`;
    default:
      return `${position}th`;
  }
}

/** A mark for screen and paper: `72` not `72.00`, `72.5` kept. */
export function formatMark(value: number | null): string {
  if (value === null) return '—';
  return Number.isInteger(value) ? String(value) : value.toFixed(2).replace(/0$/, '');
}

/** A percentage for screen and paper. */
export function formatPercentage(value: number | null): string {
  if (value === null) return '—';
  return `${Math.round(value * 10) / 10}%`;
}
