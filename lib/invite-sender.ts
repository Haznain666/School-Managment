import 'server-only';

import type { SchoolInvitation } from '@/db/schema';
import { ROLE_LABELS, isUserRole } from '@/types/school-auth';

import { smtpConfigured } from './email-sender';
import { enqueueEmail } from './email-outbox';

/**
 * Invitation delivery.
 *
 * ── One channel, on purpose ──────────────────────────────────────────────
 * **Email, and only email.** There is no second channel here and no switch
 * that adds one. This file used to try WhatsApp first and fall back to email,
 * then tried both; 2026-08-22 removed WhatsApp from the platform outright, so
 * what is left is the channel that was always the one that had to work.
 *
 * The address is the identity: it is what the Supabase account is keyed by and
 * where the sign-in code goes, so an invitation without one can never be
 * accepted. That is why `POST /api/school/invitations` refuses a missing or
 * malformed address rather than recording an invitation nobody can use.
 *
 * The phone number recorded alongside it is a contact detail and nothing more.
 * Nothing is sent to it.
 *
 * ── Email is queued, not sent ────────────────────────────────────────────
 * `emailQueued` is what this used to call `emailSent`, and the rename is the
 * point: the message is written to `email_outbox` and handed to SMTP moments
 * later, outside this request. This function no longer knows whether it was
 * accepted, and it says so rather than reporting a success it cannot observe.
 * `STATE.md` §5k is why — the send it used to await measured ~103 seconds
 * against `smtp.titan.email`, inside a request an administrator was watching.
 *
 * What that costs: a bad address or a refusing SMTP host is now discovered by
 * the drainer and recorded on the row, not returned here.
 */

export interface SendInviteInput {
  /** GHL Location ID of the school sending the invite. */
  locationId: string;
  invitation: Pick<SchoolInvitation, 'name' | 'phone' | 'email' | 'role'>;
  school: { name: string };
  inviteUrl: string;
}

export interface SendInviteResult {
  /** Accepted into `email_outbox`. Not the same claim as "delivered". */
  emailQueued: boolean;
  /** Human-readable reasons, surfaced to the admin who sent the invite. */
  failures: string[];
}

export class InviteDeliveryError extends Error {
  readonly failures: string[];

  constructor(failures: string[]) {
    super('The invitation could not be emailed.');
    this.name = 'InviteDeliveryError';
    this.failures = failures;
  }
}

function roleLabel(role: string): string {
  return isUserRole(role) ? ROLE_LABELS[role] : role;
}

export function buildInviteMessage(input: SendInviteInput): string {
  return [
    `Hi ${input.invitation.name}, you have been invited to join ${input.school.name} as ${roleLabel(input.invitation.role)}.`,
    '',
    'Click the link below to set up your account (valid for 72 hours):',
    input.inviteUrl,
    '',
    'If you have questions, contact your school administration.',
  ].join('\n');
}

/**
 * Queues the invitation email.
 * @throws {InviteDeliveryError} when it could not even be queued.
 */
export async function sendInvite(input: SendInviteInput): Promise<SendInviteResult> {
  const { invitation, school } = input;
  const message = buildInviteMessage(input);
  const failures: string[] = [];

  const email = invitation.email;

  if (email === null || email === undefined || email.trim() === '') {
    // Unreachable through the API, which refuses a blank address before it gets
    // here. Kept because a row written before that rule existed would otherwise
    // be queued into nothing and reported as a success.
    throw new InviteDeliveryError(['Email: no address on the invitation.']);
  }

  // Checked here, and deliberately not deferred to the drainer: "SMTP was never
  // configured" is a deployment fault the admin can be told about immediately,
  // and queueing into a transport that does not exist would only turn it into a
  // `failed` row nobody reads.
  if (!smtpConfigured()) {
    throw new InviteDeliveryError(['Email: SMTP is not configured.']);
  }

  try {
    await enqueueEmail({
      locationId: input.locationId,
      to: email,
      subject: `You have been invited to ${school.name}`,
      text: message,
    });
  } catch (error) {
    const reason = error instanceof Error ? error.message : 'Unknown email error';
    console.warn('[invite-sender] could not queue the invitation email:', reason);
    failures.push(`Email: ${reason}`);
    throw new InviteDeliveryError(failures);
  }

  return { emailQueued: true, failures };
}
