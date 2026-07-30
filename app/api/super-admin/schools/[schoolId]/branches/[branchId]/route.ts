import { and, eq } from 'drizzle-orm';
import type { NextRequest } from 'next/server';

import { branches, isCurriculumLevel } from '@/db/schema';
import { apiFailure, apiSuccess, handleApiError, readJsonBody } from '@/lib/api-response';
import { demoteOtherMainBranches } from '@/lib/branches';
import { isPakistaniCity } from '@/lib/cities';
import { db } from '@/lib/drizzle';
import { resolveLocationId } from '@/lib/schools';
import { requireSuperAdmin } from '@/lib/super-admin-guard';
import { isUuid, readOptionalString, readString } from '@/lib/validation';

/**
 * /api/super-admin/schools/[schoolId]/branches/[branchId]
 *
 * GET / PATCH / DELETE one campus.
 *
 * Every query is filtered by both `location_id` and `id`, so a branch UUID
 * belonging to another school cannot be read or written through this school's
 * URL.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type RouteContext = { params: Promise<{ schoolId: string; branchId: string }> };

/** Shared preamble: authorise, validate ids, resolve the tenant. */
async function resolveContext(
  context: RouteContext,
): Promise<{ locationId: string; branchId: string } | null> {
  const { schoolId, branchId } = await context.params;
  if (!isUuid(schoolId) || !isUuid(branchId)) return null;

  const locationId = await resolveLocationId(schoolId);
  return locationId === null ? null : { locationId, branchId };
}

export async function GET(_request: NextRequest, context: RouteContext) {
  try {
    await requireSuperAdmin();

    const resolved = await resolveContext(context);
    if (resolved === null) return apiFailure('not_found', 'Branch not found.', 404);

    const rows = await db
      .select()
      .from(branches)
      .where(
        and(
          eq(branches.id, resolved.branchId),
          eq(branches.locationId, resolved.locationId),
        ),
      )
      .limit(1);

    const branch = rows[0];
    if (branch === undefined) return apiFailure('not_found', 'Branch not found.', 404);

    return apiSuccess({ branch });
  } catch (error) {
    return handleApiError(error);
  }
}

interface UpdateBranchBody {
  name?: unknown;
  code?: unknown;
  city?: unknown;
  address?: unknown;
  phone?: unknown;
  email?: unknown;
  curriculumLevel?: unknown;
  maxGrade?: unknown;
  isMainBranch?: unknown;
  isActive?: unknown;
}

export async function PATCH(request: NextRequest, context: RouteContext) {
  try {
    await requireSuperAdmin();

    const resolved = await resolveContext(context);
    if (resolved === null) return apiFailure('not_found', 'Branch not found.', 404);

    const body = await readJsonBody<UpdateBranchBody>(request);
    if (body === null) {
      return apiFailure('invalid_body', 'Expected a JSON body.', 400);
    }

    const updates: Partial<typeof branches.$inferInsert> = {};

    if (body.name !== undefined) {
      const name = readString(body.name);
      if (name === '') {
        return apiFailure('invalid_body', 'Branch name cannot be empty.', 400);
      }
      updates.name = name;
    }

    if (body.code !== undefined) {
      const code = readString(body.code).toUpperCase();
      if (code === '') {
        return apiFailure('invalid_body', 'Branch code cannot be empty.', 400);
      }
      updates.code = code;
    }

    if (body.city !== undefined) {
      const city = readString(body.city);
      if (!isPakistaniCity(city)) {
        return apiFailure('invalid_body', 'Select a city from the list.', 400);
      }
      updates.city = city;
    }

    if (body.curriculumLevel !== undefined) {
      if (!isCurriculumLevel(body.curriculumLevel)) {
        return apiFailure(
          'invalid_body',
          'curriculumLevel must be MATRIC, O_LEVELS, A_LEVELS or MIXED.',
          400,
        );
      }
      updates.curriculumLevel = body.curriculumLevel;
    }

    if (body.address !== undefined) updates.address = readOptionalString(body.address);
    if (body.phone !== undefined) updates.phone = readOptionalString(body.phone);
    if (body.email !== undefined) updates.email = readOptionalString(body.email);
    if (body.maxGrade !== undefined) updates.maxGrade = readOptionalString(body.maxGrade);
    if (typeof body.isActive === 'boolean') updates.isActive = body.isActive;
    if (typeof body.isMainBranch === 'boolean') updates.isMainBranch = body.isMainBranch;

    if (Object.keys(updates).length === 0) {
      return apiFailure('invalid_body', 'No fields to update.', 400);
    }

    updates.updatedAt = new Date();

    const updated = await db
      .update(branches)
      .set(updates)
      .where(
        and(
          eq(branches.id, resolved.branchId),
          eq(branches.locationId, resolved.locationId),
        ),
      )
      .returning();

    const branch = updated[0];
    if (branch === undefined) return apiFailure('not_found', 'Branch not found.', 404);

    // Promoting this branch demotes whichever one held the flag before.
    if (updates.isMainBranch === true) {
      await demoteOtherMainBranches(resolved.locationId, branch.id);
    }

    return apiSuccess({ branch });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function DELETE(_request: NextRequest, context: RouteContext) {
  try {
    await requireSuperAdmin();

    const resolved = await resolveContext(context);
    if (resolved === null) return apiFailure('not_found', 'Branch not found.', 404);

    // Soft delete, matching schools: students and staff reference this branch.
    const updated = await db
      .update(branches)
      .set({ isActive: false, isMainBranch: false, updatedAt: new Date() })
      .where(
        and(
          eq(branches.id, resolved.branchId),
          eq(branches.locationId, resolved.locationId),
        ),
      )
      .returning({ id: branches.id, isActive: branches.isActive });

    const branch = updated[0];
    if (branch === undefined) return apiFailure('not_found', 'Branch not found.', 404);

    return apiSuccess({ branch, deactivated: true });
  } catch (error) {
    return handleApiError(error);
  }
}
