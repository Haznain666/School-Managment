import { randomBytes } from 'node:crypto';

import { and, desc, eq, gt, isNull } from 'drizzle-orm';

import {
  branches,
  inviteExpiryFromNow,
  schoolInvitations,
  schools,
} from '@/db/schema';
import { apiFailure, apiSuccess, handleApiError, readJsonBody } from '@/lib/api-response';
import { withSchoolAuth } from '@/lib/api-auth';
import { db } from '@/lib/drizzle';
import { buildInviteUrl } from '@/lib/invite-links';
import { InviteDeliveryError, sendInvite } from '@/lib/invite-sender';
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
 * POST create and deliver an invitation
 *
 * The invite is only recorded after the email is queued, so the pending list
 * never shows an invitation that was never going anywhere.
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

      const token = randomBytes(32).toString('hex');
      const inviteUrl = buildInviteUrl(token, school.slug);

      let delivery;
      try {
        delivery = await sendInvite({
          locationId: auth.locationId,
          invitation: { name, phone, email, role: body.role },
          school: { name: school.name },
          inviteUrl,
        });
      } catch (error) {
        if (error instanceof InviteDeliveryError) {
          return apiFailure(
            'delivery_failed',
            `The invitation could not be delivered. ${error.failures.join(' ')}`.trim(),
            502,
          );
        }
        throw error;
      }

      const inserted = await db
        .insert(schoolInvitations)
        .values({
          locationId: auth.locationId,
          name,
          phone,
          email,
          role: body.role,
          branchId,
          invitedByUid: auth.uid,
          token,
          // Records that the message was queued, not that SMTP accepted it —
          // see the note in the resend route. The UI reads this as
          // "Email queued".
          emailSent: delivery.emailQueued,
          expiresAt: inviteExpiryFromNow(),
        })
        .returning({
          id: schoolInvitations.id,
          name: schoolInvitations.name,
          phone: schoolInvitations.phone,
          role: schoolInvitations.role,
          expiresAt: schoolInvitations.expiresAt,
          emailSent: schoolInvitations.emailSent,
        });

      return apiSuccess(
        { invitation: inserted[0], delivery: { failures: delivery.failures } },
        201,
      );
    } catch (error) {
      return handleApiError(error);
    }
  },
  { permission: 'users.write' },
);
