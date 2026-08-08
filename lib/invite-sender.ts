import 'server-only';

import type { SchoolInvitation } from '@/db/schema';
import { ROLE_LABELS, isUserRole } from '@/types/school-auth';

import { isWhatsAppEnabled } from './channels';
import { db } from './drizzle';
import { smtpConfigured } from './email-sender';
import { enqueueEmail } from './email-outbox';
import { findOrCreateContact, sendWhatsAppMessage } from './ghl-client';

/**
 * Invitation delivery.
 *
 * ── Which channel, and why that reversed ─────────────────────────────────
 * Email is now the channel that must work: an invitation cannot be created
 * without an address, because the address is what the Supabase account is
 * keyed by. WhatsApp is an extra, sent as well when the school has bought the
 * add-on — it is still what people in this market actually read, so a school
 * paying for it gets the invitation on both.
 *
 * That is the reverse of how this file used to read, when WhatsApp was primary
 * and email the fallback for whoever happened to have an address.
 *
 * Losing both channels is still the only fatal case, because then nobody
 * receives the link.
 *
 * ── Email is now queued, not sent ────────────────────────────────────────
 * `emailQueued` is what this used to call `emailSent`, and the rename is the
 * point: the message is written to `email_outbox` and handed to SMTP moments
 * later, outside this request. This function no longer knows whether it was
 * accepted, and it says so rather than reporting a success it cannot observe.
 * `STATE.md` §5k is why — the send it used to await measured ~103 seconds
 * against `smtp.titan.email`, inside a request an administrator was watching.
 *
 * What that costs: a bad address or a refusing SMTP host is now discovered by
 * the drainer and recorded on the row, not returned here. The invitation is
 * created either way, which is the same outcome the WhatsApp channel has always
 * had — it is fired at GoHighLevel and believed.
 */

export interface SendInviteInput {
  /** GHL Location ID of the school sending the invite. */
  locationId: string;
  invitation: Pick<SchoolInvitation, 'name' | 'phone' | 'email' | 'role'>;
  school: { name: string };
  inviteUrl: string;
}

export interface SendInviteResult {
  whatsappSent: boolean;
  /** Accepted into `email_outbox`. Not the same claim as "delivered". */
  emailQueued: boolean;
  whatsappMessageId: string | null;
  /** Human-readable reasons, surfaced to the admin who sent the invite. */
  failures: string[];
}

export class InviteDeliveryError extends Error {
  readonly failures: string[];

  constructor(failures: string[]) {
    super('The invitation could not be delivered on any channel.');
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
 * Attempts both channels and reports what actually landed.
 * @throws {InviteDeliveryError} when nothing was delivered.
 */
export async function sendInvite(input: SendInviteInput): Promise<SendInviteResult> {
  const { invitation, school } = input;
  const message = buildInviteMessage(input);
  const failures: string[] = [];

  let whatsappSent = false;
  let whatsappMessageId: string | null = null;

  // -- WhatsApp, when the school has the add-on ----------------------------
  // A school without it is correctly configured, so this is skipped silently
  // rather than recorded as a failure. Listing "WhatsApp: not enabled" against
  // every invitation would train admins to ignore the failure list.
  if (await isWhatsAppEnabled(input.locationId)) {
    try {
      const { contactId } = await findOrCreateContact(db, input.locationId, {
        phone: invitation.phone,
        name: invitation.name,
        email: invitation.email ?? undefined,
      });

      const { messageId } = await sendWhatsAppMessage(
        db,
        input.locationId,
        contactId,
        message,
      );

      whatsappSent = true;
      whatsappMessageId = messageId;
    } catch (error) {
      const reason = error instanceof Error ? error.message : 'Unknown WhatsApp error';
      console.warn('[invite-sender] WhatsApp delivery failed:', reason);
      failures.push(`WhatsApp: ${reason}`);
    }
  }

  // -- Email, the channel that has to work ---------------------------------
  let emailQueued = false;
  const email = invitation.email;

  if (email !== null && email !== undefined && email.trim() !== '') {
    // Still checked, and still checked *here*: "SMTP was never configured" is a
    // deployment fault the admin can be told about immediately, and queueing
    // into a transport that does not exist would only defer that to a `failed`
    // row nobody reads.
    if (!smtpConfigured()) {
      failures.push('Email: SMTP is not configured.');
    } else {
      try {
        await enqueueEmail({
          locationId: input.locationId,
          to: email,
          subject: `You have been invited to ${school.name}`,
          text: message,
        });
        emailQueued = true;
      } catch (error) {
        const reason = error instanceof Error ? error.message : 'Unknown email error';
        console.warn('[invite-sender] could not queue the invitation email:', reason);
        failures.push(`Email: ${reason}`);
      }
    }
  }

  if (!whatsappSent && !emailQueued) {
    throw new InviteDeliveryError(failures);
  }

  return { whatsappSent, emailQueued, whatsappMessageId, failures };
}
