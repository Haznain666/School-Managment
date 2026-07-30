import { apiSuccess, handleApiError } from '@/lib/api-response';
import { withSchoolAuth } from '@/lib/api-auth';
import { listBranchOptions } from '@/lib/school-queries';
import { USER_ROLES } from '@/types/school-auth';

/**
 * GET /api/school/branches — active campuses of the caller's own school.
 *
 * Read-only from inside a school: branches are created and edited from the
 * Super Admin panel. This exists so the invite and user forms can offer a
 * branch picker.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = withSchoolAuth(
  async (_request, auth) => {
    try {
      return apiSuccess({ branches: await listBranchOptions(auth.locationId) });
    } catch (error) {
      return handleApiError(error);
    }
  },
  { allowedRoles: USER_ROLES },
);
