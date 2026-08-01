import { NextResponse, type NextRequest } from 'next/server';

import { apiFailure, apiSuccess, readJsonBody } from '@/lib/api-response';
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
 */

// bcrypt and the env read both need the Node runtime.
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface LoginBody {
  email?: unknown;
  password?: unknown;
}

export async function POST(request: NextRequest) {
  const body = await readJsonBody<LoginBody>(request);

  const hasCredentials =
    typeof body?.email === 'string' &&
    body.email.trim() !== '' &&
    typeof body.password === 'string' &&
    body.password !== '';

  if (!hasCredentials) {
    return apiFailure('invalid_credentials', 'Enter your email and password.', 400);
  }

  const check = await verifySuperAdminCredentials(body?.email, body?.password);

  if (!check.ok) {
    return check.reason === 'misconfigured'
      ? apiFailure(
          'server_misconfigured',
          'Super Admin access is not configured on this deployment.',
          500,
        )
      : apiFailure('invalid_credentials', 'Incorrect email or password.', 401);
  }

  const token = await signSuperAdminJWT(check.email);

  const response = apiSuccess({ email: check.email });
  response.cookies.set({
    ...sessionCookieOptions(SUPER_ADMIN_SESSION_SECONDS),
    value: token,
  });

  return response as NextResponse;
}
