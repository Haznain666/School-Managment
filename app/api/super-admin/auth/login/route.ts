import { compare } from 'bcryptjs';
import { NextResponse, type NextRequest } from 'next/server';

import { apiFailure, apiSuccess, readJsonBody } from '@/lib/api-response';
import { requireServerEnv } from '@/lib/env';
import {
  SUPER_ADMIN_SESSION_SECONDS,
  sessionCookieOptions,
  signSuperAdminJWT,
} from '@/lib/super-admin-auth';

/**
 * POST /api/super-admin/auth/login
 *
 * Verifies the operator credentials against SUPER_ADMIN_EMAIL and the bcrypt
 * hash in SUPER_ADMIN_PASSWORD_HASH, then sets the signed session cookie.
 */

// bcrypt and the env read both need the Node runtime.
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface LoginBody {
  email?: unknown;
  password?: unknown;
}

export async function POST(request: NextRequest) {
  let expectedEmail: string;
  let passwordHash: string;

  try {
    expectedEmail = requireServerEnv('SUPER_ADMIN_EMAIL').trim().toLowerCase();
    passwordHash = requireServerEnv('SUPER_ADMIN_PASSWORD_HASH');
    // Fail fast if the signing secret is missing, rather than at cookie time.
    requireServerEnv('SUPER_ADMIN_JWT_SECRET');
  } catch (error) {
    console.error('[super-admin/login] configuration error:', error);
    return apiFailure(
      'server_misconfigured',
      'Super Admin access is not configured on this deployment.',
      500,
    );
  }

  const body = await readJsonBody<LoginBody>(request);
  const email = typeof body?.email === 'string' ? body.email.trim().toLowerCase() : '';
  const password = typeof body?.password === 'string' ? body.password : '';

  if (email === '' || password === '') {
    return apiFailure('invalid_credentials', 'Enter your email and password.', 400);
  }

  // Always run the bcrypt comparison, even when the email is wrong, so the
  // response time does not reveal whether the address was correct.
  const passwordMatches = await compare(password, passwordHash);
  const emailMatches = email === expectedEmail;

  if (!emailMatches || !passwordMatches) {
    return apiFailure('invalid_credentials', 'Incorrect email or password.', 401);
  }

  const token = await signSuperAdminJWT(expectedEmail);

  const response = apiSuccess({ email: expectedEmail });
  response.cookies.set({
    ...sessionCookieOptions(SUPER_ADMIN_SESSION_SECONDS),
    value: token,
  });

  return response as NextResponse;
}
