import 'server-only';

import { compare } from 'bcryptjs';

import { requireServerEnv } from './env';
import {
  findSuperAdminByEmail,
  superAdminTableState,
} from './super-admin-accounts';
import { describeHashShape, readConfiguredHash } from './super-admin-hash-shape';

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
  /** `adminId` is null only on the environment-credential fallback. */
  | { ok: true; email: string; adminId: string | null }
  | { ok: false; reason: 'misconfigured' | 'invalid' };

/**
 * A real bcrypt hash of nothing anybody will type, compared against when there
 * is no row to compare with — so an unknown address costs the same ~250ms as a
 * known one with the wrong password. Cost 12, like every real hash here.
 */
const TIMING_DECOY_HASH = '$2b$12$E9Z/oififz78/Qxj7U5gAekqJ19ZbMTghCZokrFXvLDZdHyBiNgi.';

/**
 * Sprint 35 — the operators are rows now, and the environment is the fallback.
 *
 * In this order:
 *
 *   1. A `super_admin_users` row with this address: its hash decides, and an
 *      inactive row is refused exactly as a wrong password is.
 *   2. No row, and the table is **empty or unreachable**: the environment
 *      credential, which can only ever be the owner. This is the deploy that
 *      landed before `0052`, or after it and before the owner was seeded — the
 *      owner must never be locked out by the order two steps ran in.
 *   3. No row, and the table holds people: refused. The environment
 *      credential is **not** consulted once the table is live, so rotating the
 *      owner's password on "My account" is not undone by a stale hash in a
 *      panel somebody forgot.
 *
 * The bcrypt comparison runs on every path, including the refusal, so the
 * response time never says which of the three applied.
 */
export async function verifySuperAdminCredentials(
  email: unknown,
  password: unknown,
): Promise<CredentialCheck> {
  try {
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

  let row: Awaited<ReturnType<typeof findSuperAdminByEmail>> = null;
  let tableUsable = true;

  try {
    row = await findSuperAdminByEmail(submittedEmail);
  } catch (error) {
    console.error('[super-admin] super_admin_users lookup failed; environment fallback:', error);
    tableUsable = false;
  }

  if (row !== null) {
    const matches = await compare(submittedPassword, row.passwordHash);
    if (!matches || !row.isActive) {
      console.warn(
        `[super-admin] sign-in refused for a known operator. password matched: ${String(matches)}; active: ${String(row.isActive)}.`,
      );
      return { ok: false, reason: 'invalid' };
    }
    return { ok: true, email: row.email, adminId: row.id };
  }

  const state = tableUsable ? await superAdminTableState() : 'unreachable';

  if (state === 'rows') {
    await compare(submittedPassword, TIMING_DECOY_HASH);
    return { ok: false, reason: 'invalid' };
  }

  const fallback = await verifyEnvironmentCredentials(submittedEmail, submittedPassword);
  return fallback.ok ? { ok: true, email: fallback.email, adminId: null } : fallback;
}

/**
 * Verifies an email and password against `SUPER_ADMIN_EMAIL` and
 * `SUPER_ADMIN_PASSWORD_HASH`.
 *
 * Returns `misconfigured` rather than throwing when the deployment has no
 * operator account set up, so callers can answer 500 instead of leaking a
 * stack trace.
 */
async function verifyEnvironmentCredentials(
  email: unknown,
  password: unknown,
): Promise<{ ok: true; email: string } | { ok: false; reason: 'misconfigured' | 'invalid' }> {
  let expectedEmail: string;
  let passwordHash: string;

  try {
    expectedEmail = requireServerEnv('SUPER_ADMIN_EMAIL').trim().toLowerCase();

    /**
     * Either variable will do, and both are repaired on read.
     *
     * `SUPER_ADMIN_PASSWORD_HASH_B64` is the one that cannot be mangled: a
     * bcrypt hash's `$` characters are eaten by dotenv-expand and by shells,
     * and the backslashes used to escape them survive literally in a panel that
     * expands nothing — so the *correct* plain form depends on machinery an
     * operator cannot inspect. Base64 has no character any of them act on.
     *
     * Kept optional rather than required: deployments where the plain form
     * already works must not break, and `requireServerEnv` below still gives a
     * 500 `server_misconfigured` when neither is set, which is what
     * distinguishes "not configured" from "wrong password" in the smoke test.
     */
    passwordHash =
      readConfiguredHash(
        process.env['SUPER_ADMIN_PASSWORD_HASH'],
        process.env['SUPER_ADMIN_PASSWORD_HASH_B64'],
      ) ?? '';

    if (passwordHash.trim() === '') {
      // Preserves the old behaviour exactly: neither variable present is a
      // configuration error, not a failed sign-in.
      requireServerEnv('SUPER_ADMIN_PASSWORD_HASH');
    }
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
