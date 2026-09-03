import { and, desc, eq, gt, isNull } from 'drizzle-orm';

import { branches, schoolInvitations, staff } from '@/db/schema';
import { apiFailure, apiSuccess, handleApiError, readJsonBody } from '@/lib/api-response';
import { withSchoolAuth } from '@/lib/api-auth';
import { joiningDateProblem } from '@/lib/dates';
import { db } from '@/lib/drizzle';
import { isValidEmail, normalizeEmail } from '@/lib/password-strength';
import { hasPermission } from '@/lib/permission-queries';
import {
  hasCompletePhoneOfAnyKind,
  normalisePhoneOfAnyKind,
} from '@/lib/phone-formats';
import { splitPersonName } from '@/lib/person-name';
import { createMemberAccount } from '@/lib/school-member-accounts';
import { isIsoDate, isUuid, readOptionalString, readString } from '@/lib/validation';
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
  /**
   * The employment record to file alongside the account — Sprint 22.
   *
   * Absent means "account only", which is exactly what this route did before,
   * so an old client is unaffected. Present means the caller also holds
   * `hr.write`; the server checks that rather than believing the form.
   */
  employment?: unknown;
}

interface EmploymentBody {
  employeeCode?: unknown;
  designation?: unknown;
  department?: unknown;
  joinedOn?: unknown;
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

      /*
       * ── The employment record, validated before the account is written ──
       *
       * Everything that can be refused without costing the school the account
       * is refused here. What is left for step 2 is the employee-code
       * collision, which only the write can discover.
       */
      const employmentRequested =
        typeof body.employment === 'object' && body.employment !== null;
      const employment = employmentRequested
        ? (body.employment as EmploymentBody)
        : null;

      let employeeCode = '';
      let joinedOn: string | null = null;

      if (employment !== null) {
        /*
         * One screen, two permission keys. Filing an employment record from
         * Invite Staff is an `hr.write` action, and a `users.write` holder who
         * does not have it sees no such section — but the request itself has to
         * be guarded too, or the section's absence is decoration.
         */
        if (!(await hasPermission(auth.locationId, auth.role, 'hr.write'))) {
          return apiFailure(
            'forbidden',
            'Adding an employment record also needs permission to manage HR. Send the invitation without one, and ask HR to add the record.',
            403,
          );
        }

        employeeCode = readString(employment.employeeCode).toUpperCase();
        if (employeeCode === '' || employeeCode.length > 32) {
          return apiFailure(
            'invalid_body',
            'Enter an employee code of 32 characters or fewer.',
            400,
          );
        }

        joinedOn = readOptionalString(employment.joinedOn);
        if (joinedOn !== null && !isIsoDate(joinedOn)) {
          return apiFailure('invalid_body', 'Enter a valid joining date.', 400);
        }

        /*
         * Sprint 23, item 8 — no more than a year ahead.
         *
         * The same rule and the same function as `POST /api/school/hr/staff`,
         * because the two routes file the same column on the same person and
         * §5bl records what it costs when they disagree: a member of staff
         * badged "no employment record" by one screen and refused by the other.
         *
         * A **past** date is unlimited on purpose. Schools file people who
         * joined in 1998.
         */
        const problem = joiningDateProblem(joinedOn);
        if (problem !== null) return apiFailure('invalid_body', problem, 400);
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
       *
       * ── Sprint 22: the same three guards as every other creation path ───
       * This route wrote the row itself, with an **untargeted**
       * `.onConflictDoNothing()`. `0038` gave `school_users` a second unique
       * index — `lower(email)`, active rows only — and an untargeted conflict
       * clause swallows both, so an administrator inviting a colleague on an
       * address somebody else already held was told *"someone with that phone
       * number already exists at this school"*. The number was free. There was
       * nothing on the form to correct and no reason to look at the address.
       *
       * Sprint 21's QA fixed exactly that on `POST /api/school/users` and this
       * route was missed, because the two were never the same code. They are
       * now: `createMemberAccount` carries the pre-check, the targeted conflict
       * and the `isEmailIndexConflict` catch, and every caller gets all three
       * or none.
       *
       * `delivery` is reported, never thrown: the member exists and is correct
       * by the time the mail is queued, a transport that is down must not undo
       * that, and "invited" over a message nobody queued is the failure the
       * shape exists to prevent.
       */
      const created = await createMemberAccount({
        // Tenant comes from the verified session, never from the body.
        locationId: auth.locationId,
        name,
        phone,
        email,
        role: body.role,
        branchId,
        invitedByUid: auth.uid,
      });

      if (!created.ok) {
        return apiFailure(created.code, created.message, created.status);
      }

      const { member, delivery } = created;

      if (employment === null) {
        return apiSuccess({ user: member, delivery, employment: null }, 201);
      }

      /*
       * Step 2, and the account is never rolled back.
       *
       * The account is this screen's point — the same rule as the HR form, the
       * other way round. A failed employment insert leaves the member invited,
       * says so, and names the field: `staff_location_id_employee_code_idx` is
       * a `23505` on a code somebody else already uses, and the one thing the
       * person at the keyboard can do about it is type a different one.
       */
      const filed = await db
        .insert(staff)
        .values({
          locationId: auth.locationId,
          schoolUserId: member.id,
          branchId,
          employeeCode,
          // One full name in, two NOT NULL columns out. See `splitPersonName`.
          ...splitPersonName(name),
          designation: readOptionalString(employment.designation),
          department: readOptionalString(employment.department),
          joinedOn,
          phone,
          email,
        })
        .onConflictDoNothing({ target: [staff.locationId, staff.employeeCode] })
        .returning({ id: staff.id });

      if (filed[0] === undefined) {
        return apiSuccess(
          {
            user: member,
            delivery,
            employment: {
              created: false,
              problem: `Employee code "${employeeCode}" is already in use at your school, so no employment record was added. The invitation was still sent.`,
            },
          },
          201,
        );
      }

      return apiSuccess(
        {
          user: member,
          delivery,
          employment: { created: true, staffId: filed[0].id },
        },
        201,
      );
    } catch (error) {
      return handleApiError(error);
    }
  },
  { permission: 'users.write' },
);
