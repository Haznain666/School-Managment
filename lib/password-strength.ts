/**
 * Password and address rules that both sides of the wire need.
 *
 * The strength meter beside a password field and the check that actually
 * accepts the password must agree, or the form rejects what it just told
 * someone was fine. So the rule lives here once, in a module with no
 * server-only imports, and both sides read it.
 *
 * Nothing here is a security control on its own. GoTrue holds the password
 * hash and applies whatever policy is configured in the Supabase dashboard on
 * top of this; `/api/school/auth/password` is what refuses a weak one.
 */

/**
 * Ten rather than eight. Length is the only property of a password that
 * reliably costs an attacker anything, and two extra characters buy more than
 * any composition rule does.
 */
export const PASSWORD_MIN_LENGTH = 10;

export interface PasswordStrengthResult {
  valid: boolean;
  error?: string;
}

/**
 * The floor a password must clear.
 *
 * Kept to length plus two character classes on purpose. Rules beyond that push
 * people towards `Password1!` and a sticky note, and the real defences here are
 * bcrypt at rest and the fact that a reset needs the inbox.
 */
export function validatePasswordStrength(password: string): PasswordStrengthResult {
  if (password.length < PASSWORD_MIN_LENGTH) {
    return {
      valid: false,
      error: `Password must be at least ${PASSWORD_MIN_LENGTH} characters.`,
    };
  }

  if (!/[a-zA-Z]/.test(password)) {
    return { valid: false, error: 'Password must contain at least one letter.' };
  }

  if (!/[0-9]/.test(password)) {
    return { valid: false, error: 'Password must contain at least one number.' };
  }

  return { valid: true };
}

/**
 * A rough 0-4 score for the strength meter in the browser.
 *
 * Advisory only. `validatePasswordStrength` is what decides whether a password
 * is accepted, and it runs on the server.
 */
export function passwordScore(password: string): number {
  if (password === '') return 0;

  let score = 0;
  if (password.length >= PASSWORD_MIN_LENGTH) score += 1;
  if (password.length >= 12) score += 1;
  if (/[a-z]/.test(password) && /[A-Z]/.test(password)) score += 1;
  if (/[0-9]/.test(password) && /[^a-zA-Z0-9]/.test(password)) score += 1;

  return Math.min(score, 4);
}

export const PASSWORD_SCORE_LABELS: readonly string[] = [
  'Too short',
  'Weak',
  'Fair',
  'Good',
  'Strong',
];

/**
 * Shape check only, and intentionally permissive — the address is proved by
 * mail arriving at it, not by a regular expression. This exists to reject
 * obvious typos and anything that is not an address at all.
 */
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export function isValidEmail(value: unknown): value is string {
  return typeof value === 'string' && value.length <= 254 && EMAIL_PATTERN.test(value);
}

/** Addresses are stored and compared lower-cased, so casing never splits a user. */
export function normalizeEmail(value: string): string {
  return value.trim().toLowerCase();
}
