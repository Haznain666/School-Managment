import { randomBytes } from 'node:crypto';

import { and, eq } from 'drizzle-orm';
import type { NextRequest } from 'next/server';

import {
  passwordSetupTokens,
  schools,
  schoolUsers,
  SETUP_TOKEN_TTL_HOURS,
  setupExpiryFromNow,
} from '@/db/schema';
import { apiFailure, apiSuccess, handleApiError } from '@/lib/api-response';
import { db } from '@/lib/drizzle';
import { sendEmail, smtpConfigured } from '@/lib/email-sender';
import { buildSchoolLoginUrl, buildSetupPasswordUrl } from '@/lib/invite-links';
import { requireSuperAdmin } from '@/lib/super-admin-guard';
import { isUuid } from '@/lib/validation';

/**
 * POST /api/super-admin/schools/[schoolId]/users/[userId]/send-signin
 *
 * Emails a member the address of their school's portal and tells them how to
 * get in for the first time.
 *
 * ── The gap this closes ──────────────────────────────────────────────────
 * `createFirstSchoolAdmin` — the "Add administrator" button — writes a
 * `school_users` row and sends nothing. That was right when login was a
 * WhatsApp passcode against a phone number: the row *was* the account, and
 * there was nothing to tell anyone. After Stage 4 the address is the identity
 * and sign-in is email + password, so that person now sits in the members list
 * having received nothing at all, with no way to know the portal exists. The
 * Users tab even labels them "Invite pending", which is misleading — there is
 * no invitation, and none is coming.
 *
 * ── Two different emails, depending on who is asking ─────────────────────
 * A member who has **never signed in** gets a single-use setup link. Opening
 * their mailbox is the proof; asking them to then request a six-digit code and
 * transcribe it proves the same thing twice, with a second email in between.
 * See `db/schema/password-setup-tokens.ts` for what that link costs and the
 * constraints that keep it narrow.
 *
 * A member who **already has a password** gets no link at all — only a
 * reminder of where the portal is and which address to use. Mailing them a
 * link that sets a password would be a permanent bypass of Forgot Password,
 * which exists precisely to make an established account prove the mailbox with
 * a code. An operator who can mint a credential for any existing account by
 * pressing one button is a worse position than the one this route was written
 * to fix.
 *
 * Deliberately not a code in either case: GoTrue's codes are short-lived, so
 * one posted from an operator screen is usually dead by the time the recipient
 * reads it, and that failure looks like a broken system rather than an expired
 * code.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type RouteContext = { params: Promise<{ schoolId: string; userId: string }> };

export async function POST(_request: NextRequest, context: RouteContext) {
  try {
    // Captured so the issued token records who asked for it.
    const session = await requireSuperAdmin();

    const { schoolId, userId } = await context.params;
    if (!isUuid(schoolId) || !isUuid(userId)) {
      return apiFailure('not_found', 'School not found.', 404);
    }

    const schoolRows = await db
      .select({ name: schools.name, slug: schools.slug, locationId: schools.locationId })
      .from(schools)
      .where(eq(schools.id, schoolId))
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
        authUserId: schoolUsers.authUserId,
      })
      .from(schoolUsers)
      .where(
        and(
          eq(schoolUsers.locationId, school.locationId),
          eq(schoolUsers.id, userId),
        ),
      )
      .limit(1);

    const member = userRows[0];
    if (member === undefined) {
      return apiFailure('not_found', 'That user is not a member of this school.', 404);
    }

    // Refused rather than silently skipped: unlike the public OTP endpoint,
    // there is nothing to hide from an operator looking at their own tenant,
    // and "nothing happened" is the least useful thing to tell them.
    if (member.email === null || member.email.trim() === '') {
      return apiFailure(
        'invalid_state',
        `${member.name} has no email address on file. Since sign-in is by ` +
          'email, they cannot be given access until one is added.',
        400,
      );
    }

    if (!member.isActive) {
      return apiFailure(
        'invalid_state',
        `${member.name} is deactivated, so they could not sign in even with ` +
          'these instructions. Reactivate them first.',
        400,
      );
    }

    if (!smtpConfigured()) {
      return apiFailure(
        'misconfigured',
        'No SMTP transport is configured, so nothing can be sent. Set ' +
          'SMTP_HOST and SMTP_FROM (and SMTP_PORT if it is not 587).',
        500,
      );
    }

    const isFirstTime = member.authUserId === null;
    let text: string;

    if (isFirstTime) {
      // 32 bytes, the same width as an emergency link. Rows are kept after use
      // for the audit trail, and an unused earlier one is left alone rather
      // than revoked: it expires on its own, and revoking would break a link
      // the person may be walking to their desk to click.
      const token = randomBytes(32).toString('hex');

      await db.insert(passwordSetupTokens).values({
        locationId: school.locationId,
        schoolUserId: member.id,
        token,
        createdBy: session.email,
        expiresAt: setupExpiryFromNow(),
      });

      text = [
        `Hello ${member.name},`,
        '',
        `You have been given access to ${school.name} on our school`,
        'management system.',
        '',
        `1. Open ${buildSetupPasswordUrl(token, school.slug)}`,
        '2. Choose your password',
        '',
        `That is it. After this you sign in with ${member.email} and the`,
        'password you just chose.',
        '',
        `The link works once and expires in ${SETUP_TOKEN_TTL_HOURS} hours. If`,
        'it stops working, ask your administrator to send a new one.',
        '',
        'If you were not expecting this, ignore it — the link does nothing',
        'until somebody sets a password with it, and only this mailbox has it.',
      ].join('\n');
    } else {
      text = [
        `Hello ${member.name},`,
        '',
        `Here is where to sign in to ${school.name}:`,
        '',
        `  ${buildSchoolLoginUrl(school.slug)}`,
        '',
        `Use your email address, ${member.email}, and your password.`,
        '',
        'If you have forgotten it, choose "Forgot password?" on that page and',
        'we will email you a six-digit code to set a new one.',
      ].join('\n');
    }

    try {
      await sendEmail(
        member.email,
        isFirstTime
          ? `Set up your ${school.name} account`
          : `Your ${school.name} portal access`,
        text,
      );
    } catch (error) {
      // The transport failure is the useful part, so it is surfaced rather
      // than flattened into "could not send".
      console.error('[super-admin] sign-in email failed:', error);
      return apiFailure(
        'send_failed',
        `Could not send to ${member.email}. ${
          error instanceof Error ? error.message : 'The SMTP server refused it.'
        }`,
        502,
      );
    }

    return apiSuccess({
      sent: true,
      email: member.email,
      name: member.name,
      /** Lets the panel say which of the two emails just went out. */
      firstTime: isFirstTime,
    });
  } catch (error) {
    return handleApiError(error);
  }
}
