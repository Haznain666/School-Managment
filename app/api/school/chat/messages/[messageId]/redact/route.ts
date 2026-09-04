import { withSchoolAuth } from '@/lib/api-auth';
import { apiFailure, apiSuccess, handleApiError, readJsonBody } from '@/lib/api-response';
import { redactMessage } from '@/lib/chat-threads';
import { getSchoolUserByUid } from '@/lib/school-queries';

/**
 * /api/school/chat/messages/[id]/redact — removing a message, without deleting it.
 *
 * ── There is no DELETE here, and there never will be ─────────────────────
 * `CLAUDE.md` justifies the append-only ledger by saying a parent disputing a
 * figure in March is asking about a payment made in October. A parent disputing
 * what a *teacher said* is the identical problem and the one a school is least
 * able to survive getting wrong, so `chat_messages` has no destructive path.
 *
 * This writes `redacted_at`, `redacted_by` and `redaction_reason`. The body
 * stays exactly as written, the bubble renders "Message removed" and names who
 * removed it, and the export still carries the original. `ROADMAP.md` reached
 * this from the other direction on 2026-08-07 — deleted-message-shaped holes in
 * a safeguarding record are a problem.
 *
 * `PATCH` rather than `DELETE` for the same reason: the row is being amended,
 * not removed, and the verb should not suggest otherwise.
 *
 * The reason is required, and a second moderator pressing the same button does
 * not overwrite the first one's — `redactMessage` matches on `redacted_at IS
 * NULL`, so the first answer stands.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type RouteContext = { params: Promise<{ messageId: string }> };

interface RedactBody {
  reason?: unknown;
}

export const PATCH = withSchoolAuth<RouteContext>(
  async (request, auth, context) => {
    try {
      const { messageId } = await context.params;

      const body = await readJsonBody<RedactBody>(request);
      const reason = typeof body?.reason === 'string' ? body.reason.trim() : '';

      if (reason === '') {
        return apiFailure(
          'invalid_body',
          'Say why it was removed. The record has to explain itself later.',
          400,
        );
      }
      if (reason.length > 280) {
        return apiFailure('invalid_body', 'A reason can be at most 280 characters.', 400);
      }

      const me = await getSchoolUserByUid(auth.locationId, auth.uid);
      if (me === null) return apiFailure('not_found', 'No account at this school.', 404);

      const redacted = await redactMessage(auth.locationId, messageId, me.id, reason);
      if (!redacted) {
        return apiFailure('not_found', 'That message is already removed, or does not exist.', 404);
      }

      return apiSuccess({ redacted: true });
    } catch (error) {
      return handleApiError(error);
    }
  },
  { permission: 'chat.moderate' },
);
