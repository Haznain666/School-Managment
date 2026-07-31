/**
 * School codes — the prefix on every student ID (`GVS-2025-0001`).
 *
 * Kept apart from `lib/student-id.ts`, which is `server-only` because it talks
 * to the database. The Super Admin school form runs in the browser and needs
 * exactly these rules to show the operator what their code will look like, so
 * the pure half lives here and both sides share one definition.
 */

/** How many digits the sequence is padded to: `1` -> `0001`. */
const SEQUENCE_PAD = 4;

/**
 * Normalises a school code for use in an ID.
 * Letters and digits only, uppercased, capped at six characters.
 */
export function normalizeSchoolCode(input: string): string {
  return input
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
    .slice(0, 6);
}

/**
 * Derives a school code from a school name when the Super Admin left it blank:
 * the initial of each word, e.g. "Green Valley School" -> "GVS".
 *
 * A single-word name has no initials to take, so its first letters are used
 * instead — "Beaconhouse" becomes "BEACO" rather than a useless "B".
 */
export function deriveSchoolCode(schoolName: string): string {
  const words = schoolName
    .toUpperCase()
    .replace(/[^A-Z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((word) => word !== '');

  if (words.length === 0) return 'SCH';

  if (words.length === 1) {
    return (words[0] ?? '').slice(0, 5).padEnd(2, 'X');
  }

  const initials = words
    .map((word) => word.slice(0, 1))
    .join('')
    .slice(0, 5);

  return initials.length >= 2 ? initials : initials.padEnd(2, 'X');
}

/**
 * Human-readable reason a school code was rejected, or null when it is fine.
 * Blank is allowed: a blank code is derived from the school name instead.
 */
export function schoolCodeRejectionReason(candidate: string): string | null {
  if (candidate === '') return null;
  if (!/^[A-Z]{2,6}$/.test(candidate)) {
    return 'The school code must be 2–6 uppercase letters, e.g. GVS.';
  }
  return null;
}

/** Assembles the printed form. Shared so previews cannot drift from reality. */
export function formatStudentId(
  schoolCode: string,
  startYear: number,
  sequence: number,
): string {
  return `${normalizeSchoolCode(schoolCode)}-${startYear}-${String(sequence).padStart(
    SEQUENCE_PAD,
    '0',
  )}`;
}
