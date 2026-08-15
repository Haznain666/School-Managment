import { markNoticesRead } from '@/lib/announcement-queries';
import { withSchoolAuth } from '@/lib/api-auth';
import { apiFailure, apiSuccess, handleApiError, readJsonBody } from '@/lib/api-response';
import { getSchoolUserByUid } from '@/lib/school-queries';
import { USER_ROLES } from '@/types/school-auth';

/**
 * /api/school/notices/read — marks notices read for whoever is calling.
 *
 * `allowedRoles` rather than a permission, and deliberately every role: the
 * notice board is not permission-gated on any of the four portals, and a parent
 * marking their own notice read is not an administrative act. What stops this
 * being an open write is that it only ever marks rows *for the caller* —
 * `markNoticesRead` selects from the delivery log rather than trusting the ids
 * in the body, so a crafted request cannot create a read marker against an
 * announcement addressed to somebody else.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface ReadBody {
  announcementIds?: unknown;
}

export const POST = withSchoolAuth(
  async (request, auth) => {
    try {
      const body = await readJsonBody<ReadBody>(request);
      if (body === null || !Array.isArray(body.announcementIds)) {
        return apiFailure('invalid_body', 'Send the announcement ids as a list.', 400);
      }
      if (body.announcementIds.length > 200) {
        return apiFailure('invalid_body', 'That is more notices than a board holds.', 400);
      }

      const ids = body.announcementIds.filter(
        (entry): entry is string => typeof entry === 'string' && entry !== '',
      );

      const me = await getSchoolUserByUid(auth.locationId, auth.uid);
      if (me === null) {
        return apiFailure('not_found', 'No account at this school.', 404);
      }

      return apiSuccess({ marked: await markNoticesRead(auth.locationId, me.id, ids) });
    } catch (error) {
      return handleApiError(error);
    }
  },
  { allowedRoles: USER_ROLES },
);
