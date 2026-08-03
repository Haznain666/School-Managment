import 'server-only';

import { NextResponse, type NextRequest } from 'next/server';

import type { SchoolSessionClaims, UserRole } from '@/types/school-auth';

import { hasPermission } from './permission-queries';
import type { Permission } from './permissions';
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

/**
 * What a route requires of its caller. Exactly one of the two forms:
 *
 *   { permission: 'fees.write' }   — resolved against the school's own matrix
 *   { allowedRoles: [...] }        — a fixed list, for routes that are not
 *                                    permission-gated at all
 *
 * Prefer `permission`. `allowedRoles` remains for the handful of routes where
 * the answer is "any signed-in member of this school" (`/me`, `/settings`,
 * `/branches`) — turning those into a permission would create a toggle that no
 * administrator has a reason to touch.
 */
export type WithSchoolAuthOptions =
  | { permission: Permission; allowedRoles?: never }
  | { allowedRoles: readonly UserRole[]; permission?: never };

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
 * Wraps a route handler with session verification and an access check.
 *
 * The permission is resolved against the caller's own school, so two schools
 * running the same build can answer the same request differently — that is the
 * point of the model, not a bug in it. The resolution reads `role_permissions`
 * once per request (see `lib/permission-queries.ts`), so a route checking one
 * permission costs one extra query and a layout plus two routes still costs
 * one.
 *
 * @example
 *   export const GET = withSchoolAuth(
 *     async (request, auth) => apiSuccess(await listUsers(auth.locationId)),
 *     { permission: 'users.read' },
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

    if (options.permission !== undefined) {
      const permitted = await hasPermission(
        // Tenant from verified claims. A permission resolved against a
        // location out of the request would let anyone grant themselves
        // anything by naming a school that had.
        claims.locationId,
        claims.role,
        options.permission,
      );

      if (!permitted) {
        return forbidden('Your role does not permit this action.');
      }
    } else if (!options.allowedRoles.includes(claims.role)) {
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
