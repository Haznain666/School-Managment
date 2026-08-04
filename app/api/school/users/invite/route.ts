import { and, desc, eq, gt, isNull } from 'drizzle-orm';

import {
  branches,
  emailVerifications,
  schoolUsers,
  schools,
  userPasswords,
  INVITATION_EXPIRY_HOURS,
} from '@/db/schema';
import { withSchoolAuth } from '@/lib/api-auth';
import { apiFailure, apiSuccess, handleApiError, readJsonBody } from '@/lib/api-response';
import { db } from '@/lib/drizzle';
import { isValidEmail, normalizeEmail } from '@/lib/email-auth';
import { getOrCreateEmailFirebaseUser } from '@/lib/email-session';
import { sendSchoolEmail } from '@/lib/email-sender';
import { invitationEmailTemplate } from '@/lib/email-templates';
import { deleteVerification, issueEmailVerification } from '@/lib/email-verifications';
import { buildEmailVerifyUrl } from '@/lib/invite-links';
import { isUuid, readString } from '@/lib/validation';
import {
  BRANCH_REQUIRED_ROLES,
  INVITABLE_ROLES,
  ROLE_LABELS,
  isUserRole,
} from '@/types/school-auth';

/**
 * /api/school/users/invite — invite a colleague by email address.
 *
 * The email counterpart of `/api/school/invitations`, which sends the same
 * offer over WhatsApp. Both are gated on `users.write`, resolved against the
 * inviting school's own permission matrix, and both take the tenant from
 * verified claims rather than the body — a location id in a request is how one
 * school would otherwise add staff to another.
 *
 * Delivery failure fails the whole request here, unlike the OTP routes. An
 * invitation nobody receives leaves a half-built account and an administrator
 * who believes the person can sign in, which is worse than an error they can
 * act on.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface InviteBody {
  email?: unknown;
  firstName?: unknown;
  lastName?: unknown;
  role?: unknown;
  branchId?: unknown;
}

/** Pending email invitations, for the list beside the invite button. */
export const GET = withSchoolAuth(
  async (_request, auth) => {
    try {
      const rows = await db
        .select({
          id: emailVerifications.id,
          email: emailVerifications.email,
          expiresAt: emailVerifications.expiresAt,
          createdAt: emailVerifications.createdAt,
          name: schoolUsers.name,
          role: schoolUsers.role,
        })
        .from(emailVerifications)
        .leftJoin(
          schoolUsers,
          and(
            eq(schoolUsers.locationId, emailVerifications.locationId),
            eq(schoolUsers.email, emailVerifications.email),
          ),
        )
        .where(
          and(
            eq(emailVerifications.locationId, auth.locationId),
            eq(emailVerifications.type, 'invitation'),
            isNull(emailVerifications.usedAt),
            gt(emailVerifications.expiresAt, new Date()),
          ),
        )
        .orderBy(desc(emailVerifications.createdAt));

      return apiSuccess({ invitations: rows });
    } catch (error) {
      return handleApiError(error);
    }
  },
  { permission: 'users.write' },
);

