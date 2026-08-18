import { asc, eq } from 'drizzle-orm';
import type { NextRequest } from 'next/server';

import { branches, isCurriculumLevel } from '@/db/schema';
import { demoteOtherMainBranches } from '@/lib/branches';
import { apiFailure, apiSuccess, handleApiError, readJsonBody } from '@/lib/api-response';
import { sanitiseClassLevels } from '@/lib/branch-classes';
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
 * /api/super-admin/schools/[schoolId]/branches
 *
 * GET  every campus of one school
 * POST create a campus
 *
 * A school has at most one main branch. When a branch is created as the main
 * one, the previous holder is demoted in the same request.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type RouteContext = { params: Promise<{ schoolId: string }> };

export async function GET(_request: NextRequest, context: RouteContext) {
  try {
    await requireSuperAdmin();

    const { schoolId } = await context.params;
    if (!isUuid(schoolId)) {
      return apiFailure('not_found', 'School not found.', 404);
    }

    const locationId = await resolveLocationId(schoolId);
    if (locationId === null) {
      return apiFailure('not_found', 'School not found.', 404);
    }

    const rows = await db
      .select()
      .from(branches)
      .where(eq(branches.locationId, locationId))
      .orderBy(asc(branches.code));

    return apiSuccess({ branches: rows });
  } catch (error) {
    return handleApiError(error);
  }
}

interface CreateBranchBody {
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

export async function POST(request: NextRequest, context: RouteContext) {
  try {
    await requireSuperAdmin();

    const { schoolId } = await context.params;
    if (!isUuid(schoolId)) {
      return apiFailure('not_found', 'School not found.', 404);
    }

    const locationId = await resolveLocationId(schoolId);
    if (locationId === null) {
      return apiFailure('not_found', 'School not found.', 404);
    }

    const body = await readJsonBody<CreateBranchBody>(request);
    if (body === null) {
      return apiFailure('invalid_body', 'Expected a JSON body.', 400);
    }

    const name = readString(body.name);
    const code = readString(body.code).toUpperCase();
    const city = readString(body.city);

    if (name === '' || code === '') {
      return apiFailure('invalid_body', 'Branch name and code are required.', 400);
    }

    if (!isPakistaniCity(city)) {
      return apiFailure('invalid_body', 'Select a city from the list.', 400);
    }

    if (!isCurriculumLevel(body.curriculumLevel)) {
      return apiFailure(
        'invalid_body',
        'curriculumLevel must be MATRIC, O_LEVELS, A_LEVELS or MIXED.',
        400,
      );
    }

    // Required on MIXED and meaningless off it. Enforced here rather than by a
    // CHECK constraint — see the column comment in `db/schema/branches.ts`.
    const boardName = readOptionalString(body.boardName);
    if (body.curriculumLevel === 'MIXED' && boardName === null) {
      return apiFailure(
        'invalid_body',
        'Name the board this campus follows. “Mixed” on its own does not say which.',
        400,
      );
    }

    const landline = readLandlineField(body.landline);
    if (!landline.ok) return apiFailure('invalid_body', landline.message, 400);

    const phone = readMobileField(body.phone);
    if (!phone.ok) return apiFailure('invalid_body', phone.message, 400);

    const email = readEmailField(body.email);
    if (!email.ok) return apiFailure('invalid_body', email.message, 400);

    const isMainBranch = body.isMainBranch === true;

    const inserted = await db
      .insert(branches)
      .values({
        locationId,
        name,
        code,
        city,
        address: readOptionalString(body.address),
        latitude: readCoordinate(body.latitude, 'latitude'),
        longitude: readCoordinate(body.longitude, 'longitude'),
        landline: landline.value,
        phone: phone.value,
        email: email.value,
        curriculumLevel: body.curriculumLevel,
        // Dropped rather than refused when it does not match the curriculum:
        // the operator changed the curriculum after ticking, which is a
        // correction, not an error.
        classLevels: sanitiseClassLevels(body.classLevels, body.curriculumLevel),
        boardName: body.curriculumLevel === 'MIXED' ? boardName : null,
        isMainBranch,
        isActive: body.isActive === false ? false : true,
      })
      // `code` is unique per school.
      .onConflictDoNothing()
      .returning();

    const branch = inserted[0];
    if (branch === undefined) {
      return apiFailure(
        'already_exists',
        'A branch with that code already exists for this school.',
        409,
      );
    }

    if (isMainBranch) {
      await demoteOtherMainBranches(locationId, branch.id);
    }

    return apiSuccess({ branch }, 201);
  } catch (error) {
    return handleApiError(error);
  }
}

