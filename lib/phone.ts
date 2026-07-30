/**
 * Pakistani phone number handling.
 *
 * Phone numbers are the primary identity on this platform — invitations and
 * one-time passcodes both travel over WhatsApp — so they are normalised to a
 * single canonical form (E.164) before they are stored or compared. Without
 * that, `0300-1234567`, `+92 300 1234567` and `923001234567` would be three
 * different users.
 */

/** Canonical Pakistani mobile: `+92` followed by ten digits. */
const E164_PK = /^\+92[0-9]{10}$/;

export class InvalidPhoneError extends Error {
  constructor(input: string) {
    super(`Invalid Pakistani phone number: ${input}`);
    this.name = 'InvalidPhoneError';
  }
}

/**
 * Converts the ways people actually type a Pakistani number into E.164.
 *
 *   0300-1234567    -> +923001234567
 *   +92 300 1234567 -> +923001234567
 *   923001234567    -> +923001234567
 *
 * @throws {InvalidPhoneError} when the result is not a valid PK mobile.
 */
export function normalizePhone(input: string): string {
  // Strip the separators people use: spaces, dashes, dots, parentheses.
  const stripped = input.replace(/[\s\-.()]/g, '');

  let candidate: string;

  if (stripped.startsWith('+92')) {
    candidate = stripped;
  } else if (stripped.startsWith('92')) {
    candidate = `+${stripped}`;
  } else if (stripped.startsWith('0')) {
    // National form: the trunk prefix 0 is replaced by the country code.
    candidate = `+92${stripped.slice(1)}`;
  } else {
    candidate = stripped;
  }

  if (!E164_PK.test(candidate)) {
    throw new InvalidPhoneError(input);
  }

  return candidate;
}

/** True when `input` normalises cleanly, without throwing. */
export function isValidPhone(input: string): boolean {
  try {
    normalizePhone(input);
    return true;
  } catch {
    return false;
  }
}

/**
 * Hides the middle of a number for display: `+923001234567` -> `+92300****4567`.
 *
 * Shown when confirming where a passcode was sent, so someone can tell whether
 * it went to the right handset without the full number appearing on screen.
 */
export function maskPhone(e164: string): string {
  if (e164.length < 10) return e164;
  return `${e164.slice(0, 6)}****${e164.slice(-4)}`;
}
