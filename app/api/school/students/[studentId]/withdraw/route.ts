import { and, eq } from 'drizzle-orm';

import { studentEnrollments } from '@/db/schema/student-enrollments';
import { studentProfiles } from '@/db/schema/student-profiles';
import { withSchoolAuth } from '@/lib/api-auth';
import { apiFailure, apiSuccess, handleApiError, readJsonBody } from '@/lib/api-response';
import { db } from '@/lib/drizzle';
import { applyDeparture, guardiansOnDeparture } from '@/lib/student-departure';
import { isUuid } from '@/lib/validation';

/**
 * /api/school/students/[studentId]/withdraw — a pupil leaves, and stays on record.
 *
 * ── This route did not exist, and the product already promised it ────────
 * `DELETE` on the student record refuses when money has been received against
 * their vouchers, and the refusal it returns says *"Withdraw the student
 * instead — the record stays, and so does the fee history."*
 *
 * There was no such route. A clerk following that instruction found nothing to
 * follow it with, and the only way out was a delete that had already been
 * refused. Sprint 25 needed a withdrawal trigger for the portal-disable dialog;
 * this closes a dead end that predates it.
 *
 * ── Withdrawal keeps everything and deletes nothing ──────────────────────
 * The enrollment moves to `withdrawn`. The profile, the vouchers, the payments,
 * the results and the conversations all stay exactly where they are — which is
 * the entire difference from `DELETE`, and the reason the fee history survives.
 *
 * ── The three-option dialog's answer arrives here too ────────────────────
 * `disablePortals` is a parameter, defaulting to **false**. Same reasoning as
 * the delete route: a caller that never saw the dialog gets the half that
 * cannot lock a family out by accident.
 *
 * `applyDeparture` runs **after** the status change, and with the enrollment
 * check left on — which is what makes it correct rather than merely ordered.
 * A pupil with a second active placement somewhere in the school is still a
 * pupil, and the check is what notices.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type RouteContext = { params: Promise<{ studentId: string }> };

interface WithdrawBody {
  disablePortals?: unknown;
  reason?: unknown;
}

export const POST = withSchoolAuth<RouteContext>(
  async (request, auth, context) => {
    try {
      const { studentId } = await context.params;
      if (!isUuid(studentId)) return apiFailure('not_found', 'Student not found.', 404);

      const profile = await db
        .select({ id: studentProfiles.id, schoolUserId: studentProfiles.schoolUserId })
        .from(studentProfiles)
        .where(
          and(
            eq(studentProfiles.locationId, auth.locationId),
            eq(studentProfiles.id, studentId),
          ),
        )
        .limit(1);

      const student = profile[0];
      if (student === undefined) return apiFailure('not_found', 'Student not found.', 404);

      const body = await readJsonBody<WithdrawBody>(request);
      const disablePortals = body?.disablePortals === true;
      const note = typeof body?.reason === 'string' ? body.reason.trim() : '';

      const closed = await db
        .update(studentEnrollments)
        .set({ status: 'withdrawn' })
        .where(
          and(
            eq(studentEnrollments.locationId, auth.locationId),
            eq(studentEnrollments.studentProfileId, studentId),
            eq(studentEnrollments.status, 'active'),
          ),
        )
        .returning({ id: studentEnrollments.id });

      if (closed.length === 0) {
        return apiFailure(
          'not_enrolled',
          'That student has no active placement to withdraw from.',
          409,
        );
      }

      const departure = await applyDeparture({
        locationId: auth.locationId,
        studentProfileId: studentId,
        studentSchoolUserId: student.schoolUserId,
        disablePortals,
        reason:
          note === ''
            ? `Withdrawn from the school on ${new Date().toISOString().slice(0, 10)}.`
            : note.slice(0, 280),
      });

      return apiSuccess({
        withdrawn: true,
        enrollmentsClosed: closed.length,
        portalsDisabled: departure.deactivated,
        keptWithOtherChildren: departure.keptWithOtherChildren,
        conversationsFrozen: departure.conversationsFrozen,
      });
    } catch (error) {
      return handleApiError(error);
    }
  },
  { permission: 'students.update' },
);

/**
 * What the dialog needs before the clerk decides.
 *
 * "Disable and continue" is a very different act when it switches off two
 * parents than when it switches off none, and a clerk should be able to see
 * which before pressing it — so the dialog asks this first and names the people
 * on both sides.
 */
export const GET = withSchoolAuth<RouteContext>(
  async (_request, auth, context) => {
    try {
      const { studentId } = await context.params;
      if (!isUuid(studentId)) return apiFailure('not_found', 'Student not found.', 404);

      const impact = await guardiansOnDeparture(auth.locationId, studentId);
      return apiSuccess(impact);
    } catch (error) {
      return handleApiError(error);
    }
  },
  { permission: 'students.read' },
);
