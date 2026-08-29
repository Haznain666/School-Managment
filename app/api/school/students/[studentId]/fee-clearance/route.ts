import { withSchoolAuth } from '@/lib/api-auth';
import { apiFailure, apiSuccess, handleApiError } from '@/lib/api-response';
import { getStudentDetail } from '@/lib/admissions-queries';
import { clearEnrolmentFee } from '@/lib/enrolment-fee-gate';
import { isUuid } from '@/lib/validation';

/**
 * POST /api/school/students/[studentId]/fee-clearance
 *
 * Confirms an admission by hand, and welcomes the guardians.
 *
 * ── Why this cannot be left out ──────────────────────────────────────────
 * The automatic gate clears an admission when the student holds at least one
 * challan and none of them is still open. That is the right rule for a school
 * that bills through the system. It is no rule at all for a school that takes
 * the admission fee in cash across a desk and enters the child afterwards:
 * their students hold no challan, so the gate never fires, so the parents never
 * receive a login, so the parent portal is empty for that school forever — with
 * no button anywhere to fix it.
 *
 * That is not a hypothetical; it is how a large share of the schools this
 * product is built for actually work.
 *
 * ── One-way, deliberately ────────────────────────────────────────────────
 * There is no "un-clear". Clearing sends email to real people, and a toggle
 * that could put the state back would imply those messages could be unsent.
 * A mistake here is corrected the way the school corrects it in life: by
 * talking to the parent.
 *
 * Costs `fees.write` rather than `admissions.write`. The person entitled to say
 * "we have been paid" is the one who handles money.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type RouteContext = { params: Promise<{ studentId: string }> };

export const POST = withSchoolAuth<RouteContext>(
  async (_request, auth, context) => {
    try {
      const { studentId } = await context.params;
      if (!isUuid(studentId)) return apiFailure('not_found', 'Student not found.', 404);

      const student = await getStudentDetail(auth.locationId, studentId);
      if (student === null) return apiFailure('not_found', 'Student not found.', 404);

      if (auth.branchId !== null && student.branchId !== auth.branchId) {
        return apiFailure('not_found', 'Student not found.', 404);
      }

      const outcome = await clearEnrolmentFee({
        locationId: auth.locationId,
        studentProfileId: studentId,
        actorUid: auth.uid,
      });

      if (!outcome.cleared) {
        return apiFailure(
          'not_applicable',
          outcome.reason ??
            'This enrollment could not be confirmed. It may already be confirmed.',
          409,
        );
      }

      return apiSuccess({
        cleared: true,
        welcomesQueued: outcome.welcomes.filter((one) => one.emailQueued).length,
        // Only what went wrong. A clerk needs to know the father has no address
        // on file; they do not need a line per guardian it worked for.
        problems: outcome.welcomes
          .filter((one) => one.reason !== null)
          .map((one) => one.reason as string),
      });
    } catch (error) {
      return handleApiError(error);
    }
  },
  { permission: 'fees.write' },
);
