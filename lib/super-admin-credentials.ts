import 'server-only';

import { compare } from 'bcryptjs';

import { requireServerEnv } from './env';

/**
 * The one place operator credentials are checked.
 *
 * Two routes verify them — the panel login and the "Login as Admin" step-up —
 * and a second copy of this logic is exactly how the two drift apart. In
 * particular the constant-time property below is easy to lose in a rewrite: the
 * bcrypt comparison runs even when the email is already known to be wrong, so
 * the response time cannot be used to discover the operator's address.
 */

export type CredentialCheck =
  | { ok: true; email: string }
  | { ok: false; reason: 'misconfigured' | 'invalid' };

/**
 * Verifies an email and password against `SUPER_ADMIN_EMAIL` and
 * `SUPER_ADMIN_PASSWORD_HASH`.
 *
 * Returns `misconfigured` rather than throwing when the deployment has no
 * operator account set up, so callers can answer 500 instead of leaking a
 * stack trace.
 */
export async function verifySuperAdminCredentials(
  email: unknown,
  password: unknown,
): Promise<CredentialCheck> {
  let expectedEmail: string;
  let passwordHash: string;

  try {
    expectedEmail = requireServerEnv('SUPER_ADMIN_EMAIL').trim().toLowerCase();
    passwordHash = requireServerEnv('SUPER_ADMIN_PASSWORD_HASH');
    // Fail fast if the signing secret is missing, rather than at cookie time.
    requireServerEnv('SUPER_ADMIN_JWT_SECRET');
  } catch (error) {
    console.error('[super-admin] configuration error:', error);
    return { ok: false, reason: 'misconfigured' };
  }

  const submittedEmail = typeof email === 'string' ? email.trim().toLowerCase() : '';
  const submittedPassword = typeof password === 'string' ? password : '';

  if (submittedEmail === '' || submittedPassword === '') {
    return { ok: false, reason: 'invalid' };
  }

  // Always run the comparison, even when the email is wrong, so the response
  // time does not reveal whether the address was correct.
  const passwordMatches = await compare(submittedPassword, passwordHash);
  const emailMatches = submittedEmail === expectedEmail;

  return emailMatches && passwordMatches
    ? { ok: true, email: expectedEmail }
    : { ok: false, reason: 'invalid' };
}
