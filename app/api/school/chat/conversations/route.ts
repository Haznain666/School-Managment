import { withSchoolAuth } from '@/lib/api-auth';
import { apiFailure, apiSuccess, handleApiError, readJsonBody } from '@/lib/api-response';
import { countUnreadConversations, listInbox } from '@/lib/chat-queries';
import { openThread } from '@/lib/chat-threads';
import { getSchoolUserByUid } from '@/lib/school-queries';
import { CONVERSATION_SUBJECT_MAX } from '@/db/schema/chat-conversations';
import { MESSAGE_BODY_MAX } from '@/db/schema/chat-messages';
import { USER_ROLES } from '@/types/school-auth';

/**
 * /api/school/chat/conversations — the inbox, and opening a new thread.
 *
 * `allowedRoles: USER_ROLES` rather than a permission, and every role on
 * purpose. Chat is not permission-gated on the parent, pupil or teacher
 * portals — `chat.read` and `chat.send` exist so a school can take chat away
 * from a *staff* role, and a parent having an inbox is not an administrative
 * act any administrator has a reason to toggle. The same reasoning
 * `/api/school/notices/read` gives.
 *
 * What stops this being an open surface is that neither verb trusts the body
 * for anything but content: `listInbox` selects through the caller's own
 * participant rows, and `openThread` puts the target through
 * `initiateProblem`, which re-derives reachability from the school's data. A
 * crafted target id reaches somebody the caller could already have reached, or
 * it is refused.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface OpenBody {
  targetKind?: unknown;
  targetId?: unknown;
  subject?: unknown;
  body?: unknown;
}

export const GET = withSchoolAuth(
  async (_request, auth) => {
    try {
      const me = await getSchoolUserByUid(auth.locationId, auth.uid);
      if (me === null) return apiFailure('not_found', 'No account at this school.', 404);

      const [conversations, unread] = await Promise.all([
        listInbox(auth.locationId, me.id),
        countUnreadConversations(auth.locationId, me.id),
      ]);

      return apiSuccess({ conversations, unread });
    } catch (error) {
      return handleApiError(error);
    }
  },
  { allowedRoles: USER_ROLES },
);

export const POST = withSchoolAuth(
  async (request, auth) => {
    try {
      const body = await readJsonBody<OpenBody>(request);
      if (body === null) return apiFailure('invalid_body', 'Send a conversation.', 400);

      const targetKind = body.targetKind;
      const targetId = body.targetId;
      const messageBody = typeof body.body === 'string' ? body.body.trim() : '';
      const subjectRaw = typeof body.subject === 'string' ? body.subject.trim() : '';

      if (targetKind !== 'person' && targetKind !== 'inbox') {
        return apiFailure('invalid_body', 'Say who the message is for.', 400);
      }
      if (typeof targetId !== 'string' || targetId === '') {
        return apiFailure('invalid_body', 'Say who the message is for.', 400);
      }
      if (messageBody === '') {
        return apiFailure('invalid_body', 'Write a message first.', 400);
      }
      if (messageBody.length > MESSAGE_BODY_MAX) {
        return apiFailure(
          'invalid_body',
          `A message can be at most ${String(MESSAGE_BODY_MAX)} characters.`,
          400,
        );
      }
      if (subjectRaw.length > CONVERSATION_SUBJECT_MAX) {
        return apiFailure(
          'invalid_body',
          `A subject can be at most ${String(CONVERSATION_SUBJECT_MAX)} characters.`,
          400,
        );
      }

      const me = await getSchoolUserByUid(auth.locationId, auth.uid);
      if (me === null) return apiFailure('not_found', 'No account at this school.', 404);

      const result = await openThread({
        locationId: auth.locationId,
        actor: {
          schoolUserId: me.id,
          name: me.name,
          role: auth.role,
          branchId: auth.branchId,
        },
        target: { kind: targetKind, id: targetId },
        subject: subjectRaw === '' ? null : subjectRaw,
        body: messageBody,
      });

      if (!result.ok) return apiFailure('refused', result.problem, 403);

      return apiSuccess({ conversationId: result.conversationId }, 201);
    } catch (error) {
      return handleApiError(error);
    }
  },
  { allowedRoles: USER_ROLES },
);
