import { and, eq } from 'drizzle-orm';

import { chatConversations } from '@/db/schema/chat-conversations';
import { withSchoolAuth } from '@/lib/api-auth';
import { apiFailure, apiSuccess, handleApiError } from '@/lib/api-response';
import { claimableInboxes, claimRoleInbox } from '@/lib/chat-queries';
import { seatClaimant } from '@/lib/chat-threads';
import { db } from '@/lib/drizzle';
import { getSchoolUserByUid } from '@/lib/school-queries';

/**
 * /api/school/chat/conversations/[id]/claim — picking up a desk thread.
 *
 * ── Claimed, not checked ─────────────────────────────────────────────────
 * `claimRoleInbox` is a conditional `UPDATE … RETURNING` and returns whether
 * this caller got the row. It is not a read followed by an `if`, and the reason
 * is `CLAUDE.md`'s rule about seven server processes applied one layer up: three
 * clerks with the Accounts inbox open on three screens are the same race, and a
 * read-then-check hands the same parent to all three.
 *
 * Losing the race is not an error. Somebody is answering that parent, which is
 * the outcome the queue exists for, so the response says who and the screen
 * moves the row out of the unclaimed list.
 *
 * Gated on `chat.read` rather than `chat.send`, because claiming is how a desk
 * thread *becomes* readable — and narrowed again by `claimableInboxes`, so an
 * accountant cannot pick up a thread addressed to the Principal's office.
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

      const rows = await db
        .select({
          roleInbox: chatConversations.roleInbox,
          branchId: chatConversations.branchId,
        })
        .from(chatConversations)
        .where(
          and(
            eq(chatConversations.locationId, auth.locationId),
            eq(chatConversations.id, conversationId),
            eq(chatConversations.kind, 'role_inbox'),
          ),
        )
        .limit(1);

      const conversation = rows[0];
      if (conversation === undefined) {
        return apiFailure('not_found', 'No such desk conversation.', 404);
      }

      // A branch-bound member of staff answers their own campus. `auth.branchId`
      // is read here rather than in a query, which is the one thing
      // `lib/branch-scope.ts` permits: this is a comparison against a row
      // already fetched, not a filter.
      if (
        auth.branchId !== null &&
        conversation.branchId !== null &&
        conversation.branchId !== auth.branchId
      ) {
        return apiFailure('not_found', 'No such desk conversation.', 404);
      }

      const allowed = claimableInboxes(auth.role);
      if (conversation.roleInbox === null || !allowed.includes(conversation.roleInbox as never)) {
        return apiFailure('refused', 'That desk is answered by somebody else.', 403);
      }

      const won = await claimRoleInbox(auth.locationId, conversationId, me.id);
      if (!won) {
        return apiSuccess({ claimed: false, byYou: false });
      }

      await seatClaimant(auth.locationId, conversationId, me.id);

      return apiSuccess({ claimed: true, byYou: true });
    } catch (error) {
      return handleApiError(error);
    }
  },
  { permission: 'chat.read' },
);
