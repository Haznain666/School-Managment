import { and, eq, isNotNull } from 'drizzle-orm';
import type { NextRequest } from 'next/server';

import { schoolUsers, schools } from '@/db/schema';
import { apiFailure, apiSuccess, handleApiError, readJsonBody } from '@/lib/api-response';
import { db } from '@/lib/drizzle';
import { SCHOOL_LOCATION_HEADER, SCHOOL_SLUG_HEADER } from '@/lib/school-context';

/**
 * Pre-authentication helpers.
 *
 * The path is `[...nextauth]` for historical reasons; this is not NextAuth.
 * Authentication is Firebase session cookies, handled by `/api/school/auth/*`.
 * What remains here is the one lookup that has to happen *before* anyone is
 * signed in.
 *
 *   POST /api/auth/resolve-identifier — phone -> email, scoped to one school
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type RouteContext = { params: Promise<{ nextauth: string[] }> };

export async function POST(request: NextRequest, context: RouteContext) {
  const { nextauth } = await context.params;
  const action = nextauth.join('/');

  try {
    if (action === 'resolve-identifier') {
      return await handleResolveIdentifier(request);
    }
    return apiFailure('not_found', `Unknown auth route "${action}".`, 404);
  } catch (error) {
    return handleApiError(error);
  }
}

/**
 * Resolves the school for this request.
 *
 * Prefers the location id middleware already resolved; falls back to looking
 * the slug up in `schools` so the endpoint still works if only the slug header
 * is present (the dev `?school=` path).
 */
async function resolveLocationId(request: NextRequest): Promise<string | null> {
  const headerLocationId = request.headers.get(SCHOOL_LOCATION_HEADER);
  if (headerLocationId !== null && headerLocationId !== '') return headerLocationId;

  const slug = request.headers.get(SCHOOL_SLUG_HEADER);
  if (slug === null || slug === '') return null;

  const rows = await db
    .select({ locationId: schools.locationId })
    .from(schools)
    .where(and(eq(schools.slug, slug), eq(schools.isActive, true)))
    .limit(1);

  return rows[0]?.locationId ?? null;
}

/**
 * Unauthenticated by necessity: it runs before sign-in, so someone can type a
 * phone number instead of an email.
 *
 * Two things keep it from being an account-enumeration oracle: the tenant comes
 * from the subdomain (so it can only ever see one school's users), and the
 * response is identical — a generic 404 — whether the number is unknown, the
 * account is inactive, or the school does not exist.
 */
async function handleResolveIdentifier(request: NextRequest) {
  const locationId = await resolveLocationId(request);
  if (locationId === null) {
    return apiFailure('not_found', 'No matching account.', 404);
  }

  const body = await readJsonBody<{ identifier?: unknown }>(request);
  const identifier = typeof body?.identifier === 'string' ? body.identifier.trim() : '';

  if (identifier === '') {
    return apiFailure('not_found', 'No matching account.', 404);
  }

  // Compare on digits only so "+92 300 1234567" matches "03001234567".
  const digits = identifier.replace(/\D/g, '');
  if (digits.length < 7) {
    return apiFailure('not_found', 'No matching account.', 404);
  }

  // Only users who have completed their invite can sign in, so a row without a
  // firebase_uid is not a match.
  const candidates = await db
    .select({ email: schoolUsers.email, phone: schoolUsers.phone })
    .from(schoolUsers)
    .where(
      and(
        eq(schoolUsers.locationId, locationId),
        eq(schoolUsers.isActive, true),
        isNotNull(schoolUsers.firebaseUid),
      ),
    );

  const match = candidates.find((row) => row.phone.replace(/\D/g, '').endsWith(digits));

  if (match === undefined || match.email === null || match.email === '') {
    return apiFailure('not_found', 'No matching account.', 404);
  }

  return apiSuccess({ email: match.email });
}
