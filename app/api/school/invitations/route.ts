import { and, desc, eq, gt, isNull } from 'drizzle-orm';

import { branches, schoolInvitations, schoolUsers, schools } from '@/db/schema';
import { queueAccessEmail } from '@/lib/access-email';
import { apiFailure, apiSuccess, handleApiError, readJsonBody } from '@/lib/api-response';
import { withSchoolAuth } from '@/lib/api-auth';
import { db } from '@/lib/drizzle';
import { isValidEmail, normalizeEmail } from '@/lib/password-strength';
import {
  hasCompletePhoneOfAnyKind,
  normalisePhoneOfAnyKind,
} from '@/lib/phone-formats';
import { isUuid, readString } from '@/lib/validation';
import { BRANCH_REQUIRED_ROLES, isUserRole } from '@/types/school-auth';

/**
 * /api/school/invitations
 *
 * GET  pending invitations (not yet accepted, not yet expired)
 * POST create the member and mail them a password-setup link
 *
 * ── The POST no longer writes an invitation (Sprint 17) ──────────────────
 * It creates a `school_users` row and calls `queueAccessEmail`, which is the
 * same single `/set-password/<token>` mail every other account on this platform
 * receives. What it replaced was a two-email dance: an invite link, then a
 * six-digit code emailed to the address the invite link had already proved.
 *
 * ── Why `school_invitations` is still here, and still read ───────────────
 * Rows already in it are **live invitations somebody may still click**. The
 * GET below, `app/(public)/invite/[token]/page.tsx`, `InviteOTPForm`, the
 * accept routes and the resend endpoint are all untouched for exactly that
 * reason, and they stay until the last of those rows expires. Nothing new is
 * ever written to that table. The equivalent state for a member created from
 * now on is `school_users.auth_user_id IS NULL`, which `UserTable` already
 * renders as "Invite pending".
 *
 * The OTP path in `lib/school-auth.ts` is **not** removed either. Forgot
 * Password still uses a code, and that is correct: an established account must
 * prove the mailbox.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = withSchoolAuth(
  async (_request, auth) => {
    try {
      const rows = await db
        .select({
          id: schoolInvitations.id,
          name: schoolInvitations.name,
          phone: schoolInvitations.phone,
          email: schoolInvitations.email,
          role: schoolInvitations.role,
          branchId: schoolInvitations.branchId,
          branchName: branches.name,
          emailSent: schoolInvitations.emailSent,
          expiresAt: schoolInvitations.expiresAt,
          createdAt: schoolInvitations.createdAt,
        })
        .from(schoolInvitations)
        .leftJoin(branches, eq(branches.id, schoolInvitations.branchId))
        .where(
          and(
            eq(schoolInvitations.locationId, auth.locationId),
            isNull(schoolInvitations.acceptedAt),
            gt(schoolInvitations.expiresAt, new Date()),
          ),
        )
        .orderBy(desc(schoolInvitations.createdAt));

      return apiSuccess({ invitations: rows });
    } catch (error) {
      return handleApiError(error);
    }
  },
  { permission: 'users.write' },
);

interface CreateInviteBody {
  name?: unknown;
  phone?: unknown;
  email?: unknown;
  role?: unknown;
  branchId?: unknown;
}

export const POST = withSchoolAuth(
  async (request, auth) => {
    try {
      const body = await readJsonBody<CreateInviteBody>(request);
      if (body === null) {
        return apiFailure('invalid_body', 'Expected a JSON body.', 400);
      }

      const name = readString(body.name);
      const email = normalizeEmail(readString(body.email));

      if (name === '') {
        return apiFailure('invalid_body', 'Name is required.', 400);
      }

      // ── The phone check, and the bug it replaced ───────────────────────
      // This used to be a hand-rolled `/^\+?[0-9\s-]{7,20}$/`, which has no
      // brackets in it. Every number this application's own form produces has
      // brackets in it — the mask writes `(021) 4442222` — so a landline
      // entered through the UI was refused with "Enter a valid phone number"
      // and there was no way to type one that passed. That is exactly the
      // divergence `components/ui/PhoneField.tsx` warns about: the client and
      // the server have to import the *same* rules or one accepts what the
      // other refuses. Both now come from `lib/phone-formats.ts`.
      //
      // Either mask is accepted. A landline is fine: nothing is sent to this
      // number, the invitation goes to the address below.
      const phone = normalisePhoneOfAnyKind(readString(body.phone));

      if (!hasCompletePhoneOfAnyKind(phone)) {
        return apiFailure(
          'invalid_body',
          'Enter a complete phone number — a mobile as (0321) 123-4567, or a landline as (021) 3456789.',
          400,
        );
      }
      // ── Why the address is required ────────────────────────────────────
      // It is the only channel. Under Supabase Auth the address is also the
      // identity — it is what the account is keyed by and where the sign-in
      // code goes — so an invitation without one can never be accepted.
      // Refusing it here beats letting an admin create it and the invitee
      // discover it at the last step.
      if (!isValidEmail(email)) {
        return apiFailure('invalid_body', 'Enter a valid email address.', 400);
      }
      if (!isUserRole(body.role)) {
        return apiFailure('invalid_body', 'Select a valid role.', 400);
      }

      const branchId = typeof body.branchId === 'string' ? body.branchId : null;

      if (BRANCH_REQUIRED_ROLES.includes(body.role) && branchId === null) {
        return apiFailure('invalid_body', 'This role requires a branch.', 400);
      }

      if (branchId !== null) {
        if (!isUuid(branchId)) {
          return apiFailure('invalid_body', 'That branch does not exist.', 400);
        }

        const owned = await db
          .select({ id: branches.id })
          .from(branches)
          .where(and(eq(branches.id, branchId), eq(branches.locationId, auth.locationId)))
          .limit(1);

        if (owned[0] === undefined) {
          return apiFailure('invalid_body', 'That branch does not exist.', 400);
        }
      }

      const schoolRows = await db
        .select({ name: schools.name, slug: schools.slug })
        .from(schools)
        .where(eq(schools.locationId, auth.locationId))
        .limit(1);

      const school = schoolRows[0];
      if (school === undefined) {
        return apiFailure('not_found', 'School not found.', 404);
      }

      /*
       * The member is created now, and the mail is the same one every other
       * account on this platform receives.
       *
       * Sprint 17. This route used to write a `school_invitations` row and mail
       * an invite link, which landed on `InviteOTPForm`: the invitee typed
       * their name, was mailed a **six-digit code**, and transcribed it. Two
       * emails, and the second one proved the same mailbox the first had
       * already proved. Meanwhile `createFirstSchoolAdmin` — the platform's own
       * path — mailed one `/set-password/<token>` link and was done.
       *
       * A school administrator inviting their bursar and a platform operator
       * provisioning that school were producing two different onboarding
       * experiences from the same product, and only one of them was the one
       * anybody had written help for.
       *
       * So the row goes into `school_users` on the same terms as
       * `POST /api/school/users`, and `queueAccessEmail` takes it from there.
       * `authUserId` is null on a row that has just been created, so it takes
       * the first-time branch by itself and mails the setup link.
       */
      const inserted = await db
        .insert(schoolUsers)
        .values({
          // Tenant comes from the verified session, never from the body.
          locationId: auth.locationId,
          name,
          phone,
          email,
          role: body.role,
          branchId,
          invitedByUid: auth.uid,
        })
        // Phone is unique per school.
        .onConflictDoNothing()
        .returning({
          id: schoolUsers.id,
          name: schoolUsers.name,
          phone: schoolUsers.phone,
          email: schoolUsers.email,
          role: schoolUsers.role,
          authUserId: schoolUsers.authUserId,
        });

      const member = inserted[0];
      if (member === undefined) {
        return apiFailure(
          'already_exists',
          'Someone with that phone number already exists at this school.',
          409,
        );
      }

      /*
       * Reported, never thrown.
       *
       * The member exists and is correct by the time this runs, and a mail
       * transport that is down must not undo that — the account is reachable
       * again from **Send access email** on their profile. What must not happen
       * is the old failure mode in the other direction: the form saying
       * "invited" while nothing was queued. So the result goes back in the
       * response and `UserInviteForm` says plainly whether the message was
       * queued and, if not, why.
       */
      const delivery = await queueAccessEmail({
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

      return apiSuccess({ user: member, delivery }, 201);
    } catch (error) {
      return handleApiError(error);
    }
  },
  { permission: 'users.write' },
);
