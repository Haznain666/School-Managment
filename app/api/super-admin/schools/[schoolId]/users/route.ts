import { asc, eq } from 'drizzle-orm';
import type { NextRequest } from 'next/server';

import { branches, schoolUsers } from '@/db/schema';
import { apiFailure, apiSuccess, handleApiError } from '@/lib/api-response';
import { db } from '@/lib/drizzle';
import { resolveLocationId } from '@/lib/schools';
import { requireSuperAdmin } from '@/lib/super-admin-guard';
import { isUuid } from '@/lib/validation';

/**
 * GET /api/super-admin/schools/[schoolId]/users
 *
 * Every member of one school, for the platform operator's view. Cross-tenant
 * by design — the Super Admin has no tenant of their own — so the gate is the
 * operator session, checked by middleware and again here.
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
