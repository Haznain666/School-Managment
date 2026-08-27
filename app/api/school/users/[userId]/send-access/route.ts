import { and, eq } from 'drizzle-orm';

import { schoolUsers, schools } from '@/db/schema';
import { queueAccessEmail } from '@/lib/access-email';
import { withSchoolAuth } from '@/lib/api-auth';
import { apiFailure, apiSuccess, handleApiError } from '@/lib/api-response';
import { db } from '@/lib/drizzle';
import { isUuid } from '@/lib/validation';

/**
 * POST /api/school/users/[userId]/send-access
 *
 * Re-sends a member their way in: a single-use password-setup link if they have
 * never signed in, or the portal address if they already have a password.
 *
 * ── Why a school-side twin of the Super Admin route ──────────────────────
 * Sprint 17 turned invitations into password-setup emails, which closed the
 * old two-email dance — but it also removed the school's own way of sending a
 * second one. `POST .../invitations/[inviteRef]/resend` still exists and still
 * works, and it works only for rows in `school_invitations`: invitations sent
 * before that deploy. A member created since has no such row, so without this
 * route a school whose bursar deleted the mail had exactly one remedy, which
 * was to ask the platform operator.
 *
 * The behaviour is `POST /api/super-admin/schools/[schoolId]/users/[userId]/send-signin`'s,
 * because it is the same `queueAccessEmail` and must not diverge from it. The
 * only difference is who is allowed to press it and how the tenant is
 * established: `users.write`, and `auth.locationId` from the verified session
 * rather than a school id in the path.
 *
 * ── Two different emails, and why an established account gets no link ────
 * A member who has never signed in gets the setup link — opening their mailbox
 * is the proof. A member who already has a password gets only a reminder of
 * where the portal is. Mailing an established account a password-setting link
 * would be a permanent bypass of Forgot Password, which exists precisely to
 * make such an account prove the mailbox with a code. `queueAccessEmail` picks
 * between the two off `auth_user_id`; nothing here may override it.
 *
 * ── It reports queueing, never delivery ──────────────────────────────────
 * The message goes to `email_outbox` and reaches SMTP moments later, outside
 * this request. `email_outbox.status` and `last_error` hold what became of it.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type RouteContext = { params: Promise<{ userId: string }> };

export const POST = withSchoolAuth<RouteContext>(
  async (_request, auth, context) => {
    try {
      const { userId } = await context.params;
      if (!isUuid(userId)) return apiFailure('not_found', 'User not found.', 404);

      const schoolRows = await db
        .select({ name: schools.name, slug: schools.slug })
        .from(schools)
        .where(eq(schools.locationId, auth.locationId))
        .limit(1);

      const school = schoolRows[0];
      if (school === undefined) {
        return apiFailure('not_found', 'School not found.', 404);
      }

      const userRows = await db
        .select({
          id: schoolUsers.id,
          name: schoolUsers.name,
          email: schoolUsers.email,
          isActive: schoolUsers.isActive,
          branchId: schoolUsers.branchId,
          authUserId: schoolUsers.authUserId,
        })
        .from(schoolUsers)
        .where(
          and(eq(schoolUsers.locationId, auth.locationId), eq(schoolUsers.id, userId)),
        )
        .limit(1);

      const member = userRows[0];
      if (member === undefined) {
        return apiFailure('not_found', 'User not found.', 404);
      }

      // A branch-scoped admin administers their own campus and nobody else's.
      // 404 rather than 403: whether a member exists at another branch is not
      // this caller's business either.
      if (auth.branchId !== null && member.branchId !== auth.branchId) {
        return apiFailure('not_found', 'User not found.', 404);
      }

      // Refused rather than silently skipped. "Nothing happened" is the least
      // useful thing to tell an administrator looking at their own school.
      if (member.email === null || member.email.trim() === '') {
        return apiFailure(
          'invalid_state',
          `${member.name} has no email address on file. Since sign-in is by email, they cannot be given access until one is added.`,
          400,
        );
      }

      if (!member.isActive) {
        return apiFailure(
          'invalid_state',
          `${member.name} is deactivated, so they could not sign in even with these instructions. Reactivate them first.`,
          400,
        );
      }

      const outcome = await queueAccessEmail({
        locationId: auth.locationId,
        school: { name: school.name, slug: school.slug },
        member: {
          id: member.id,
          name: member.name,
          email: member.email,
          authUserId: member.authUserId,
        },
        createdBy: auth.uid,
      });

      if (!outcome.queued) {
        return apiFailure('queue_failed', outcome.reason, 502);
      }

      return apiSuccess({
        queued: true,
        email: outcome.email,
        name: member.name,
        /** Lets the panel say which of the two emails just went out. */
        firstTime: outcome.firstTime,
      });
    } catch (error) {
      return handleApiError(error);
    }
  },
  { permission: 'users.write' },
);
