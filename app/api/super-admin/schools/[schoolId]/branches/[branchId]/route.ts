import { and, eq } from 'drizzle-orm';
import type { NextRequest } from 'next/server';

import { branches, isCurriculumLevel } from '@/db/schema';
import { apiFailure, apiSuccess, handleApiError, readJsonBody } from '@/lib/api-response';
import { sanitiseClassLevels } from '@/lib/branch-classes';
import { demoteOtherMainBranches } from '@/lib/branches';
import { isPakistaniCity } from '@/lib/cities';
import { db } from '@/lib/drizzle';
import {
  readCoordinate,
  readEmailField,
  readLandlineField,
  readMobileField,
} from '@/lib/profile-fields';
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
  latitude?: unknown;
  longitude?: unknown;
  landline?: unknown;
  phone?: unknown;
  email?: unknown;
  curriculumLevel?: unknown;
  boardName?: unknown;
  classLevels?: unknown;
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

    /**
     * The row as it stands, needed before anything is validated.
     *
     * Two fields cannot be judged from the patch alone. `classLevels` has to be
     * filtered against the curriculum this branch will *end up* on, which is
     * the one in the body when it names one and the stored one otherwise — and
     * getting that wrong either drops rungs the operator just ticked or keeps
     * ones the new curriculum has never had. `boardName` has the same problem
     * in reverse: a patch that switches an existing branch to MIXED must
     * demand a board name even though the field it is checking is not in the
     * body.
     */
    const existingRows = await db
      .select({
        curriculumLevel: branches.curriculumLevel,
        boardName: branches.boardName,
        classLevels: branches.classLevels,
      })
      .from(branches)
      .where(
        and(
          eq(branches.id, resolved.branchId),
          eq(branches.locationId, resolved.locationId),
        ),
      )
      .limit(1);

    const existing = existingRows[0];
    if (existing === undefined) return apiFailure('not_found', 'Branch not found.', 404);

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

    // What the branch will be on once this patch lands.
    const curriculum = updates.curriculumLevel ?? existing.curriculumLevel;

    if (body.boardName !== undefined || updates.curriculumLevel !== undefined) {
      const boardName =
        body.boardName === undefined
          ? existing.boardName
          : readOptionalString(body.boardName);

      if (curriculum === 'MIXED' && boardName === null) {
        return apiFailure(
          'invalid_body',
          'Name the board this campus follows. “Mixed” on its own does not say which.',
          400,
        );
      }

      // Cleared off MIXED, so a branch moved to a named curriculum does not
      // keep a board name that now contradicts its own level.
      updates.boardName = curriculum === 'MIXED' ? boardName : null;
    }

    if (body.classLevels !== undefined) {
      updates.classLevels = sanitiseClassLevels(body.classLevels, curriculum);
    } else if (updates.curriculumLevel !== undefined) {
      // The curriculum changed without the classes being resubmitted — from the
      // edit form this cannot happen, but a partial patch can do it. Re-filter
      // rather than leave rungs the new curriculum does not have.
      updates.classLevels = sanitiseClassLevels(existing.classLevels, curriculum);
    }

    if (body.address !== undefined) updates.address = readOptionalString(body.address);
    if (body.latitude !== undefined) {
      updates.latitude = readCoordinate(body.latitude, 'latitude');
    }
    if (body.longitude !== undefined) {
      updates.longitude = readCoordinate(body.longitude, 'longitude');
    }

    if (body.landline !== undefined) {
      const landline = readLandlineField(body.landline);
      if (!landline.ok) return apiFailure('invalid_body', landline.message, 400);
      updates.landline = landline.value;
    }

    if (body.phone !== undefined) {
      const phone = readMobileField(body.phone);
      if (!phone.ok) return apiFailure('invalid_body', phone.message, 400);
      updates.phone = phone.value;
    }

    if (body.email !== undefined) {
      const email = readEmailField(body.email);
      if (!email.ok) return apiFailure('invalid_body', email.message, 400);
      updates.email = email.value;
    }

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
