import { eq } from 'drizzle-orm';
import type { NextRequest } from 'next/server';

import { schoolInvitations, schools } from '@/db/schema';
import { apiFailure, apiSuccess, handleApiError } from '@/lib/api-response';
import { db } from '@/lib/drizzle';
import { findOrCreateContact, sendWhatsAppMessage } from '@/lib/ghl-client';
import { createOTPSession, OTP_EXPIRY_MINUTES } from '@/lib/otp';
import { InvalidPhoneError, maskPhone, normalizePhone } from '@/lib/phone';

/**
 * POST /api/school/invitations/[inviteRef]/accept/initiate
 *
 * Sends the passcode that completes a signup. Unauthenticated: the invite
 * token is the credential.
 *
 * The number is taken from the invitation, never from the request, so whoever
 * holds the link cannot redirect the code to a handset of their choosing.
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

    const { contactId } = await findOrCreateContact(db, invitation.locationId, {
      phone,
      name: invitation.name,
      email: invitation.email ?? undefined,
    });

    await sendWhatsAppMessage(
      db,
      invitation.locationId,
      contactId,
      `Hi ${invitation.name}, your OTP to complete your ${school.name} account setup is: ${otp}\n\n` +
        `Valid for ${OTP_EXPIRY_MINUTES} minutes.`,
    );

    return apiSuccess({
      success: true,
      maskedPhone: maskPhone(phone),
      expiresIn: OTP_EXPIRY_MINUTES * 60,
    });
  } catch (error) {
    return handleApiError(error);
  }
}
