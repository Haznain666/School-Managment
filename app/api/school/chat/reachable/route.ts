import { withSchoolAuth } from '@/lib/api-auth';
import { apiFailure, apiSuccess, handleApiError } from '@/lib/api-response';
import { resolveReachable } from '@/lib/chat-queries';
import { getSchoolUserByUid } from '@/lib/school-queries';
import { USER_ROLES } from '@/types/school-auth';

/**
 * /api/school/chat/reachable — who the caller may open a conversation with.
 *
 * ── This is not a directory ──────────────────────────────────────────────
 * It answers for the caller and nobody else, and the answer is *derived* on
 * every call from the school's own data: who teaches you, whose child you are,
 * which desk owes you an answer. There is no query parameter, no search term
 * and no way to ask about somebody else's list.
 *
 * For a pupil it usually answers with nothing at all, and that is the ordinary
 * case rather than a failure: a pupil replies, and initiates only while a live
 * grant is open *and* the teacher has opted in. The composer renders the empty
 * answer as "You can reply to your teachers' messages" rather than as an error.
 *
 * The list is not the authorization. `initiateProblem` re-derives it on the
 * POST, because a target id in a request body is untrusted however it was
 * obtained.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = withSchoolAuth(
  async (_request, auth) => {
    try {
      const me = await getSchoolUserByUid(auth.locationId, auth.uid);
      if (me === null) return apiFailure('not_found', 'No account at this school.', 404);

      const targets = await resolveReachable(auth.locationId, {
        schoolUserId: me.id,
        role: auth.role,
      });

      return apiSuccess({ targets });
    } catch (error) {
      return handleApiError(error);
    }
  },
  { allowedRoles: USER_ROLES },
);