export const POST = withSchoolAuth(
  async (request, auth) => {
    try {
      const body = await readJsonBody<InviteBody>(request);
      if (body === null) {
        return apiFailure('invalid_body', 'Expected a JSON body.', 400);
      }

      const email = normalizeEmail(readString(body.email));
      const firstName = readString(body.firstName);
      const lastName = readString(body.lastName);

      if (!isValidEmail(email)) {
        return apiFailure('invalid_body', 'Enter a valid email address.', 400);
      }
      if (firstName === '') {
        return apiFailure('invalid_body', 'First name is required.', 400);
      }
      if (!isUserRole(body.role) || !INVITABLE_ROLES.includes(body.role)) {
        return apiFailure('invalid_body', 'Select a valid role.', 400);
      }

      const role = body.role;
      const branchId = typeof body.branchId === 'string' && body.branchId !== ''
        ? body.branchId
        : null;

      if (BRANCH_REQUIRED_ROLES.includes(role) && branchId === null) {
        return apiFailure('invalid_body', 'This role requires a branch.', 400);
      }

      if (branchId !== null) {
        if (!isUuid(branchId)) {
          return apiFailure('invalid_body', 'That branch does not exist.', 400);
        }

        // Scoped to the caller's own school: an id alone must never reach a
        // branch belonging to someone else.
        const owned = await db
          .select({ id: branches.id })
          .from(branches)
          .where(and(eq(branches.id, branchId), eq(branches.locationId, auth.locationId)))
          .limit(1);

        if (owned[0] === undefined) {
          return apiFailure('invalid_body', 'That branch does not exist.', 400);
        }
      }

      const existingPassword = await db
        .select({ id: userPasswords.id })
        .from(userPasswords)
        .where(
          and(
            eq(userPasswords.locationId, auth.locationId),
            eq(userPasswords.email, email),
          ),
        )
        .limit(1);

      if (existingPassword[0] !== undefined) {
        return apiFailure(
          'already_member',
          'Someone already uses that email address at this school.',
          409,
        );
      }

      const pending = await db
        .select({ expiresAt: emailVerifications.expiresAt })
        .from(emailVerifications)
        .where(
          and(
            eq(emailVerifications.locationId, auth.locationId),
            eq(emailVerifications.email, email),
            eq(emailVerifications.type, 'invitation'),
            isNull(emailVerifications.usedAt),
            gt(emailVerifications.expiresAt, new Date()),
          ),
        )
        .limit(1);

      // A live invitation is superseded rather than refused — "resend" is what
      // an administrator means by inviting the same person twice.
      const isResend = pending[0] !== undefined;

      const schoolRows = await db
        .select({ name: schools.name, slug: schools.slug })
        .from(schools)
        .where(eq(schools.locationId, auth.locationId))
        .limit(1);

      const school = schoolRows[0];
      if (school === undefined) {
        return apiFailure('not_found', 'School not found.', 404);
      }

      const name = `${firstName} ${lastName}`.trim();
      const now = new Date();

      /**
       * The person may already have a row here — invited over WhatsApp, or
       * enrolled as a parent. That row is updated rather than duplicated, and
       * its existing `firebase_uid` is kept: overwriting it with the
       * email-derived one would silently break the WhatsApp sign-in they
       * already use, and leave two Firebase accounts for one human.
       */
      const existingRows = await db
        .select({ id: schoolUsers.id, firebaseUid: schoolUsers.firebaseUid })
        .from(schoolUsers)
        .where(
          and(eq(schoolUsers.locationId, auth.locationId), eq(schoolUsers.email, email)),
        )
        .limit(1);

      const existing = existingRows[0];

      // The Firebase account exists before the invitation is sent, so the uid
      // in `school_users` is the one the credential will later sign in as.
      const firebaseUid =
        existing?.firebaseUid ??
        (await getOrCreateEmailFirebaseUser(auth.locationId, email));

      if (existing === undefined) {
        // Inactive until the invitation is accepted: the row has to exist for
        // the uid and the role to have somewhere to live, but it must not open
        // a portal before anyone has proved they read the mail.
        await db.insert(schoolUsers).values({
          locationId: auth.locationId,
          firebaseUid,
          email,
          phone: null,
          name,
          role,
          branchId,
          isActive: false,
          invitedByUid: auth.uid,
          invitedAt: now,
        });
      } else {
        await db
          .update(schoolUsers)
          .set({
            firebaseUid,
            name,
            role,
            branchId,
            invitedByUid: auth.uid,
            invitedAt: now,
            updatedAt: now,
          })
          .where(eq(schoolUsers.id, existing.id));
      }

      const issued = await issueEmailVerification({
        locationId: auth.locationId,
        email,
        type: 'invitation',
        expiryMinutes: INVITATION_EXPIRY_HOURS * 60,
      });

      if (issued.status === 'rate_limited') {
        return apiFailure(
          'rate_limited',
          `That address has been invited several times already. Try again in ${Math.ceil(issued.retryAfterSeconds / 60)} minute(s).`,
          429,
        );
      }

      const verifyUrl = buildEmailVerifyUrl({
        token: issued.token,
        email,
        schoolSlug: school.slug,
        locationId: auth.locationId,
      });

      try {
        await sendSchoolEmail({
          locationId: auth.locationId,
          to: email,
          fromName: school.name,
          toName: name,
          ...invitationEmailTemplate({
            schoolName: school.name,
            recipientName: firstName,
            role: ROLE_LABELS[role],
            verifyUrl,
            otp: issued.otp,
            expiryHours: INVITATION_EXPIRY_HOURS,
          }),
        });
      } catch (error) {
        // Nobody can act on a code that was never delivered, so the pending
        // invitation goes with it rather than sitting in the list looking sent.
        const orphan = await db
          .select({ id: emailVerifications.id })
          .from(emailVerifications)
          .where(
            and(
              eq(emailVerifications.locationId, auth.locationId),
              eq(emailVerifications.email, email),
              eq(emailVerifications.type, 'invitation'),
            ),
          )
          .limit(1);

        const orphanId = orphan[0]?.id;
        if (orphanId !== undefined) await deleteVerification(orphanId);

        throw error;
      }

      return apiSuccess(
        {
          message: `Invitation sent to ${email}`,
          email,
          resent: isResend,
          expiresAt: issued.expiresAt.toISOString(),
        },
        201,
      );
    } catch (error) {
      return handleApiError(error);
    }
  },
  { permission: 'users.write' },
);
