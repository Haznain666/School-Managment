import { and, eq } from 'drizzle-orm';

import { branches, schoolUsers } from '@/db/schema';
import { apiFailure, apiSuccess, handleApiError, readJsonBody } from '@/lib/api-response';
import { withSchoolAuth } from '@/lib/api-auth';
import { db } from '@/lib/drizzle';
import { getSchoolUserById } from '@/lib/school-queries';
import { revokeSchoolSession } from '@/lib/school-auth';
import { isUuid, readString } from '@/lib/validation';
import { BRANCH_REQUIRED_ROLES, isUserRole } from '@/types/school-auth';

/**
 * /api/school/users/[userId]
 *
 * GET    one member
 * PATCH  update name, role, branch or active status
 * DELETE not supported — deactivate instead
 *
 * Role and branch changes are mirrored into the user's Firebase claims and
 * their sessions revoked, so a demotion takes effect on the next request
 * rather than whenever their cookie happens to expire.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type RouteContext = { params: Promise<{ userId: string }> };

export const GET = withSchoolAuth<RouteContext>(
  async (_request, auth, context) => {
    try {
      const { userId } = await context.params;
      if (!isUuid(userId)) return apiFailure('not_found', 'User not found.', 404);

      const user = await getSchoolUserById(auth.locationId, userId);
      if (user === null) return apiFailure('not_found', 'User not found.', 404);

      // A branch-scoped admin may only look inside their own branch.
      if (auth.branchId !== null && user.branchId !== auth.branchId) {
        return apiFailure('not_found', 'User not found.', 404);
      }

      return apiSuccess({ user });
    } catch (error) {
      return handleApiError(error);
    }
  },
  { permission: 'users.read' },
);

interface UpdateUserBody {
  name?: unknown;
  role?: unknown;
  branchId?: unknown;
  isActive?: unknown;
}

export const PATCH = withSchoolAuth<RouteContext>(
  async (request, auth, context) => {
    try {
      const { userId } = await context.params;
      if (!isUuid(userId)) return apiFailure('not_found', 'User not found.', 404);

      const existing = await getSchoolUserById(auth.locationId, userId);
      if (existing === null) return apiFailure('not_found', 'User not found.', 404);

      const body = await readJsonBody<UpdateUserBody>(request);
      if (body === null) {
        return apiFailure('invalid_body', 'Expected a JSON body.', 400);
      }

      const updates: Partial<typeof schoolUsers.$inferInsert> = {};

      if (body.name !== undefined) {
        const name = readString(body.name);
        if (name === '') {
          return apiFailure('invalid_body', 'Name cannot be empty.', 400);
        }
        updates.name = name;
      }

      if (body.role !== undefined) {
        if (!isUserRole(body.role)) {
          return apiFailure('invalid_body', 'Select a valid role.', 400);
        }
        updates.role = body.role;
      }

      if (body.branchId !== undefined) {
        const branchId = typeof body.branchId === 'string' ? body.branchId : null;

        if (branchId !== null) {
          if (!isUuid(branchId)) {
            return apiFailure('invalid_body', 'That branch does not exist.', 400);
          }

          const owned = await db
            .select({ id: branches.id })
            .from(branches)
            .where(
              and(eq(branches.id, branchId), eq(branches.locationId, auth.locationId)),
            )
            .limit(1);

          if (owned[0] === undefined) {
            return apiFailure('invalid_body', 'That branch does not exist.', 400);
          }
        }

        updates.branchId = branchId;
      }

      if (typeof body.isActive === 'boolean') updates.isActive = body.isActive;

      if (Object.keys(updates).length === 0) {
        return apiFailure('invalid_body', 'No fields to update.', 400);
      }

      const nextRole = updates.role ?? existing.role;
      const nextBranchId =
        updates.branchId === undefined ? existing.branchId : updates.branchId;

      if (
        isUserRole(nextRole) &&
        BRANCH_REQUIRED_ROLES.includes(nextRole) &&
        nextBranchId === null
      ) {
        return apiFailure('invalid_body', 'This role requires a branch.', 400);
      }

      updates.updatedAt = new Date();

      const updated = await db
        .update(schoolUsers)
        .set(updates)
        .where(
          and(eq(schoolUsers.id, userId), eq(schoolUsers.locationId, auth.locationId)),
        )
        .returning({
          id: schoolUsers.id,
          authUserId: schoolUsers.authUserId,
          role: schoolUsers.role,
          branchId: schoolUsers.branchId,
          isActive: schoolUsers.isActive,
        });

      const user = updated[0];
      if (user === undefined) return apiFailure('not_found', 'User not found.', 404);

      // ── There are no claims to mirror any more ────────────────────────
      // This block used to write the new role and branch onto the user's
      // Firebase account, because the claims in their token were the
      // authority and would otherwise be replayed until it expired. The row
      // updated above is now the authority, read on the user's very next
      // request, so a role or branch change has already taken effect.
      //
      // Deactivation still revokes: `isAccountActive` refuses the session on
      // the next request either way, but there is no reason to leave a
      // refresh token working for an account that has been switched off.
      if (user.authUserId !== null && updates.isActive === false) {
        await revokeSchoolSession(user.authUserId);
      }

      const fresh = await getSchoolUserById(auth.locationId, userId);
      return apiSuccess({ user: fresh });
    } catch (error) {
      return handleApiError(error);
    }
  },
  { permission: 'users.write' },
);

export const DELETE = withSchoolAuth(
  () =>
    apiFailure(
      'method_not_allowed',
      'Users are deactivated, not deleted. PATCH with isActive: false.',
      405,
    ),
  { permission: 'users.write' },
);
