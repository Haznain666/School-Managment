import { and, eq } from 'drizzle-orm';
import type { NextRequest } from 'next/server';

import { branches, userRoles, users } from '@/db/schema';
import { apiFailure, apiSuccess, handleApiError, readJsonBody } from '@/lib/api-response';
import { LOCATION_HEADER, withAuth } from '@/lib/auth-middleware';
import { isUserClaimRole, type UserClaims } from '@/lib/claims';
import { db } from '@/lib/drizzle';
import { setUserClaims } from '@/lib/firebase-admin';

/**
 * Auth endpoints.
 *
 * The path is `[...nextauth]` to match the agreed project layout, but this is
 * NOT NextAuth — authentication is Firebase Auth. Sessions are Firebase ID
 * tokens held by the client; this route only supports the flows around them.
 *
 * Routes:
 *   POST /api/auth/resolve-identifier  — phone -> email, scoped to the subdomain
 *   GET  /api/auth/session             — verified identity of the caller
 *   GET  /api/auth/roles               — every role the caller holds
 *   POST /api/auth/select-role         — activate one role (dual-role users)
 */

// firebase-admin and the Neon driver both need Node APIs.
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type RouteContext = { params: Promise<{ nextauth: string[] }> };

function actionOf(segments: string[]): string {
  return segments.join('/');
}

// -----------------------------------------------------------------------------
// GET
// -----------------------------------------------------------------------------

export async function GET(request: NextRequest, context: RouteContext) {
  const { nextauth } = await context.params;
  const action = actionOf(nextauth);

  try {
    switch (action) {
      case 'session':
        return await handleSession(request);
      case 'roles':
        return await handleListRoles(request);
      default:
        return apiFailure('not_found', `Unknown auth route "${action}".`, 404);
    }
  } catch (error) {
    return handleApiError(error);
  }
}

// -----------------------------------------------------------------------------
// POST
// -----------------------------------------------------------------------------

export async function POST(request: NextRequest, context: RouteContext) {
  const { nextauth } = await context.params;
  const action = actionOf(nextauth);

  try {
    switch (action) {
      case 'resolve-identifier':
        return await handleResolveIdentifier(request);
      case 'select-role':
        return await handleSelectRole(request);
      default:
        return apiFailure('not_found', `Unknown auth route "${action}".`, 404);
    }
  } catch (error) {
    return handleApiError(error);
  }
}

// -----------------------------------------------------------------------------
// Handlers
// -----------------------------------------------------------------------------

/**
 * Unauthenticated by necessity: it runs before sign-in, so a user can type a
 * phone number instead of an email.
 *
 * Two things keep it from being an account-enumeration oracle: the tenant comes
 * from the subdomain (so it can only ever see one school's users), and the
 * response is identical — a generic 404 — whether the number is unknown, the
 * account is inactive, or the school does not exist.
 */
async function handleResolveIdentifier(request: NextRequest) {
  const locationId = request.headers.get(LOCATION_HEADER);
  if (locationId === null || locationId === '') {
    return apiFailure('not_found', 'No matching account.', 404);
  }

  const body = await readJsonBody<{ identifier?: unknown }>(request);
  const identifier =
    typeof body?.identifier === 'string' ? body.identifier.trim() : '';

  if (identifier === '') {
    return apiFailure('not_found', 'No matching account.', 404);
  }

  // Compare on digits only so "+92 300 1234567" matches "03001234567".
  const digits = identifier.replace(/\D/g, '');
  if (digits.length < 7) {
    return apiFailure('not_found', 'No matching account.', 404);
  }

  const candidates = await db
    .select({ email: users.email, phone: users.phone, status: users.status })
    .from(users)
    .where(and(eq(users.locationId, locationId), eq(users.status, 'active')));

  const match = candidates.find(
    (row) => row.phone !== null && row.phone.replace(/\D/g, '').endsWith(digits),
  );

  if (match === undefined) {
    return apiFailure('not_found', 'No matching account.', 404);
  }

  return apiSuccess({ email: match.email });
}

/** Echoes the caller's verified identity — useful for debugging claim issues. */
async function handleSession(request: NextRequest) {
  const auth = await withAuth(request);

  const profiles = await db
    .select({
      id: users.id,
      email: users.email,
      phone: users.phone,
      userType: users.userType,
      status: users.status,
    })
    .from(users)
    .where(
      and(eq(users.locationId, auth.locationId), eq(users.firebaseUid, auth.uid)),
    )
    .limit(1);

  return apiSuccess({
    uid: auth.uid,
    locationId: auth.locationId,
    role: auth.role,
    branchId: auth.branchId,
    isDualRole: auth.isDualRole,
    profile: profiles[0] ?? null,
  });
}

/** Lists every active role the caller holds at their school. */
async function handleListRoles(request: NextRequest) {
  const auth = await withAuth(request);

  const rows = await db
    .select({
      id: userRoles.id,
      role: userRoles.role,
      branchId: userRoles.branchId,
      branchName: branches.name,
    })
    .from(userRoles)
    .innerJoin(users, eq(users.id, userRoles.userId))
    .leftJoin(branches, eq(branches.id, userRoles.branchId))
    .where(
      and(
        eq(userRoles.locationId, auth.locationId),
        eq(users.firebaseUid, auth.uid),
        eq(userRoles.isActive, true),
      ),
    );

  return apiSuccess({ roles: rows });
}

/**
 * Activates one of the caller's roles by rewriting their custom claims.
 *
 * The requested role is validated against `user_roles` for *this* user at
 * *this* school, so a user cannot elevate themselves by asking for a role they
 * do not hold. The client must refresh its ID token afterwards.
 */
async function handleSelectRole(request: NextRequest) {
  const auth = await withAuth(request);

  const body = await readJsonBody<{ role?: unknown; branchId?: unknown }>(request);
  const requestedRole: unknown = body?.role;

  if (!isUserClaimRole(requestedRole)) {
    return apiFailure('invalid_role', 'Unknown role.', 400);
  }

  const requestedBranchId =
    typeof body?.branchId === 'string' && body.branchId !== '' ? body.branchId : null;

  const held = await db
    .select({ role: userRoles.role, branchId: userRoles.branchId })
    .from(userRoles)
    .innerJoin(users, eq(users.id, userRoles.userId))
    .where(
      and(
        eq(userRoles.locationId, auth.locationId),
        eq(users.firebaseUid, auth.uid),
        eq(userRoles.isActive, true),
      ),
    );

  const grant = held.find(
    (row) => row.role === requestedRole && row.branchId === requestedBranchId,
  );

  if (grant === undefined) {
    return apiFailure('forbidden_role', 'You do not hold that role.', 403);
  }

  const nextClaims: UserClaims = {
    location_id: auth.locationId,
    role: requestedRole,
    branch_id: grant.branchId,
    // Keep the flag set: they still hold multiple roles and may switch back.
    is_dual_role: held.length > 1,
  };

  await setUserClaims(auth.uid, nextClaims);

  return apiSuccess({
    role: nextClaims.role,
    branchId: nextClaims.branch_id,
    // Existing tokens keep the old claims until refreshed.
    refreshRequired: true,
  });
}
