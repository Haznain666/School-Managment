import { NextResponse, type NextRequest } from 'next/server';

import { apiFailure, apiSuccess, handleApiError, readJsonBody } from '@/lib/api-response';
import {
  checkThrottle,
  clientIpHash,
  recordAttempt,
  throttledResponse,
} from '@/lib/auth-throttle';
import {
  SUPER_ADMIN_SESSION_SECONDS,
  sessionCookieOptions,
  signSuperAdminJWT,
} from '@/lib/super-admin-auth';
import { verifySuperAdminCredentials } from '@/lib/super-admin-credentials';

/**
 * POST /api/super-admin/auth/login
 *
 * Verifies the operator credentials against SUPER_ADMIN_EMAIL and the bcrypt
 * hash in SUPER_ADMIN_PASSWORD_HASH, then sets the signed session cookie.
 *
 * The check itself lives in `lib/super-admin-credentials.ts` because the
 * "Login as Admin" step-up performs the same one, and two copies of a
 * constant-time comparison is how one of them stops being constant-time.
 *
 * ── Why this one is throttled hardest ────────────────────────────────────
 * There is exactly one super-admin account on a deployment, its address is
 * whatever the operator chose, and behind it is every school on the platform.
 * A single credential guarding everything is precisely the thing worth grinding
 * at, and there is no legitimate traffic pattern that involves twenty sessions
 * from one origin in a quarter of an hour. `STATE.md` also records that the
 * production password is still the leaked one, which makes this less
 * theoretical than it should be.
 *
 * `misconfigured` is not counted. It means the deployment has no
 * `SUPER_ADMIN_PASSWORD_HASH`, which nobody's guessing caused and which locking
 * the endpoint would only make harder to diagnose.
 */

// bcrypt and the env read both need the Node runtime.
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface LoginBody {
  email?: unknown;
  password?: unknown;
}

/**
 * ── Why the whole thing is inside a try ──────────────────────────────────
 * It was not, and a throw anywhere in here left Next to answer with its own
 * HTML error page. The panel's fetch helper then failed on `response.json()`
 * and showed "Unexpected response." — a message that names neither what broke
 * nor which half of the sign-in it broke in, on the one screen an operator has
 * no other way past. Diagnosing that live means reading server logs for a
 * deployment whose logs are not always reachable.
 *
 * Every route on this surface already returns the JSON envelope through
 * `handleApiError`. This one now does too, so a failure here is a
 * `server_error` the operator can quote rather than a blank refusal.
 */
export async function POST(request: NextRequest) {
  try {
    const body = await readJsonBody<LoginBody>(request);

    const hasCredentials =
      typeof body?.email === 'string' &&
      body.email.trim() !== '' &&
      typeof body.password === 'string' &&
      body.password !== '';

    if (!hasCredentials) {
      return apiFailure('invalid_credentials', 'Enter your email and password.', 400);
    }

    const attempted = typeof body?.email === 'string' ? body.email : '';
    const ipHash = clientIpHash(request);

    const throttle = await checkThrottle('super_admin_login', attempted, ipHash);
    if (!throttle.allowed) return throttledResponse(throttle);

    const check = await verifySuperAdminCredentials(body?.email, body?.password);

    if (!check.ok) {
      if (check.reason === 'misconfigured') {
        return apiFailure(
          'server_misconfigured',
          'Super Admin access is not configured on this deployment.',
          500,
        );
      }

      await recordAttempt('super_admin_login', attempted, ipHash, false);
      return apiFailure('invalid_credentials', 'Incorrect email or password.', 401);
    }

    await recordAttempt('super_admin_login', check.email, ipHash, true);

    const token = await signSuperAdminJWT(check.email);

    const response = apiSuccess({ email: check.email });
    response.cookies.set({
      ...sessionCookieOptions(SUPER_ADMIN_SESSION_SECONDS),
      value: token,
    });

    return response as NextResponse;
  } catch (error) {
    return handleApiError(error);
  }
}
