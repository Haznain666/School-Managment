import 'server-only';

import { NextResponse, type NextRequest } from 'next/server';

import type { SchoolSessionClaims, UserRole } from '@/types/school-auth';

import { sessionCookieName, verifySchoolSession } from './school-auth';

/**
 * `withSchoolAuth` — the gate every `/api/school/*` route passes through.
 *
 * It answers one question: who is calling, and which tenant are they? The
 * answer comes from the verified session cookie and nowhere else.
 *
 * The `locationId` it hands the handler is the ONLY value that may be used to
 * scope a query. A location id in a request body or query string is untrusted
 * input; using it would let any signed-in user read another school's data.
 */

export interface SchoolAuthContext {
  uid: string;
  /** GHL Location ID, from verified claims. Use this for every query. */
  locationId: string;
  role: UserRole;
  /** null = access to every branch of the school. */
  branchId: string | null;
  schoolSlug: string;
}

export type SchoolRouteHandler<TContext> = (
  request: NextRequest,
  auth: SchoolAuthContext,
  context: TContext,
) => Promise<NextResponse> | NextResponse;

export interface WithSchoolAuthOptions {
  allowedRoles: readonly UserRole[];
}

function unauthorized(message: string): NextResponse {
  return NextResponse.json(
    { ok: false, error: { code: 'unauthenticated', message } },
    { status: 401 },
  );
}

function forbidden(message: string): NextResponse {
  return NextResponse.json(
    { ok: false, error: { code: 'forbidden', message } },
    { status: 403 },
  );
}

function toContext(claims: SchoolSessionClaims): SchoolAuthContext {
  return {
    uid: claims.uid,
    locationId: claims.locationId,
    role: claims.role,
    branchId: claims.branchId,
    schoolSlug: claims.schoolSlug,
  };
}

/**
 * Wraps a route handler with session verification and a role check.
 *
 * @example
 *   export const GET = withSchoolAuth(
 *     async (request, auth) => apiSuccess(await listUsers(auth.locationId)),
 *     { allowedRoles: ['school_admin', 'hr_manager'] },
 *   );
 */
export function withSchoolAuth<TContext = unknown>(
  handler: SchoolRouteHandler<TContext>,
  options: WithSchoolAuthOptions,
) {
  return async (request: NextRequest, context: TContext): Promise<NextResponse> => {
    const cookie = request.cookies.get(sessionCookieName())?.value;

    if (cookie === undefined || cookie === '') {
      return unauthorized('Sign in to continue.');
    }

    const claims = await verifySchoolSession(cookie);
    if (claims === null) {
      return unauthorized('Your session has expired. Sign in again.');
    }

    if (!options.allowedRoles.includes(claims.role)) {
      return forbidden('Your role does not permit this action.');
    }

    return handler(request, toContext(claims), context);
  };
}

/**
 * Branch guard. A user whose `branchId` is null may act across the whole
 * school; anyone else is confined to their own branch.
 */
export function canAccessBranch(auth: SchoolAuthContext, branchId: string): boolean {
  return auth.branchId === null || auth.branchId === branchId;
}
