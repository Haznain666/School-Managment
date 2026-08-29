import { withSchoolAuth } from '@/lib/api-auth';
import { apiSuccess, handleApiError } from '@/lib/api-response';
import { searchForSession } from '@/lib/portal-search';
import { USER_ROLES } from '@/types/school-auth';

/**
 * GET /api/school/search?q=… — global search, scoped to the caller's portal.
 *
 * The route is four lines because the scope resolution is in
 * `lib/portal-search.ts`, shared with `/dashboard/search` and its three
 * siblings. That is deliberate: the header dropdown and the results page must
 * not be able to disagree about what a person may see, and the way to guarantee
 * that is for there to be one function that decides it.
 *
 * Every role, not just the administrative ones. The search box is in
 * `PortalFrame`'s header, which is the teacher, parent and student portals too,
 * and each gets its own scoped result set.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = withSchoolAuth(
  async (request, auth) => {
    try {
      const results = await searchForSession(
        // Same four fields the results page passes, so the header dropdown and
        // `/dashboard/search` cannot disagree about which campuses a person
        // may see — which is the property this module exists to guarantee.
        {
          locationId: auth.locationId,
          uid: auth.uid,
          role: auth.role,
          branchId: auth.branchId,
        },
        request.nextUrl.searchParams.get('q') ?? '',
      );

      return apiSuccess(results);
    } catch (error) {
      return handleApiError(error);
    }
  },
  { allowedRoles: USER_ROLES },
);
