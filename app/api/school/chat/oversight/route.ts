import { withSchoolAuth } from '@/lib/api-auth';
import { apiSuccess, handleApiError } from '@/lib/api-response';
import { listOverseeableConversations, resolveOversightScope } from '@/lib/chat-oversight';

/**
 * GET /api/school/chat/oversight — the conversations this caller may read.
 *
 * ── Why the scope is resolved here and not passed in ─────────────────────
 * Nothing in the request says which campuses or grades the caller runs, and
 * nothing in it may: `resolveOversightScope` derives that from the verified
 * session's role and uid on *this* request, so a stale tab left open across a
 * principal's reassignment answers with their new scope rather than their old
 * one. The same reasoning as the transcript route re-resolving membership.
 *
 * Gated on `chat.oversight`, which by default is School Administrator and
 * Principal and deliberately not Branch Administrator — see
 * `DEFAULT_ROLE_PERMISSIONS`. A school that moves it in the matrix moves the
 * door; the *reach* behind the door still comes from what the caller is.
 *
 * It returns metadata and no message bodies. Reading a thread is a second,
 * separately-authorised act against
 * `/api/school/chat/conversations/[id]/messages`, which asks this module again
 * about the id in its own URL rather than trusting that this list produced it.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = withSchoolAuth(
  async (_request, auth) => {
    try {
      const scope = await resolveOversightScope(auth.locationId, auth.role, auth.uid);
      const conversations = await listOverseeableConversations(auth.locationId, scope);

      return apiSuccess({
        conversations,
        /** So the screen can print who is being narrowed, and to what. */
        scope: {
          kind: scope.kind,
          note: scope.kind === 'none' ? null : scope.note,
        },
      });
    } catch (error) {
      return handleApiError(error);
    }
  },
  { permission: 'chat.oversight' },
);
