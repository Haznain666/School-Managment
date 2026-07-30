import { and, asc, eq, type SQL } from 'drizzle-orm';
import type { NextRequest } from 'next/server';

import { branches, CURRICULUM_LEVELS, isCurriculumLevel } from '@/db/schema';
import { apiFailure, apiSuccess, handleApiError, readJsonBody } from '@/lib/api-response';
import { requireRole, withAuth } from '@/lib/auth-middleware';
import { isPakistaniCity } from '@/lib/cities';
import { db } from '@/lib/drizzle';
import { readOptionalString, readString } from '@/lib/validation';

/**
 * /api/branches — campuses within one school, from the school's own portal.
 *
 * Every query is filtered by `auth.locationId` (CRITICAL RULE #3). Users who
 * are pinned to a single branch see only that branch.
 *
 * The Super Admin equivalent lives at
 * `/api/super-admin/schools/[schoolId]/branches` and is cross-tenant.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    const auth = await withAuth(request);

    const conditions: SQL[] = [eq(branches.locationId, auth.locationId)];

    // branch_id = null in claims means "all branches of this school".
    if (auth.branchId !== null) {
      conditions.push(eq(branches.id, auth.branchId));
    }

    const rows = await db
      .select({
        id: branches.id,
        name: branches.name,
        code: branches.code,
        city: branches.city,
        curriculumLevel: branches.curriculumLevel,
        maxGrade: branches.maxGrade,
        address: branches.address,
        phone: branches.phone,
        email: branches.email,
        isActive: branches.isActive,
        isMainBranch: branches.isMainBranch,
        createdAt: branches.createdAt,
      })
      .from(branches)
      .where(and(...conditions))
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
  curriculumLevel?: unknown;
  maxGrade?: unknown;
  address?: unknown;
  phone?: unknown;
  email?: unknown;
}

export async function POST(request: NextRequest) {
  try {
    const auth = await requireRole(request, [
      'school_admin',
      'principal',
      'vice_principal',
    ]);

    const body = await readJsonBody<CreateBranchBody>(request);
    if (body === null) {
      return apiFailure('invalid_body', 'Expected a JSON body.', 400);
    }

    const name = readString(body.name);
    const code = readString(body.code).toUpperCase();
    const city = readString(body.city);

    if (name === '' || code === '') {
      return apiFailure('invalid_body', 'name and code are required.', 400);
    }

    if (!isPakistaniCity(city)) {
      return apiFailure('invalid_body', 'Select a city from the list.', 400);
    }

    if (!isCurriculumLevel(body.curriculumLevel)) {
      return apiFailure(
        'invalid_body',
        `curriculumLevel must be one of: ${CURRICULUM_LEVELS.join(', ')}.`,
        400,
      );
    }

    const inserted = await db
      .insert(branches)
      .values({
        // Tenant comes from the verified token, never from the body.
        locationId: auth.locationId,
        name,
        code,
        city,
        curriculumLevel: body.curriculumLevel,
        maxGrade: readOptionalString(body.maxGrade),
        address: readOptionalString(body.address),
        phone: readOptionalString(body.phone),
        email: readOptionalString(body.email),
      })
      // `code` is unique per school.
      .onConflictDoNothing()
      .returning({
        id: branches.id,
        name: branches.name,
        code: branches.code,
        city: branches.city,
        curriculumLevel: branches.curriculumLevel,
        isActive: branches.isActive,
      });

    const branch = inserted[0];
    if (branch === undefined) {
      return apiFailure(
        'already_exists',
        'A branch with that code already exists for this school.',
        409,
      );
    }

    return apiSuccess({ branch }, 201);
  } catch (error) {
    return handleApiError(error);
  }
}
