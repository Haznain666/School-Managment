import { eq } from 'drizzle-orm';

import { schools } from '@/db/schema';
import { apiFailure, apiSuccess, handleApiError } from '@/lib/api-response';
import { withSchoolAuth } from '@/lib/api-auth';
import { db } from '@/lib/drizzle';
import { getSchoolBranding } from '@/lib/school-tenant';
import { USER_ROLES } from '@/types/school-auth';

/**
 * GET /api/school/settings — school profile plus active branding.
 *
 * Used by portal layouts to populate the navbar. Read-only for every role:
 * school details are edited from the Super Admin panel, not from inside the
 * school.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = withSchoolAuth(
  async (_request, auth) => {
    try {
      const rows = await db
        .select({
          id: schools.id,
          name: schools.name,
          slug: schools.slug,
          city: schools.city,
          address: schools.address,
          phone: schools.phone,
          email: schools.email,
          principalName: schools.principalName,
          isActive: schools.isActive,
        })
        .from(schools)
        .where(eq(schools.locationId, auth.locationId))
        .limit(1);

      const school = rows[0];
      if (school === undefined) {
        return apiFailure('not_found', 'School not found.', 404);
      }

      const branding = await getSchoolBranding(auth.locationId);

      return apiSuccess({
        school,
        branding: {
          logoUrl: branding?.logoUrl ?? null,
          palette: branding?.palette ?? null,
        },
      });
    } catch (error) {
      return handleApiError(error);
    }
  },
  { allowedRoles: USER_ROLES },
);
