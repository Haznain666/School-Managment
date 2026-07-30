import { apiFailure, apiSuccess, handleApiError } from '@/lib/api-response';
import { withSchoolAuth } from '@/lib/api-auth';
import { getSchoolUserByUid } from '@/lib/school-queries';
import { USER_ROLES } from '@/types/school-auth';

/**
 * GET /api/school/me — the caller's own profile.
 *
 * Available to every signed-in role; the record returned is always the
 * caller's own, looked up by the uid in their verified session.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = withSchoolAuth(
  async (_request, auth) => {
    try {
      const user = await getSchoolUserByUid(auth.locationId, auth.uid);

      if (user === null) {
        return apiFailure('not_found', 'No profile found for this account.', 404);
      }

      return apiSuccess({ user, role: auth.role, branchId: auth.branchId });
    } catch (error) {
      return handleApiError(error);
    }
  },
  { allowedRoles: USER_ROLES },
);
