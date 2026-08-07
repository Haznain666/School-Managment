import { eq } from 'drizzle-orm';
import type { NextRequest } from 'next/server';

import { schoolInvitations, schools } from '@/db/schema';
import { apiFailure, apiSuccess, handleApiError } from '@/lib/api-response';
import { db } from '@/lib/drizzle';
import { maskEmail, sendEmail, smtpConfigured } from '@/lib/email-sender';
import { createOTPSession, OTP_EXPIRY_MINUTES } from '@/lib/otp';
import { InvalidPhoneError, normalizePhone } from '@/lib/phone';

/**
 * POST /api/school/invitations/[inviteRef]/accept/initiate
 *
 * Sends the passcode that completes a signup. Unauthenticated: the invite
 * token is the credential.
 *
 * ── Why this is email and not WhatsApp ───────────────────────────────────
 * It used to go to the invited handset. Since Stage 4 the address is the
 * identity — the account is created against it, and it is where every later
 * sign-in code goes — so proving the handset proves the wrong thing. Sending
 * it here also means the last WhatsApp dependency in the authentication path
 * is gone: nobody is locked out of their own account by a school not having
 * bought the add-on.
 *
 * The address is taken from the invitation, never from the request, so whoever
 * holds the link cannot redirect the code to an inbox of their choosing. That
 * was the reason the phone number was read from the invitation too.
 *
 * ── The passcode is still this application's, not GoTrue's ───────────────
 * `lib/otp.ts` still issues and checks it, because this code is bound to an
 * invitation token and a purpose. GoTrue's own email OTP would sign the person
 * in as a side effect of verifying, which is the accept route's job and has to
 * happen after the membership row is written.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type RouteContext = { params: Promise<{ inviteRef: string }> };

export async function POST(_request: NextRequest, context: RouteContext) {
  try {
    const { inviteRef } = await context.params;

    const rows = await db
      .select()
      .from(schoolInvitations)
      .where(eq(schoolInvitations.token, inviteRef))
      .limit(1);

    const invitation = rows[0];

    // One message for every failure mode: whether a token exists is not
    // something an anonymous caller needs to learn.
    if (
      invitation === undefined ||
      invitation.acceptedAt !== null ||
      invitation.expiresAt.getTime() < Date.now()
    ) {
      return apiFailure('invalid_invite', 'Invalid or expired invite link.', 400);
    }

    // The account is keyed by the address, so an invitation without one can
    // never be completed. `POST /api/school/invitations` refuses to create
    // such a row; this re-checks because the row may predate that rule.
    const email = invitation.email;
    if (email === null || email.trim() === '') {
      return apiFailure(
        'no_email',
        'This invitation has no email address. Ask your admin to resend it.',
        409,
      );
    }

    if (!smtpConfigured()) {
      return apiFailure(
        'email_unavailable',
        'This school cannot send email yet. Contact your school administrator.',
        503,
      );
    }

    // Still normalised and still stored against the OTP session: the passcode
    // is keyed by (location, phone, purpose), and changing that key is a
    // wider change than this route.
    let phone: string;
    try {
      phone = normalizePhone(invitation.phone);
    } catch (error) {
      if (error instanceof InvalidPhoneError) {
        return apiFailure(
          'invalid_phone',
          'The phone number on this invitation is not valid. Ask your admin to resend it.',
          409,
        );
      }
      throw error;
    }

    const schoolRows = await db
      .select({ name: schools.name })
      .from(schools)
      .where(eq(schools.locationId, invitation.locationId))
      .limit(1);

    const school = schoolRows[0];
    if (school === undefined) {
      return apiFailure('no_school', 'This school portal is unavailable.', 404);
    }

    const { otp } = await createOTPSession(db, {
      locationId: invitation.locationId,
      phone,
      purpose: 'invite_acceptance',
      inviteToken: inviteRef,
    });

    await sendEmail(
      email.trim(),
      `Your ${school.name} setup code`,
      `Hi ${invitation.name}, your code to complete your ${school.name} account ` +
        `setup is: ${otp}\n\nValid for ${OTP_EXPIRY_MINUTES} minutes.`,
    );

    return apiSuccess({
      success: true,
      maskedEmail: maskEmail(email.trim()),
      expiresIn: OTP_EXPIRY_MINUTES * 60,
    });
  } catch (error) {
    return handleApiError(error);
  }
}
