import { NextResponse, type NextRequest } from 'next/server';

import { apiSuccess } from '@/lib/api-response';
import { sessionCookieOptions } from '@/lib/super-admin-auth';

/**
 * POST /api/super-admin/auth/logout
 *
 * Clears the session cookie. Always succeeds — signing out when already signed
 * out is not an error.
 *
 * GET does the same and then redirects to the sign-in page — Sprint 35.
 *
 * ── Why a GET exists at all ──────────────────────────────────────────────
 * A deactivated operator still holds a validly *signed* cookie. Middleware
 * checks only the signature (it runs on the Edge and cannot read the row), so
 * it would bounce them from `/super-admin/login` straight back to the panel,
 * and the panel — which does read the row — would send them to sign in again:
 * a redirect loop with no way out. The page guard sends them here instead,
 * which is exempt from the middleware check and clears the cookie first.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST() {
  const response = apiSuccess({ signedOut: true });

  // maxAge 0 expires the cookie immediately.
  response.cookies.set({ ...sessionCookieOptions(0), value: '' });

  return response as NextResponse;
}

export function GET(request: NextRequest) {
  const response = NextResponse.redirect(new URL('/super-admin/login', request.url));
  response.cookies.set({ ...sessionCookieOptions(0), value: '' });
  return response;
}
