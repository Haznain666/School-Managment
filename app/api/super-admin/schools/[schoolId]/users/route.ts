import { asc, eq } from 'drizzle-orm';
import type { NextRequest } from 'next/server';

import { branches, schoolUsers } from '@/db/schema';
import {
  apiFailure,
  apiSuccess,
  handleApiError,
  readJsonBody,
} from '@/lib/api-response';
import { db } from '@/lib/drizzle';
import { createFirstSchoolAdmin } from '@/lib/school-bootstrap';
import { resolveLocationId } from '@/lib/schools';
import { requireSuperAdmin } from '@/lib/super-admin-guard';
import { isUuid, readOptionalString, readString } from '@/lib/validation';

/**
 * /api/super-admin/schools/[schoolId]/users
 *
 * GET  every member of one school, for the platform operator's view
 * POST provision an administrator for a school that has none
 *
 * Cross-tenant by design — the Super Admin has no tenant of their own — so the
 * gate is the operator session, checked by middleware and again here.
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
      .select({
        id: schoolUsers.id,
        name: schoolUsers.name,
        role: schoolUsers.role,
        phone: schoolUsers.phone,
        email: schoolUsers.email,
        isActive: schoolUsers.isActive,
        branchName: branches.name,
        joinedAt: schoolUsers.joinedAt,
        // Drives whether an emergency link can be issued at all.
        hasFirebaseAccount: schoolUsers.firebaseUid,
      })
      .from(schoolUsers)
      .leftJoin(branches, eq(branches.id, schoolUsers.branchId))
      .where(eq(schoolUsers.locationId, locationId))
      .orderBy(asc(schoolUsers.name));

    return apiSuccess({
      users: rows.map((row) => ({
        id: row.id,
        name: row.name,
        role: row.role,
        phone: row.phone,
        email: row.email,
        isActive: row.isActive,
        branchName: row.branchName,
        joinedAt: row.joinedAt,
        hasFirebaseAccount: row.hasFirebaseAccount !== null,
      })),
    });
  } catch (error) {
    return handleApiError(error);
  }
}

interface CreateAdminBody {
  name?: unknown;
  phone?: unknown;
  email?: unknown;
}

/**
 * POST /api/super-admin/schools/[schoolId]/users
 *
 * Creates a `school_admin` for a school that cannot yet create one for itself.
 *
 * Deliberately limited to that one role. Everyone else — teachers, accountants,
 * parents — is invited from inside the school portal by someone who belongs
 * there, and this endpoint exists only to break the circular dependency that
 * leaves a brand-new school with nobody able to sign in.
 */
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

    const body = await readJsonBody<CreateAdminBody>(request);
    if (body === null) {
      return apiFailure('invalid_body', 'Expected a JSON body.', 400);
    }

    const name = readString(body.name);
    const phone = readString(body.phone);

    if (name === '') {
      return apiFailure('invalid_body', "Enter the administrator's name.", 400);
    }
    if (phone === '') {
      return apiFailure('invalid_body', 'Enter a mobile number.', 400);
    }

    const result = await createFirstSchoolAdmin(db, {
      locationId,
      name,
      phone,
      email: readOptionalString(body.email),
    });

    // Here the details were typed deliberately rather than inherited from a
    // school profile, so an unusable number is a mistake worth reporting
    // instead of a condition worth tolerating.
    if (result.status === 'skipped') {
      return apiFailure('invalid_body', result.reason, 400);
    }

    if (result.status === 'exists') {
      return apiFailure(
        'already_exists',
        'Someone with that number already belongs to this school.',
        409,
      );
    }

    return apiSuccess({ userId: result.userId, phone: result.phone }, 201);
  } catch (error) {
    return handleApiError(error);
  }
}
