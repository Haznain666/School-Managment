import 'server-only';

import nodemailer from 'nodemailer';

import type { SchoolInvitation } from '@/db/schema';
import { ROLE_LABELS, isUserRole } from '@/types/school-auth';

import { serverEnv } from './env';
import { findOrCreateContact, sendWhatsAppMessage } from './ghl-client';

/**
 * Invitation delivery.
 *
 * WhatsApp via GHL is the primary channel — it is what people in this market
 * actually read. Email is a fallback, attempted only when an address was given.
 *
 * Neither channel failing is fatal on its own: a school may not have WhatsApp
 * connected yet, and many invitees have no email. Only losing *both* is an
 * error, because then nobody receives the link.
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

function smtpConfigured(): boolean {
  return serverEnv('SMTP_HOST', '') !== '' && serverEnv('SMTP_FROM', '') !== '';
}

async function sendEmail(
  to: string,
  subject: string,
  text: string,
): Promise<void> {
  const port = Number.parseInt(serverEnv('SMTP_PORT', '587'), 10);

  const transport = nodemailer.createTransport({
    host: serverEnv('SMTP_HOST', ''),
    port: Number.isFinite(port) ? port : 587,
    // 465 is implicit TLS; 587 upgrades via STARTTLS.
    secure: port === 465,
    auth: {
      user: serverEnv('SMTP_USER', ''),
      pass: serverEnv('SMTP_PASS', ''),
    },
  });

  await transport.sendMail({
    from: serverEnv('SMTP_FROM', ''),
    to,
    subject,
    text,
  });
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

  // -- WhatsApp, via the school's GHL sub-account --------------------------
  try {
    const { contactId } = await findOrCreateContact(input.locationId, {
      phone: invitation.phone,
      name: invitation.name,
      email: invitation.email ?? undefined,
    });

    const { messageId } = await sendWhatsAppMessage(
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

  // -- Email fallback, only when an address was supplied -------------------
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
