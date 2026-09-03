import { withSchoolAuth } from '@/lib/api-auth';
import { apiFailure, apiSuccess, handleApiError } from '@/lib/api-response';
import { isParticipant, markConversationRead } from '@/lib/chat-queries';
import { getSchoolUserByUid } from '@/lib/school-queries';
import { USER_ROLES } from '@/types/school-auth';

/**
 * /api/school/chat/conversations/[id]/read — moves the caller's own marker.
 *
 * Only ever writes the row belonging to the caller, which is what makes an
 * open `allowedRoles` safe here: a crafted conversation id marks nothing,
 * because `markConversationRead` matches on the caller's `school_user_id` as
 * well. `isParticipant` runs first anyway so the answer is honest rather than a
 * silent no-op.
 *
 * Fire-and-forget from the client, in the shape
 * `components/comms/MarkNoticesRead.tsx` already uses.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type RouteContext = { params: Promise<{ conversationId: string }> };

export const POST = withSchoolAuth<RouteContext>(
  async (_request, auth, context) => {
    try {
      const { conversationId } = await context.params;

      const me = await getSchoolUserByUid(auth.locationId, auth.uid);
      if (me === null) return apiFailure('not_found', 'No account at this school.', 404);

      if (!(await isParticipant(auth.locationId, conversationId, me.id))) {
        return apiFailure('not_found', 'No such conversation.', 404);
      }

      await markConversationRead(auth.locationId, conversationId, me.id);
      return apiSuccess({ read: true });
    } catch (error) {
      return handleApiError(error);
    }
  },
  { allowedRoles: USER_ROLES },
);
