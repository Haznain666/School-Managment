import { withSchoolAuth } from '@/lib/api-auth';
import { apiSuccess, handleApiError } from '@/lib/api-response';
import {
  countUnreadNotifications,
  listNotifications,
  markNotificationsRead,
} from '@/lib/notifications';
import { getSchoolUserByUid } from '@/lib/school-queries';
import { USER_ROLES } from '@/types/school-auth';

/**
 * GET  /api/school/notifications — this person's bell.
 * POST /api/school/notifications — mark everything in it read.
 *
 * ── Every role, not just the administrative ones ─────────────────────────
 * The bell is in `PortalFrame`'s header, which is the teacher, parent and
 * student portals as well. Nothing writes them a notification today, so their
 * bell is empty — but a route that 403'd them would mean the day something
 * does, the feature looks broken rather than new.
 *
 * ── No ids on the wire, in either direction ──────────────────────────────
 * "Mark read" takes no list. The recipient is resolved from the verified
 * session and the `UPDATE` is scoped by the same predicate the listing uses, so
 * there is no request in which one person can clear another's bell. An
 * id-taking endpoint would have to prove ownership per id, and the version that
 * forgets is indistinguishable from the version that does not.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = withSchoolAuth(
  async (_request, auth) => {
    try {
      const me = await getSchoolUserByUid(auth.locationId, auth.uid);

      /*
       * The platform operator inside a school has no `school_users` row — they
       * are not a member of it. An empty bell is the correct answer for them
       * rather than an error: their own notifications are on the platform
       * portal, which is where they were addressed.
       */
      if (me === null) {
        return apiSuccess({ notifications: [], unread: 0 });
      }

      const recipient = { audience: 'school_user' as const, schoolUserId: me.id };

      const [rows, unread] = await Promise.all([
        listNotifications(recipient),
        countUnreadNotifications(recipient),
      ]);

      return apiSuccess({ notifications: rows, unread });
    } catch (error) {
      return handleApiError(error);
    }
  },
  { allowedRoles: USER_ROLES },
);

export const POST = withSchoolAuth(
  async (_request, auth) => {
    try {
      const me = await getSchoolUserByUid(auth.locationId, auth.uid);
      if (me === null) return apiSuccess({ marked: 0 });

      const marked = await markNotificationsRead({
        audience: 'school_user',
        schoolUserId: me.id,
      });

      return apiSuccess({ marked });
    } catch (error) {
      return handleApiError(error);
    }
  },
  { allowedRoles: USER_ROLES },
);
