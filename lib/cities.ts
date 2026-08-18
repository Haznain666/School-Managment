/**
 * Cities the platform currently serves. Schools and branches pick from this
 * list rather than typing free text, so filtering and reporting stay clean.
 */
export const PAKISTANI_CITIES = [
  'Karachi',
  'Lahore',
  'Islamabad',
  'Rawalpindi',
  'Faisalabad',
  'Multan',
  'Peshawar',
  'Quetta',
  'Sialkot',
  'Gujranwala',
  'Hyderabad',
] as const;

export type PakistaniCity = (typeof PAKISTANI_CITIES)[number];

export function isPakistaniCity(value: unknown): value is PakistaniCity {
  return (
    typeof value === 'string' && (PAKISTANI_CITIES as readonly string[]).includes(value)
  );
}

/**
 * Three-letter code per city, used to propose a branch code.
 *
 * ── Why the IATA-style codes rather than the first three letters ─────────
 * These are the abbreviations already in use on the ground — KHI, LHE, ISB are
 * what a Pakistani school writes on its own paperwork — so a proposed
 * `KHI-MAIN` reads as the code the school would have chosen anyway. The
 * mechanical alternative (`KAR`, `LAH`, `ISL`) collides on Rawalpindi and
 * Multan, and looks wrong to every operator who has ever booked a flight.
 *
 * A city with no entry falls back to its first three letters, which is only
 * reachable if `PAKISTANI_CITIES` gains a member and this map does not. That is
 * a proposal, not a constraint — the operator edits the field — so a slightly
 * clumsy fallback is better than a missing suggestion.
 */
const CITY_CODES: Record<PakistaniCity, string> = {
  Karachi: 'KHI',
  Lahore: 'LHE',
  Islamabad: 'ISB',
  Rawalpindi: 'RWP',
  Faisalabad: 'LYP',
  Multan: 'MUX',
  Peshawar: 'PEW',
  Quetta: 'UET',
  Sialkot: 'SKT',
  Gujranwala: 'GUJ',
  Hyderabad: 'HDD',
};

/** `Karachi` → `KHI`. Uppercase, three letters, never empty for a known city. */
export function cityCode(city: string): string {
  if (isPakistaniCity(city)) return CITY_CODES[city];

  const letters = city.replace(/[^A-Za-z]/g, '');
  return letters.slice(0, 3).toUpperCase();
}

/**
 * The branch code proposed when a city is chosen: `Karachi` → `KHI-MAIN`.
 *
 * `MAIN` because the first campus a school registers is its main one far more
 * often than not, and the field is editable — an operator adding a second
 * campus types over the suffix. Proposing nothing at all was the status quo and
 * left every operator inventing their own scheme.
 */
export function proposedBranchCode(city: string): string {
  const code = cityCode(city);
  return code === '' ? '' : `${code}-MAIN`;
}
