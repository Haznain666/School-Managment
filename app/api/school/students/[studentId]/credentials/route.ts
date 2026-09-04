import { withSchoolAuth } from '@/lib/api-auth';
import { apiFailure, apiSuccess, handleApiError } from '@/lib/api-response';
import { issueAndNotify, portalAccessState } from '@/lib/student-portal-access';

/**
 * /api/school/students/[studentId]/credentials — a pupil's portal sign-in.
 *
 * `studentId` here is the `student_profiles.id`, matching the other routes in
 * this folder.
 *
 * ── Sprint 26: the password no longer comes back here ────────────────────
 * It used to. A clerk read it off this response, wrote it on a slip and handed
 * it to the child — which is why nothing in the product ever called this route
 * and why no school had ever issued a credential. The password now goes
 * straight to the pupil's guardians at the addresses the school already holds,
 * and the only thing this returns is **who it was sent to**.
 *
 * That is a narrowing and not an omission. A password that reaches a screen
 * reaches a screenshot, a support ticket and whoever is standing behind the
 * clerk; one that only exists in the outbox row and the guardians' inbox does
 * not. `lib/student-portal-access.ts` sets out the whole trade, including what
 * it costs.
 *
 * ── GET says what the state is, POST changes it ──────────────────────────
 * The profile card reads GET to draw itself: the login id, whether the pupil is
 * at or above the school's class threshold, when a password last went out and
 * which guardians would receive the next one. Neither ever exposes a password.
 *
 * Gated on `users.write`, which already governs inviting and deactivating an
 * account. Rotating somebody's credential is the same kind of act.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type RouteContext = { params: Promise<{ studentId: string }> };

export const GET = withSchoolAuth<RouteContext>(
  async (_request, auth, context) => {
    try {
      const { studentId } = await context.params;

      const state = await portalAccessState(auth.locationId, studentId);
      if (state === null) return apiFailure('not_found', 'No such student.', 404);

      return apiSuccess({ access: state });
    } catch (error) {
      return handleApiError(error);
    }
  },
  { permission: 'users.write' },
);

export const POST = withSchoolAuth<RouteContext>(
  async (_request, auth, context) => {
    try {
      const { studentId } = await context.params;

      const result = await issueAndNotify({
        locationId: auth.locationId,
        studentProfileId: studentId,
      });

      if (!result.ok) return apiFailure('refused', result.problem, 403);

      return apiSuccess({
        loginId: result.loginId,
        reissued: result.reissued,
        deliveries: result.deliveries,
      });
    } catch (error) {
      return handleApiError(error);
    }
  },
  { permission: 'users.write' },
);
