import { and, eq } from 'drizzle-orm';
import type { NextRequest } from 'next/server';

import { schoolInvitations, schoolUsers, schools } from '@/db/schema';
import { apiFailure, apiSuccess, handleApiError, readJsonBody } from '@/lib/api-response';
import { db } from '@/lib/drizzle';
import { getAdminAuth } from '@/lib/firebase-admin';
import { setSchoolUserClaims } from '@/lib/school-auth';
import { readString } from '@/lib/validation';
import { isUserRole } from '@/types/school-auth';

/**
 * POST /api/school/invitations/[inviteRef]/accept
 *
 * Unauthenticated by design: the token IS the credential, which is why it is
 * 32 random bytes and expires in 72 hours.
 *
 * Creates the Firebase account, stamps the tenant claims onto it, and records
 * the member — in that order, because the claims are what every later request
 * is authorised against.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MIN_PASSWORD_LENGTH = 8;

/**
 * Next.js requires sibling dynamic segments to share one name, so `accept`,
 * `resend` and `cancel` all live under `[inviteRef]`. Accept reads it as the
 * secret token; resend and cancel read it as the invitation's id.
 */
type RouteContext = { params: Promise<{ inviteRef: string }> };

interface AcceptBody {
  name?: unknown;
  password?: unknown;
}

/**
 * Invitees without an email get a synthetic one derived from their phone.
 * Firebase requires an email or phone identifier for password sign-in, and a
 * deterministic address means the same person always maps to the same account.
 */
function syntheticEmail(phone: string, slug: string): string {
  return `${phone.replace(/\D/g, '')}@${slug}.invalid`;
}

export async function POST(request: NextRequest, context: RouteContext) {
  try {
    const { inviteRef: token } = await context.params;
    if (token === '' || token.length < 32) {
      return apiFailure('invalid_token', 'Invalid or expired invite link.', 404);
    }

    const body = await readJsonBody<AcceptBody>(request);
    const name = readString(body?.name);
    const password = typeof body?.password === 'string' ? body.password : '';

    if (name === '') {
      return apiFailure('invalid_body', 'Enter your full name.', 400);
    }
    if (password.length < MIN_PASSWORD_LENGTH) {
      return apiFailure(
        'invalid_body',
        `Password must be at least ${MIN_PASSWORD_LENGTH} characters.`,
        400,
      );
    }

    const inviteRows = await db
      .select()
      .from(schoolInvitations)
      .where(eq(schoolInvitations.token, token))
      .limit(1);

    const invitation = inviteRows[0];
    if (invitation === undefined) {
      return apiFailure('invalid_token', 'Invalid or expired invite link.', 404);
    }
    if (invitation.acceptedAt !== null) {
      return apiFailure('already_used', 'This invite was already used. Try logging in.', 409);
    }
    if (invitation.expiresAt.getTime() < Date.now()) {
      return apiFailure(
        'expired',
        'This invite has expired. Ask your admin to resend.',
        410,
      );
    }
    if (!isUserRole(invitation.role)) {
      return apiFailure('invalid_token', 'This invite is no longer valid.', 409);
    }

    const schoolRows = await db
      .select({ slug: schools.slug, name: schools.name })
      .from(schools)
      .where(eq(schools.locationId, invitation.locationId))
      .limit(1);

    const school = schoolRows[0];
    if (school === undefined) {
      return apiFailure('not_found', 'School not found.', 404);
    }

    const email =
      invitation.email !== null && invitation.email.trim() !== ''
        ? invitation.email.trim()
        : syntheticEmail(invitation.phone, school.slug);

    // -- Create the Firebase account ----------------------------------------
    let uid: string;
    try {
      const created = await getAdminAuth().createUser({
        email,
        password,
        displayName: name,
        ...(invitation.phone.startsWith('+') ? { phoneNumber: invitation.phone } : {}),
      });
      uid = created.uid;
    } catch (error) {
      const code = (error as { code?: string }).code;
      if (code === 'auth/email-already-exists' || code === 'auth/phone-number-already-exists') {
        return apiFailure(
          'already_registered',
          'An account already exists for these details. Try logging in.',
          409,
        );
      }
      throw error;
    }

    // -- Claims before the DB row: they are what authorises every request ----
    await setSchoolUserClaims(uid, {
      locationId: invitation.locationId,
      role: invitation.role,
      branchId: invitation.branchId,
      schoolSlug: school.slug,
    });

    const now = new Date();

    // A row may already exist if the member was created directly and then
    // invited, so attach the Firebase account to it rather than duplicating.
    await db
      .insert(schoolUsers)
      .values({
        locationId: invitation.locationId,
        firebaseUid: uid,
        email: invitation.email,
        phone: invitation.phone,
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
          firebaseUid: uid,
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

    // The client signs in with these to obtain an ID token, which it trades
    // for a session cookie at /api/school/auth/session.
    return apiSuccess({
      success: true,
      email,
      role: invitation.role,
      schoolSlug: school.slug,
    });
  } catch (error) {
    return handleApiError(error);
  }
}
