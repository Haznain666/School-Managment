import { and, eq } from 'drizzle-orm';
import type { NextRequest } from 'next/server';

import { schoolInvitations, schoolUsers, schools } from '@/db/schema';
import { apiFailure, apiSuccess, handleApiError, readJsonBody } from '@/lib/api-response';
import { db } from '@/lib/drizzle';
import { getOrCreateAuthUser, mintSessionForEmail } from '@/lib/supabase-auth';
import { verifyOTPSession } from '@/lib/otp';
import { InvalidPhoneError, normalizePhone } from '@/lib/phone';
import { readString } from '@/lib/validation';
import { isUserRole } from '@/types/school-auth';

/**
 * POST /api/school/invitations/[inviteRef]/accept
 *
 * Completes a signup: verifies the emailed passcode, then creates the
 * account, stamps the tenant claims onto it, and records the member.
 *
 * Unauthenticated by design — the invite token plus possession of the invited
 * mailbox are jointly the credential. There is no password anywhere in this
 * flow, which is why these accounts have nothing to reset.
 *
 * Next.js requires sibling dynamic segments to share one name, so `accept`,
 * `resend` and `cancel` all sit under `[inviteRef]`. Accept reads it as the
 * secret token; resend and cancel read it as the invitation's id.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type RouteContext = { params: Promise<{ inviteRef: string }> };

interface AcceptBody {
  name?: unknown;
  otp?: unknown;
}

export async function POST(request: NextRequest, context: RouteContext) {
  try {
    const { inviteRef } = await context.params;

    const body = await readJsonBody<AcceptBody>(request);
    const name = readString(body?.name);
    const otp = typeof body?.otp === 'string' ? body.otp.trim() : '';

    if (name === '') {
      return apiFailure('invalid_body', 'Enter your full name.', 400);
    }
    if (otp === '') {
      return apiFailure('invalid_body', 'Enter the code we emailed you.', 400);
    }

    const rows = await db
      .select()
      .from(schoolInvitations)
      .where(eq(schoolInvitations.token, inviteRef))
      .limit(1);

    const invitation = rows[0];
    if (invitation === undefined) {
      return apiFailure('invalid_invite', 'Invalid or expired invite link.', 404);
    }
    if (invitation.acceptedAt !== null) {
      return apiFailure(
        'already_used',
        'This invite was already used. Try logging in.',
        409,
      );
    }
    if (invitation.expiresAt.getTime() < Date.now()) {
      return apiFailure(
        'expired',
        'This invite has expired. Ask your admin to resend.',
        410,
      );
    }
    if (!isUserRole(invitation.role)) {
      return apiFailure('invalid_invite', 'This invite is no longer valid.', 409);
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

    const verdict = await verifyOTPSession(db, {
      locationId: invitation.locationId,
      phone,
      otp,
      purpose: 'invite_acceptance',
      inviteToken: inviteRef,
    });

    if (verdict === 'expired') {
      return apiFailure('otp_expired', 'OTP expired. Request a new one.', 410);
    }
    if (verdict === 'max_attempts') {
      return apiFailure('otp_max_attempts', 'Too many attempts. Request a new OTP.', 429);
    }
    if (verdict === 'invalid') {
      return apiFailure('otp_invalid', 'Incorrect OTP. Try again.', 401);
    }

    const schoolRows = await db
      .select({ slug: schools.slug })
      .from(schools)
      .where(eq(schools.locationId, invitation.locationId))
      .limit(1);

    const school = schoolRows[0];
    if (school === undefined) {
      return apiFailure('no_school', 'This school portal is unavailable.', 404);
    }

    // ── Why the account comes first, and what it no longer carries ────────
    // The Firebase version stamped the tenant claims onto the account before
    // minting a token, so no signed-in moment existed without a school. There
    // are no claims to stamp now — the membership row written below *is* the
    // authorization — but the ordering still matters for a different reason:
    // an account with no row behind it is refused by `lib/school-auth.ts`, so
    // creating it first and failing here leaves nothing usable.
    //
    // The address is the identity, so an invitation without one cannot be
    // accepted; the invite routes require it.
    if (invitation.email === null || invitation.email === '') {
      return apiFailure(
        'no_email',
        'This invitation has no email address. Ask for a new one.',
        409,
      );
    }

    const account = await getOrCreateAuthUser(invitation.email);
    const uid = account.id;

    const now = new Date();

    // Upsert rather than update: creating an invitation does not create the
    // member row, but someone added directly and then invited already has one.
    await db
      .insert(schoolUsers)
      .values({
        locationId: invitation.locationId,
        authUserId: uid,
        email: invitation.email,
        phone,
        name,
        role: invitation.role,
        branchId: invitation.branchId,
        invitedByUid: invitation.invitedByUid,
        invitedAt: invitation.createdAt,
        joinedAt: now,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: [schoolUsers.locationId, schoolUsers.phone],
        set: {
          authUserId: uid,
          name,
          role: invitation.role,
          branchId: invitation.branchId,
          joinedAt: now,
          isActive: true,
          updatedAt: now,
        },
      });

    await db
      .update(schoolInvitations)
      .set({ acceptedAt: now })
      .where(
        and(
          eq(schoolInvitations.id, invitation.id),
          eq(schoolInvitations.locationId, invitation.locationId),
        ),
      );

    // Signs them in on this response. They set a password from the portal.
    await mintSessionForEmail(invitation.email);

    return apiSuccess({ role: invitation.role, schoolSlug: school.slug });
  } catch (error) {
    return handleApiError(error);
  }
}
