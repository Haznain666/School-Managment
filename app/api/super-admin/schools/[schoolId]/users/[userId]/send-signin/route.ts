import { and, eq } from 'drizzle-orm';
import type { NextRequest } from 'next/server';

import { schools, schoolUsers } from '@/db/schema';
import { apiFailure, apiSuccess, handleApiError } from '@/lib/api-response';
import { db } from '@/lib/drizzle';
import { sendEmail, smtpConfigured } from '@/lib/email-sender';
import { buildSchoolLoginUrl } from '@/lib/invite-links';
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
 * ── Why this does not send a code ────────────────────────────────────────
 * It would be easy to call `sendEmailOtp` here and mail them a six-digit code.
 * That is the wrong shape: GoTrue's codes are short-lived, so a code posted
 * from this screen is usually dead by the time the recipient reads the mail,
 * and the failure looks like a broken system rather than an expired code. What
 * goes out instead is durable — where the portal is, which address to use, and
 * which button to press. They then request their own code, at the moment they
 * are ready to use it, from `/api/school/auth/otp/request`.
 *
 * That endpoint only sends to an address that is an active member of the
 * school, which is exactly what this route has just confirmed.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type RouteContext = { params: Promise<{ schoolId: string; userId: string }> };

export async function POST(_request: NextRequest, context: RouteContext) {
  try {
    await requireSuperAdmin();

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
        name: schoolUsers.name,
        email: schoolUsers.email,
        isActive: schoolUsers.isActive,
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

    const loginUrl = buildSchoolLoginUrl(school.slug);

    const text = [
      `Hello ${member.name},`,
      '',
      `You have been given access to ${school.name} on our school management`,
      'system. Here is how to sign in for the first time.',
      '',
      `1. Open ${loginUrl}`,
      `2. Enter your email address: ${member.email}`,
      '3. Choose "First time here? Set a password"',
      '4. We will email you a six-digit code — enter it, then choose your own',
      '   password',
      '',
      'After that you sign in with your email and password as normal.',
      '',
      'The code is only valid for a few minutes, so request it when you are',
      'ready to use it. If it expires, just ask for another one.',
      '',
      `If you were not expecting this, you can ignore it — nobody can sign in`,
      'as you without access to this mailbox.',
    ].join('\n');

    try {
      await sendEmail(
        member.email,
        `Your ${school.name} portal access`,
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

    return apiSuccess({ sent: true, email: member.email, name: member.name });
  } catch (error) {
    return handleApiError(error);
  }
}
