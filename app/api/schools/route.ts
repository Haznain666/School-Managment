import { eq } from 'drizzle-orm';
import type { NextRequest } from 'next/server';

import { schoolSubdomains, type SchoolModuleFlags } from '@/db/schema';
import { apiFailure, apiSuccess, handleApiError, readJsonBody } from '@/lib/api-response';
import { withAuth } from '@/lib/auth-middleware';
import { db } from '@/lib/drizzle';
import { isValidSubdomain } from '@/lib/schools';

/**
 * /api/schools — the tenant directory.
 *
 * GET  returns the caller's own school (super_admin: every school).
 * POST provisions a new school and is super_admin only.
 *
 * Note the asymmetry: a school_admin can never widen this to another tenant,
 * because the filter comes from `auth.locationId` — their verified claim — and
 * there is no request parameter that can change it.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    const auth = await withAuth(request);

    const baseQuery = db
      .select({
        subdomain: schoolSubdomains.subdomain,
        locationId: schoolSubdomains.locationId,
        schoolName: schoolSubdomains.schoolName,
        status: schoolSubdomains.status,
        moduleFlags: schoolSubdomains.moduleFlags,
        colorPalette: schoolSubdomains.colorPalette,
        logoUrl: schoolSubdomains.logoUrl,
        createdAt: schoolSubdomains.createdAt,
      })
      .from(schoolSubdomains);

    const rows =
      auth.role === 'super_admin'
        ? await baseQuery
        : await baseQuery.where(eq(schoolSubdomains.locationId, auth.locationId));

    return apiSuccess({ schools: rows });
  } catch (error) {
    return handleApiError(error);
  }
}

interface CreateSchoolBody {
  subdomain?: unknown;
  locationId?: unknown;
  schoolName?: unknown;
  moduleFlags?: unknown;
  logoUrl?: unknown;
}

export async function POST(request: NextRequest) {
  try {
    const auth = await withAuth(request);

    // Provisioning a tenant is a platform operation, not a school operation.
    if (auth.role !== 'super_admin') {
      return apiFailure('forbidden_role', 'Only a super admin may create schools.', 403);
    }

    const body = await readJsonBody<CreateSchoolBody>(request);
    if (body === null) {
      return apiFailure('invalid_body', 'Expected a JSON body.', 400);
    }

    const subdomain =
      typeof body.subdomain === 'string' ? body.subdomain.trim().toLowerCase() : '';
    const locationId =
      typeof body.locationId === 'string' ? body.locationId.trim() : '';
    const schoolName =
      typeof body.schoolName === 'string' ? body.schoolName.trim() : '';

    if (!isValidSubdomain(subdomain)) {
      return apiFailure(
        'invalid_subdomain',
        'Subdomain must be lowercase letters, digits and hyphens, and must not be reserved.',
        400,
      );
    }

    if (locationId === '' || schoolName === '') {
      return apiFailure(
        'invalid_body',
        'locationId (GHL Location ID) and schoolName are required.',
        400,
      );
    }

    const moduleFlags =
      typeof body.moduleFlags === 'object' && body.moduleFlags !== null
        ? (body.moduleFlags as SchoolModuleFlags)
        : undefined;

    const inserted = await db
      .insert(schoolSubdomains)
      .values({
        subdomain,
        locationId,
        schoolName,
        ...(moduleFlags === undefined ? {} : { moduleFlags }),
        logoUrl: typeof body.logoUrl === 'string' ? body.logoUrl : null,
      })
      // Both `subdomain` and `location_id` are unique; a clash means the school
      // (or the subdomain) already exists.
      .onConflictDoNothing()
      .returning({
        subdomain: schoolSubdomains.subdomain,
        locationId: schoolSubdomains.locationId,
        schoolName: schoolSubdomains.schoolName,
        status: schoolSubdomains.status,
      });

    const school = inserted[0];
    if (school === undefined) {
      return apiFailure(
        'already_exists',
        'That subdomain or Location ID is already registered.',
        409,
      );
    }

    return apiSuccess({ school }, 201);
  } catch (error) {
    return handleApiError(error);
  }
}
