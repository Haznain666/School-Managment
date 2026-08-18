import 'server-only';

import { randomBytes } from 'node:crypto';

import {
  passwordSetupTokens,
  SETUP_TOKEN_TTL_HOURS,
  setupExpiryFromNow,
} from '@/db/schema';

import { db } from './drizzle';
import { enqueueEmail } from './email-outbox';
import { smtpConfigured } from './email-sender';
import { buildSchoolLoginUrl, buildSetupPasswordUrl } from './invite-links';

/**
 * "Here is how to get into your account", queued for one member.
 *
 * ── Why this is a module and not a route ─────────────────────────────────
 * It began as the body of `POST .../users/[userId]/send-signin` — a button an
 * operator had to remember to press *after* creating somebody. That was the
 * whole defect behind "I created an administrator and they never received
 * anything": creating a member sent nothing at all, and nothing on the screen
 * said so. Now the creation path queues this itself and the button remains for
 * re-sending, which means the logic has two callers and must live in one place.
 *
 * The branch form is a third caller: an address typed against a campus can be
 * invited as that campus's administrator, which is what an operator entering
 * one plainly expects to happen.
 *
 * ── Two different emails, depending on who is asking ─────────────────────
 * A member who has **never signed in** gets a single-use setup link. Opening
 * their mailbox is the proof; asking them to then request a six-digit code and
 * transcribe it proves the same thing twice, with a second email in between.
 *
 * A member who **already has a password** gets no link at all — only a reminder
 * of where the portal is and which address to use. Mailing an existing account
 * a password-setting link would be a permanent bypass of Forgot Password, which
 * exists precisely to make an established account prove the mailbox with a
 * code.
 *
 * ── It reports queueing, never delivery ──────────────────────────────────
 * The message goes to `email_outbox` and is handed to SMTP moments later,
 * outside this call. Whether it *arrives* is recorded on the row. Saying "sent"
 * here would be a claim nobody checked — and on 2026-08-18 it would have been
 * a false one for every message, because the panel's SMTP credentials were
 * stale and the queue was failing with `535`.
 */

export interface AccessEmailMember {
  id: string;
  name: string;
  email: string | null;
  /** Null until the person has been through setup. Decides which email goes. */
  authUserId: string | null;
}

export interface AccessEmailInput {
  locationId: string;
  school: { name: string; slug: string };
  member: AccessEmailMember;
  /** Recorded on the setup token, for the audit trail. */
  createdBy: string;
}

export type AccessEmailResult =
  | { queued: true; firstTime: boolean; email: string }
  /** Nothing was queued. `reason` is safe to show an operator. */
  | { queued: false; reason: string };

/**
 * Writes the setup token (when one is needed) and queues the message.
 *
 * Never throws for an expected condition — no address, no transport — because
 * both callers have already committed a `school_users` row and neither should
 * roll that back over an email. The outcome is returned to be reported.
 */
export async function queueAccessEmail(
  input: AccessEmailInput,
): Promise<AccessEmailResult> {
  const { member, school } = input;
  const email = (member.email ?? '').trim();

  if (email === '') {
    return {
      queued: false,
      reason: `${member.name} has no email address on file, so there is nowhere to send access instructions.`,
    };
  }

  if (!smtpConfigured()) {
    return {
      queued: false,
      reason:
        'No SMTP transport is configured, so nothing could be sent. Set SMTP_HOST and SMTP_FROM in the hosting panel.',
    };
  }

  const isFirstTime = member.authUserId === null;
  let text: string;

  if (isFirstTime) {
    // 32 bytes, the same width as an emergency link. Rows are kept after use
    // for the audit trail, and an unused earlier one is left alone rather than
    // revoked: it expires on its own, and revoking would break a link the
    // person may be walking to their desk to click.
    const token = randomBytes(32).toString('hex');

    // Written before the message is queued, so a link cannot be mailed that the
    // database does not know about.
    await db.insert(passwordSetupTokens).values({
      locationId: input.locationId,
      schoolUserId: member.id,
      token,
      createdBy: input.createdBy,
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
      `That is it. After this you sign in with ${email} and the`,
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
      `Use your email address, ${email}, and your password.`,
      '',
      'If you have forgotten it, choose "Forgot password?" on that page and',
      'we will email you a six-digit code to set a new one.',
    ].join('\n');
  }

  try {
    await enqueueEmail({
      locationId: input.locationId,
      to: email,
      subject: isFirstTime
        ? `Set up your ${school.name} account`
        : `Your ${school.name} portal access`,
      text,
    });
  } catch (error) {
    // A failure here is the database refusing an INSERT, not SMTP refusing a
    // message — the transport is not involved yet. Worth reporting plainly,
    // because it means nothing was queued at all.
    console.error('[access-email] could not queue the message:', error);
    return {
      queued: false,
      reason: `Could not queue a message to ${email}. ${
        error instanceof Error ? error.message : 'The queue rejected it.'
      }`,
    };
  }

  return { queued: true, firstTime: isFirstTime, email };
}
