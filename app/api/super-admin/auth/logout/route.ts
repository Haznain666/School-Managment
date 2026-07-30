import type { NextResponse } from 'next/server';

import { apiSuccess } from '@/lib/api-response';
import { sessionCookieOptions } from '@/lib/super-admin-auth';

/**
 * POST /api/super-admin/auth/logout
 *
 * Clears the session cookie. Always succeeds — signing out when already signed
 * out is not an error.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST() {
  const response = apiSuccess({ signedOut: true });

  // maxAge 0 expires the cookie immediately.
  response.cookies.set({ ...sessionCookieOptions(0), value: '' });

  return response as NextResponse;
}
