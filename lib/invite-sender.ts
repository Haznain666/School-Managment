import 'server-only';

import type { SchoolInvitation } from '@/db/schema';
import { ROLE_LABELS, isUserRole } from '@/types/school-auth';

import { isWhatsAppEnabled } from './channels';
import { db } from './drizzle';
import { sendEmail, smtpConfigured } from './email-sender';
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
  emailSent: boolean;
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
  let emailSent = false;
  const email = invitation.email;

  if (email !== null && email !== undefined && email.trim() !== '') {
    if (!smtpConfigured()) {
      failures.push('Email: SMTP is not configured.');
    } else {
      try {
        await sendEmail(email, `You have been invited to ${school.name}`, message);
        emailSent = true;
      } catch (error) {
        const reason = error instanceof Error ? error.message : 'Unknown email error';
        console.warn('[invite-sender] Email delivery failed:', reason);
        failures.push(`Email: ${reason}`);
      }
    }
  }

  if (!whatsappSent && !emailSent) {
    throw new InviteDeliveryError(failures);
  }

  return { whatsappSent, emailSent, whatsappMessageId, failures };
}
