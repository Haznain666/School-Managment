import { and, eq } from 'drizzle-orm';
import type { NextRequest, NextResponse } from 'next/server';

import { schoolUsers, SET_PASSWORD_GRACE_MINUTES } from '@/db/schema';
import { apiFailure, apiSuccess, handleApiError, readJsonBody } from '@/lib/api-response';
import { db } from '@/lib/drizzle';
import {
  hashPassword,
  isValidEmail,
  normalizeEmail,
  secretsMatch,
  validatePasswordStrength,
} from '@/lib/email-auth';
import { upsertPassword } from '@/lib/email-credentials';
import {
  applySessionCookie,
  establishEmailSession,
  getOrCreateEmailFirebaseUser,
  loadMemberIdentity,
} from '@/lib/email-session';
import {
  deleteVerification,
  findVerificationByToken,
  resolvePublicTenant,
} from '@/lib/email-verifications';

/**
 * POST /api/auth/set-password
 *
 * Second half of accepting an invitation: choose a password and land in the
 * portal. Public, and the proof is the invitation token that
 * `/api/auth/verify-invitation` has just marked used.
 *
 * ── On accepting a *used* token ──────────────────────────────────────────
 * Everywhere else in this module `used_at` means "spent, never again". Here it
 * means the opposite — it is the evidence that the code was proved a moment
 * ago. The window is thirty minutes and it is checked against `used_at`, not
 * the invitation's own 72-hour expiry, so the gap between typing the code and
 * choosing a password is exactly as long as it takes to type a password.
 *
 * The row is deleted once the account exists, which closes the window rather
 * than waiting for it to lapse.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface SetPasswordBody {
  token?: unknown;
  email?: unknown;
  newPassword?: unknown;
  confirmPassword?: unknown;
  locationId?: unknown;
}

const INVALID_TOKEN =
  'This invitation is no longer valid. Ask your school administrator to send a new one.';

export async function POST(request: NextRequest) {
  try {
    const body = await readJsonBody<SetPasswordBody>(request);
    const token = typeof body?.token === 'string' ? body.token.trim() : '';
    const email = normalizeEmail(typeof body?.email === 'string' ? body.email : '');
    const newPassword = typeof body?.newPassword === 'string' ? body.newPassword : '';
    const confirmPassword =
      typeof body?.confirmPassword === 'string' ? body.confirmPassword : '';

    if (token === '' || !isValidEmail(email)) {
      return apiFailure('invalid_token', INVALID_TOKEN, 400);
    }

    if (newPassword !== confirmPassword) {
      return apiFailure('password_mismatch', 'The two passwords do not match.', 400);
    }

    const strength = validatePasswordStrength(newPassword);
    if (!strength.valid) {
      return apiFailure(
        'weak_password',
        strength.error ?? 'Choose a stronger password.',
        400,
      );
    }

    const tenant = await resolvePublicTenant(request, body?.locationId);
    if (tenant === null) {
      return apiFailure('no_school', 'No school resolved for this address.', 400);
    }

    const verification = await findVerificationByToken(
      tenant.locationId,
      token,
      'invitation',
    );

    if (verification === null || !secretsMatch(verification.email, email)) {
      return apiFailure('invalid_token', INVALID_TOKEN, 400);
    }

    const usedAt = verification.usedAt;
    if (usedAt === null) {
      // The code was never proved. Sending this straight here would set a
      // password using nothing but a link.
      return apiFailure(
        'not_verified',
        'Enter the code from your invitation email first.',
        403,
      );
    }

    const graceMs = SET_PASSWORD_GRACE_MINUTES * 60 * 1000;
    if (Date.now() - usedAt.getTime() > graceMs) {
      return apiFailure(
        'verification_expired',
        'That took too long. Enter the code from your invitation email again.',
        410,
      );
    }

    const memberRows = await db
      .select({ id: schoolUsers.id, firebaseUid: schoolUsers.firebaseUid })
      .from(schoolUsers)
      .where(
        and(eq(schoolUsers.locationId, tenant.locationId), eq(schoolUsers.email, email)),
      )
      .limit(1);

    const member = memberRows[0];
    if (member === undefined) {
      return apiFailure('invalid_token', INVALID_TOKEN, 400);
    }

    // Normally set when the invitation was sent; derived here for the case
    // where the row predates email auth and never had one.
    const firebaseUid =
      member.firebaseUid ??
      (await getOrCreateEmailFirebaseUser(tenant.locationId, email));

    await upsertPassword({
      locationId: tenant.locationId,
      email,
      firebaseUid,
      passwordHash: await hashPassword(newPassword),
      mustChangePassword: false,
    });

    // The account becomes usable only now — the invitation created the row,
    // this is what opens the portal.
    await db
      .update(schoolUsers)
      .set({
        firebaseUid,
        isActive: true,
        joinedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(schoolUsers.id, member.id));

    // The invitation has done its work; nothing is served by keeping a token
    // that would still be inside its grace window.
    await deleteVerification(verification.id);

    const identity = await loadMemberIdentity(tenant.locationId, firebaseUid);
    if (identity === null) {
      // The password is set, so this is recoverable by signing in normally.
      return apiFailure(
        'account_disabled',
        'Your password is set, but your account is not active yet. Contact your school administrator.',
        403,
      );
    }

    const session = await establishEmailSession(tenant.locationId, identity);

    const response = apiSuccess({
      redirect: session.redirect,
      role: session.role,
      name: session.name,
    });

    applySessionCookie(response, session);
    return response as NextResponse;
  } catch (error) {
    return handleApiError(error);
  }
}
