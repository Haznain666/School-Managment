/**
 * The closed lists an admissions form offers for religion and nationality.
 *
 * ── Why these became dropdowns ───────────────────────────────────────────
 * Both were free text. A single school's roll came back holding `Islam`,
 * `islam`, `Muslim` and `ISLAM` as four distinct religions, which makes the
 * board's own headcount — the one a Pakistani school files annually — a manual
 * reconciliation rather than a query. Neither field is one a clerk should be
 * composing prose in.
 *
 * ── Why "Other" is on both lists ─────────────────────────────────────────
 * A closed list that cannot express a real child is worse than free text: the
 * clerk picks the nearest wrong answer and the record lies. `Other` is the
 * pressure valve, and it is deliberately the last option on both.
 *
 * The columns stay `text` rather than becoming enums. A school's roll should
 * not fail to load because this list was edited, and values recorded before
 * these lists existed — or imported from a school's own spreadsheet — must
 * keep rendering. The stored value is the label.
 */

/**
 * Religions, ordered by how often a Pakistani school records them.
 *
 * Taken from the categories the Pakistan Bureau of Statistics reports in the
 * census, which is the same set a school's own returns are filed against.
 */
export const RELIGIONS = [
  'Islam',
  'Christianity',
  'Hinduism',
  'Sikhism',
  'Buddhism',
  'Zoroastrianism (Parsi)',
  'Bahá’í',
  'Ahmadi',
  'Other',
] as const;

/**
 * Nationalities. Pakistani first — it is the answer for nearly every row — then
 * the countries that actually appear on Pakistani school rolls: the diaspora
 * returning from the Gulf and the UK, and the region's own neighbours.
 */
export const NATIONALITIES = [
  'Pakistani',
  'Afghan',
  'Bangladeshi',
  'Chinese',
  'Indian',
  'Iranian',
  'Nepali',
  'Saudi Arabian',
  'Emirati',
  'Turkish',
  'British',
  'American',
  'Canadian',
  'Australian',
  'Other',
] as const;

/** The default a new student is created with, and the fallback on import. */
export const DEFAULT_NATIONALITY = 'Pakistani';

/**
 * Turns a list into `<Select>` options, keeping any stored value that predates
 * the list.
 *
 * Without this, opening an older student's record would silently re-point their
 * religion at whatever the browser picks for an unmatched `<select>` value —
 * the first option — and saving anything else on the form would write that
 * wrong answer. An unrecognised value is offered as its own option instead.
 */
export function optionsWithCurrent(
  values: readonly string[],
  current: string,
): Array<{ value: string; label: string }> {
  const options = values.map((value) => ({ value, label: value }));

  if (current !== '' && !values.includes(current)) {
    options.push({ value: current, label: current });
  }

  return options;
}
