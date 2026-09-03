import { withSchoolAuth } from '@/lib/api-auth';
import { apiFailure, apiSuccess, handleApiError } from '@/lib/api-response';
import { issueStudentCredential } from '@/lib/student-credentials';

/**
 * /api/school/students/[studentId]/credentials — issuing a pupil's sign-in.
 *
 * `studentId` here is the `student_profiles.id`, matching the other routes in
 * this folder.
 *
 * ── The password is returned once, and only here ─────────────────────────
 * There is no screen anywhere that shows it again and no column that stores it.
 * A clerk reads it off this response, writes it on a slip, and hands it over;
 * losing it means pressing the button again, which mints a new one against the
 * same address. That is the whole recovery story and it is deliberate — the
 * address receives no mail (see `lib/student-credentials.ts`), so an emailed
 * reset link is not merely unavailable, it is impossible by construction.
 *
 * Gated on `users.write`, which is what already governs inviting and
 * deactivating an account. Issuing a credential is the same kind of act.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type RouteContext = { params: Promise<{ studentId: string }> };

export const POST = withSchoolAuth<RouteContext>(
  async (_request, auth, context) => {
    try {
      const { studentId } = await context.params;

      const result = await issueStudentCredential(auth.locationId, studentId);
      if (!result.ok) return apiFailure('refused', result.problem, 403);

      return apiSuccess({
        email: result.email,
        password: result.password,
        reissued: result.reissued,
      });
    } catch (error) {
      return handleApiError(error);
    }
  },
  { permission: 'users.write' },
);
