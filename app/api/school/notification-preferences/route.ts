import { withSchoolAuth } from '@/lib/api-auth';
import { apiFailure, apiSuccess, handleApiError, readJsonBody } from '@/lib/api-response';
import {
  getNotificationSettings,
  saveNotificationSettings,
  type NotificationSettings,
} from '@/lib/notification-preferences';
import { getSchoolUserByUid } from '@/lib/school-queries';
import { USER_ROLES } from '@/types/school-auth';

/**
 * /api/school/notification-preferences — a person's own email choices.
 *
 * GET   what they have chosen
 * PATCH change it
 *
 * ── `allowedRoles`, and every role ───────────────────────────────────────
 * Choosing whether to receive an email is not an administrative act, and there
 * is no permission that would sensibly gate it — a school switching off a
 * parent's ability to opt out of mail is not a control this product should
 * offer. What makes this safe is that both verbs act **only on the caller**:
 * the school-user id is resolved from the verified session, never read from the
 * body, so a crafted request cannot mute somebody else.
 *
 * Every category must be present in a PATCH. A partial body would make "absent"
 * mean both "leave it" and "off" depending on which key it was, which is the
 * ambiguity the bulk module screen was rebuilt to remove (`STATE.md` §5s).
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = withSchoolAuth(
  async (_request, auth) => {
    try {
      const me = await getSchoolUserByUid(auth.locationId, auth.uid);
      if (me === null) {
        return apiFailure('not_found', 'No account at this school.', 404);
      }

      return apiSuccess(await getNotificationSettings(auth.locationId, me.id));
    } catch (error) {
      return handleApiError(error);
    }
  },
  { allowedRoles: USER_ROLES },
);

interface PatchBody {
  announcements?: unknown;
  fees?: unknown;
  attendance?: unknown;
  chat?: unknown;
}

export const PATCH = withSchoolAuth(
  async (request, auth) => {
    try {
      const body = await readJsonBody<PatchBody>(request);
      if (
        body === null ||
        typeof body.announcements !== 'boolean' ||
        typeof body.fees !== 'boolean' ||
        typeof body.attendance !== 'boolean' ||
        typeof body.chat !== 'boolean'
      ) {
        return apiFailure(
          'invalid_body',
          'Send every preference as true or false.',
          400,
        );
      }

      const me = await getSchoolUserByUid(auth.locationId, auth.uid);
      if (me === null) {
        return apiFailure('not_found', 'No account at this school.', 404);
      }

      const settings: NotificationSettings = {
        announcements: body.announcements,
        fees: body.fees,
        attendance: body.attendance,
        chat: body.chat,
      };

      await saveNotificationSettings(auth.locationId, me.id, settings);

      return apiSuccess(settings);
    } catch (error) {
      return handleApiError(error);
    }
  },
  { allowedRoles: USER_ROLES },
);
