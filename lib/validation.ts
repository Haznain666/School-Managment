/** Small shared parsers for untrusted request input. */

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Guards route parameters before they reach a query.
 * Postgres raises on a malformed uuid literal, so an unchecked path segment
 * turns a typo into a 500 instead of a 404.
 */
export function isUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID_PATTERN.test(value);
}

/** Reads a trimmed string field, or '' when absent or the wrong type. */
export function readString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

/** Reads an optional string field: '' and non-strings both become null. */
export function readOptionalString(value: unknown): string | null {
  const text = readString(value);
  return text === '' ? null : text;
}

const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Guards a calendar date before it reaches a `date` column.
 * Checks the shape *and* that it is a real day, so `2025-02-31` is refused
 * rather than silently rolled forward.
 */
export function isIsoDate(value: unknown): value is string {
  if (typeof value !== 'string' || !ISO_DATE_PATTERN.test(value)) return false;

  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

/**
 * Reads a date field that is allowed to be absent.
 *
 * Three outcomes, and the third is the point: `null` for "deliberately blank",
 * the date for "here it is", and **`undefined` for "that is not a date"**. A
 * parser that collapsed the last two into null would silently store a blank
 * where a clerk typed `31/02/2026`, and the screen would show them an empty
 * field they had just filled in.
 *
 * Sprint 14 needs this on every optional date it added — a term's envelope, a
 * schedule's end — and having it here rather than in each route is what stops
 * two of them disagreeing about what an empty string means.
 */
export function readOptionalDate(value: unknown): string | null | undefined {
  if (value === undefined || value === null || value === '') return null;
  return isIsoDate(value) ? value : undefined;
}

/** Reads a boolean field, defaulting when the value is not a boolean. */
export function readBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}
