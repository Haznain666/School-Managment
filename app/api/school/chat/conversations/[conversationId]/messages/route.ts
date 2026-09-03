import { MESSAGE_BODY_MAX } from '@/db/schema/chat-messages';
import { withSchoolAuth } from '@/lib/api-auth';
import { apiFailure, apiSuccess, handleApiError, readJsonBody } from '@/lib/api-response';
import { containsLink } from '@/lib/chat-permissions';
import {
  isParticipant,
  listMessages,
  postMessage,
  sendProblem,
} from '@/lib/chat-queries';
import {
  escalate,
  SAFEGUARDING_ACKNOWLEDGEMENT,
  safeguardingProblem,
  schoolName,
} from '@/lib/chat-safeguarding';
import { getSchoolUserByUid } from '@/lib/school-queries';
import { USER_ROLES } from '@/types/school-auth';

/**
 * /api/school/chat/conversations/[id]/messages — the transcript, and posting.
 *
 * ── This is the route the Realtime design rests on ───────────────────────
 * The socket delivers `{conversationId, messageId}` and nothing readable; the
 * client then comes here for the content, and `withSchoolAuth` →
 * `membershipFor()` re-resolves who the caller is from `school_users` on *this*
 * request. That is the whole reason the signal carries no body — see
 * `db/schema/chat-signals.ts`. A conversation id in the URL is untrusted, and
 * `isParticipant` is what makes it safe.
 *
 * `?since=` is an ISO instant, so a client that has been disconnected asks for
 * what it missed rather than re-fetching two hundred messages it already has.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type RouteContext = { params: Promise<{ conversationId: string }> };

interface PostBody {
  body?: unknown;
}

export const GET = withSchoolAuth<RouteContext>(
  async (request, auth, context) => {
    try {
      const { conversationId } = await context.params;

      const me = await getSchoolUserByUid(auth.locationId, auth.uid);
      if (me === null) return apiFailure('not_found', 'No account at this school.', 404);

      if (!(await isParticipant(auth.locationId, conversationId, me.id))) {
        // 404 rather than 403: whether a conversation exists is itself
        // something a non-participant should not learn.
        return apiFailure('not_found', 'No such conversation.', 404);
      }

      const sinceRaw = new URL(request.url).searchParams.get('since');
      const since = sinceRaw === null ? null : new Date(sinceRaw);
      if (since !== null && Number.isNaN(since.getTime())) {
        return apiFailure('invalid_query', 'since must be an ISO timestamp.', 400);
      }

      const messages = await listMessages(auth.locationId, conversationId, since);
      return apiSuccess({ messages });
    } catch (error) {
      return handleApiError(error);
    }
  },
  { allowedRoles: USER_ROLES },
);

export const POST = withSchoolAuth<RouteContext>(
  async (request, auth, context) => {
    try {
      const { conversationId } = await context.params;

      const payload = await readJsonBody<PostBody>(request);
      const body = typeof payload?.body === 'string' ? payload.body.trim() : '';

      if (body === '') return apiFailure('invalid_body', 'Write a message first.', 400);
      if (body.length > MESSAGE_BODY_MAX) {
        return apiFailure(
          'invalid_body',
          `A message can be at most ${String(MESSAGE_BODY_MAX)} characters.`,
          400,
        );
      }

      const me = await getSchoolUserByUid(auth.locationId, auth.uid);
      if (me === null) return apiFailure('not_found', 'No account at this school.', 404);

      // One read that is both the membership check and every window, quota and
      // turn-taking rule. A refusal here is a sentence the sender can act on.
      const problem = await sendProblem(auth.locationId, me.id, conversationId);
      if (problem !== null) return apiFailure('refused', problem, 403);

      const flaggedReason = safeguardingProblem(body);

      const posted = await postMessage({
        locationId: auth.locationId,
        conversationId,
        senderSchoolUserId: me.id,
        senderName: me.name,
        senderRole: auth.role,
        body,
        flaggedReason,
      });

      // The message is stored first and escalated second, and never the other
      // way round: a pupil's words must survive a failing mail queue. `escalate`
      // never throws, and the acknowledgement is posted whatever it did — a
      // child who has just said the hardest thing they will type should not be
      // met with silence because an SMTP host was slow.
      if (flaggedReason !== null) {
        await escalate({
          locationId: auth.locationId,
          conversationId,
          messageId: posted.id,
          reason: flaggedReason,
        });

        await postMessage({
          locationId: auth.locationId,
          conversationId,
          senderSchoolUserId: null,
          senderName: await schoolName(auth.locationId),
          senderRole: 'system',
          kind: 'system',
          body: SAFEGUARDING_ACKNOWLEDGEMENT,
        });
      }

      return apiSuccess(
        {
          message: {
            id: posted.id,
            createdAt: posted.createdAt,
            // The client renders a pupil's links as inert text. Deciding it
            // here means the same answer reaches every portal rather than four
            // regexes drifting apart.
            linksInert: auth.role === 'student' && containsLink(body),
          },
        },
        201,
      );
    } catch (error) {
      return handleApiError(error);
    }
  },
  { allowedRoles: USER_ROLES },
);
