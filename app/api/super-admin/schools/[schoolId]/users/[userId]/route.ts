import { and, eq } from 'drizzle-orm';
import type { NextRequest } from 'next/server';

import { schoolUsers } from '@/db/schema';
import { apiFailure, apiSuccess, handleApiError, readJsonBody } from '@/lib/api-response';
import { db } from '@/lib/drizzle';
import { resolveLocationId } from '@/lib/schools';
import { requireSuperAdmin } from '@/lib/super-admin-guard';
import { isUuid } from '@/lib/validation';

/**
 * /api/super-admin/schools/[schoolId]/users/[userId]
 *
 * PATCH  activate or deactivate a member
 * DELETE remove a member outright
 *
 * ── Deactivate is the safe one, and it is instant ────────────────────────
 * `is_active` is read per request by `membershipFor()` in `lib/school-auth.ts`,
 * not carried in the session token, so flipping it here ends the person's
 * access on their very next request. There is no session to revoke separately
 * and no window where a stale token still works.
 *
 * ── Delete is the sharp one ──────────────────────────────────────────────
 * A member who has done anything — marked attendance, approved leave, run
 * payroll, taught a timetabled period — is referenced by those rows, and
 * several of those foreign keys are `NO ACTION`. Postgres refuses the delete
 * rather than orphaning the history, which is the correct outcome: the record
 * of who marked a register is part of the register. That refusal is turned
 * into an explanation here, pointing at deactivate.
 *
 * So in practice delete succeeds for people who never got started — the case
 * it is actually for — and deactivate is the answer for everyone else.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type RouteContext = { params: Promise<{ schoolId: string; userId: string }> };

/** Postgres foreign_key_violation. */
const FOREIGN_KEY_VIOLATION = '23503';

function isForeignKeyViolation(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: unknown }).code === FOREIGN_KEY_VIOLATION
  );
}

/**
 * Resolves the school and checks the member belongs to it.
 *
 * The membership check is the tenant guard: without it a user id from another
 * school could be deleted through this school's URL.
 */
async function resolveMember(schoolId: string, userId: string) {
  if (!isUuid(schoolId) || !isUuid(userId)) return null;

  const locationId = await resolveLocationId(schoolId);
  if (locationId === null) return null;

  const rows = await db
    .select({
      id: schoolUsers.id,
      name: schoolUsers.name,
      isActive: schoolUsers.isActive,
      joinedAt: schoolUsers.joinedAt,
    })
    .from(schoolUsers)
    .where(and(eq(schoolUsers.locationId, locationId), eq(schoolUsers.id, userId)))
    .limit(1);

  const member = rows[0];
  return member === undefined ? null : { locationId, member };
}

interface PatchBody {
  is_active?: unknown;
}

export async function PATCH(request: NextRequest, context: RouteContext) {
  try {
    await requireSuperAdmin();

    const { schoolId, userId } = await context.params;
    const resolved = await resolveMember(schoolId, userId);
    if (resolved === null) {
      return apiFailure('not_found', 'That user is not a member of this school.', 404);
    }

    const body = await readJsonBody<PatchBody>(request);
    if (body === null || typeof body.is_active !== 'boolean') {
      return apiFailure('invalid_body', 'Expected { is_active: boolean }.', 400);
    }

    await db
      .update(schoolUsers)
      .set({ isActive: body.is_active, updatedAt: new Date() })
      .where(eq(schoolUsers.id, userId));

    return apiSuccess({
      id: userId,
      isActive: body.is_active,
      name: resolved.member.name,
    });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function DELETE(_request: NextRequest, context: RouteContext) {
  try {
    await requireSuperAdmin();

    const { schoolId, userId } = await context.params;
    const resolved = await resolveMember(schoolId, userId);
    if (resolved === null) {
      return apiFailure('not_found', 'That user is not a member of this school.', 404);
    }

    try {
      await db.delete(schoolUsers).where(eq(schoolUsers.id, userId));
    } catch (error) {
      if (isForeignKeyViolation(error)) {
        return apiFailure(
          'conflict',
          `${resolved.member.name} cannot be deleted because their name is on ` +
            'records the school keeps — attendance they marked, leave they ' +
            'approved, payroll they ran, or periods they taught. Deactivate ' +
            'them instead: they lose access immediately and the records stay ' +
            'attributable.',
          409,
        );
      }
      throw error;
    }

    return apiSuccess({ deleted: true, name: resolved.member.name });
  } catch (error) {
    return handleApiError(error);
  }
}
