import { withSchoolAuth } from '@/lib/api-auth';
import { apiFailure, apiSuccess, handleApiError } from '@/lib/api-response';
import { getStudentDetail, listGuardians } from '@/lib/admissions-queries';
import { provisionGuardianPortalAccess } from '@/lib/parent-portal-access';
import { isUuid } from '@/lib/validation';

/**
 * POST /api/school/students/[studentId]/guardians/[guardianId]/portal-invite
 *
 * Opens this guardian's parent portal account and queues the welcome, by hand.
 *
 * ── Why a button exists at all, when the send is automatic ───────────────
 * Three cases the automatic path cannot serve, and every one of them happens:
 *
 *   * the guardian had no email address when they were added, and now does;
 *   * the school takes admission fees in cash at a desk and the fee gate was
 *     cleared by hand, before this guardian was on the record;
 *   * the message was queued and did not arrive — a typo in the address, a
 *     full mailbox, an SMTP outage. §5am is a whole section about the last of
 *     those, and a system with no resend is a system that needs a deploy to
 *     recover from a typo.
 *
 * `force` is what separates the third case from the first two: it re-sends to a
 * guardian already stamped as welcomed. It is the button an administrator
 * presses when a parent rings to say nothing arrived.
 *
 * Costs `admissions.write`, not `users.write`. The person doing this is the
 * admissions clerk looking at the child's record, and it creates an account
 * with no access to anything but that child.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type RouteContext = { params: Promise<{ studentId: string; guardianId: string }> };

export const POST = withSchoolAuth<RouteContext>(
  async (request, auth, context) => {
    try {
      const { studentId, guardianId } = await context.params;
      if (!isUuid(studentId) || !isUuid(guardianId)) {
        return apiFailure('not_found', 'Guardian not found.', 404);
      }

      // The student is re-read from this tenant, and the branch check repeated,
      // for the same reason every sibling route does it: the ids came from a
      // URL, and one from another school must resolve to nothing.
      const student = await getStudentDetail(auth.locationId, studentId);
      if (student === null) return apiFailure('not_found', 'Student not found.', 404);

      if (auth.branchId !== null && student.branchId !== auth.branchId) {
        return apiFailure('not_found', 'Student not found.', 404);
      }

      const guardians = await listGuardians(auth.locationId, studentId);
      if (!guardians.some((guardian) => guardian.id === guardianId)) {
        return apiFailure('not_found', 'Guardian not found.', 404);
      }

      const url = new URL(request.url);
      const force = url.searchParams.get('force') === 'true';

      const result = await provisionGuardianPortalAccess({
        locationId: auth.locationId,
        guardianId,
        actorUid: auth.uid,
        force,
      });

      // 200 even when nothing was queued. The reason is the payload — "she has
      // no email address" is an answer, not a server fault, and rendering it as
      // a red error box would be a lie about whose problem it is.
      return apiSuccess({
        emailQueued: result.emailQueued,
        reason: result.reason,
        guardians: await listGuardians(auth.locationId, studentId),
      });
    } catch (error) {
      return handleApiError(error);
    }
  },
  { permission: 'admissions.write' },
);
