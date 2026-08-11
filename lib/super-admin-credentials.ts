import 'server-only';

import { compare } from 'bcryptjs';

import { requireServerEnv } from './env';
import { describeHashShape, normalizeBcryptHash } from './super-admin-hash-shape';

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
    // Repaired on read: the escaped `\$2b\$12\$` form is correct in a `.env`
    // file and fatal in a hosting panel, and an operator cannot tell which
    // their host behaves like. A backslash cannot occur in a real bcrypt hash,
    // so removing it is a repair rather than a guess. See the module docblock.
    passwordHash = normalizeBcryptHash(requireServerEnv('SUPER_ADMIN_PASSWORD_HASH')) ?? '';
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

  if (!emailMatches || !passwordMatches) {
    logRejection(emailMatches, passwordMatches, passwordHash);
    return { ok: false, reason: 'invalid' };
  }

  return { ok: true, email: expectedEmail };
}

/**
 * Says, in the server log only, why a sign-in was refused.
 *
 * ── Why this exists ──────────────────────────────────────────────────────
 * `compare()` in bcryptjs opens with `if (hash.length !== 60) return false`.
 * A hash mangled in transit to the host — dotenv-expand eating the `$2b`/`$12`
 * segments, or the escaped `\$2b\$12\$` form pasted into a panel that does no
 * expansion — therefore does not throw. It returns false, becomes a plain 401,
 * and leaves nothing behind to explain it. That failure cost a deployment a day
 * on 2026-08-10.
 *
 * ── Why it is safe to log ────────────────────────────────────────────────
 * The hash itself is never printed: it is offline-crackable and belongs in a
 * log no more than the password does. What is printed is its *shape* — length,
 * the `$2b$12$` prefix every bcrypt hash in the world shares, and whether a
 * backslash survived into it — none of which narrows a guess by one bit, and
 * all of which name the misconfiguration outright. The two booleans say which
 * half failed; that is visible to the operator reading their own server log,
 * not to the caller, whose response stays the single indistinguishable
 * `invalid_credentials` either way.
 */
function logRejection(
  emailMatches: boolean,
  passwordMatches: boolean,
  passwordHash: string,
): void {
  console.warn(
    '[super-admin] sign-in refused. ' +
      `email matched: ${String(emailMatches)}; ` +
      `password matched: ${String(passwordMatches)}. ` +
      describeHashShape(passwordHash).message,
  );
}
