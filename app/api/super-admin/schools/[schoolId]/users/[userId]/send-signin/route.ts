import { and, eq } from 'drizzle-orm';
import type { NextRequest } from 'next/server';

import { schools, schoolUsers } from '@/db/schema';
import { queueAccessEmail } from '@/lib/access-email';
import { apiFailure, apiSuccess, handleApiError } from '@/lib/api-response';
import { db } from '@/lib/drizzle';
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
 *
 * ── This route no longer knows whether the mail arrived ──────────────────
 * It used to await the send and return a 502 naming the SMTP error, which was
 * genuinely useful — and cost ~103 seconds of an operator's time per press
 * (`STATE.md` §5k). The message now goes to `email_outbox` and the response
 * says `queued`, because that is all that is true when it returns.
 *
 * The trade is explicit: the operator loses "it bounced, the address is wrong"
 * at the moment of pressing, and gains an answer in milliseconds. What replaces
 * it is the row — `email_outbox.status` and `last_error` hold the outcome, and
 * a bad address ends up `failed` with the SMTP server's own words on it. The UI
 * says "queued" and no longer says "sent", because saying "sent" here would now
 * be a claim nobody checked.
 *
 * The setup token is still written *before* the message is queued, so a link
 * cannot be mailed that the database does not know about.
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

    const outcome = await queueAccessEmail({
      locationId: school.locationId,
      school: { name: school.name, slug: school.slug },
      member: {
        id: member.id,
        name: member.name,
        email: member.email,
        authUserId: member.authUserId,
      },
      createdBy: session.email,
    });

    if (!outcome.queued) {
      return apiFailure('queue_failed', outcome.reason, 502);
    }

    return apiSuccess({
      queued: true,
      email: outcome.email,
      name: member.name,
      /** Lets the panel say which of the two emails just went out. */
      firstTime: outcome.firstTime,
    });
  } catch (error) {
    return handleApiError(error);
  }
}
