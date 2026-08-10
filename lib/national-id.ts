/**
 * Pakistani identity-document numbers — formatting, validation and masking.
 *
 * ── Why the two documents are not one field ──────────────────────────────
 * A child is admitted on a B-Form (the Child Registration Certificate); the
 * same child, once eighteen, holds a CNIC or Smart Card. Admissions clerks were
 * typing both into one free-text box, so the roll held `4210112345671`,
 * `42101-1234567-1` and `B-Form 1234` in the same column, and nobody could tell
 * from the value which document had been sighted.
 *
 * The type is therefore recorded explicitly, and only the CNIC half is
 * constrained: NADRA's CNIC is exactly five digits, seven digits and a check
 * digit, so a value that is not in that shape is a typing mistake and is worth
 * refusing at the field. B-Form numbering has varied across issuing offices and
 * older certificates do not all fit one pattern, so it stays free text — a
 * school must be able to record the number on the paper in front of them.
 *
 * ── Why the value is masked ──────────────────────────────────────────────
 * These are national identity numbers on a screen an admissions desk shares
 * with a queue of parents behind it. They start hidden and are revealed
 * deliberately; nothing about the storage changes, only who is reading over
 * the clerk's shoulder.
 */

/** A CNIC / Smart Card number as it must be stored: `42101-1234567-1`. */
export const CNIC_PATTERN = /^\d{5}-\d{7}-\d$/;

/** How many digits a CNIC carries, hyphens excluded. */
const CNIC_DIGITS = 13;

/**
 * Reformats free typing into `42101-1234567-1` as it is entered.
 *
 * Everything that is not a digit is dropped — which is what lets a clerk paste
 * `42101 1234567 1` or `4210112345671` from a scanned form and get a
 * well-formed number — and the hyphens are re-inserted at the two fixed
 * positions. Input past thirteen digits is discarded rather than truncated
 * silently mid-edit, so the field simply stops accepting more.
 */
export function formatCnic(raw: string): string {
  const digits = raw.replace(/\D/g, '').slice(0, CNIC_DIGITS);

  if (digits.length <= 5) return digits;
  if (digits.length <= 12) return `${digits.slice(0, 5)}-${digits.slice(5)}`;

  return `${digits.slice(0, 5)}-${digits.slice(5, 12)}-${digits.slice(12)}`;
}

/** Whether a value is a complete, correctly shaped CNIC. */
export function isValidCnic(value: string): boolean {
  return CNIC_PATTERN.test(value.trim());
}

/**
 * The number with everything but its last four characters replaced.
 *
 * The tail is left visible so a clerk can confirm they are looking at the right
 * record without exposing the whole number. Hyphens are preserved so the masked
 * form keeps the shape of the real one and the field does not jump in width
 * when it is revealed.
 */
export function maskNationalId(value: string): string {
  const visible = 4;
  if (value.length <= visible) return value;

  const head = value
    .slice(0, value.length - visible)
    .replace(/[^-]/g, '•');

  return `${head}${value.slice(value.length - visible)}`;
}
