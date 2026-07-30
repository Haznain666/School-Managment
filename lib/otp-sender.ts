import 'server-only';

import nodemailer from 'nodemailer';

import type { Database } from './drizzle';
import { serverEnv } from './env';
import { findOrCreateContact, sendWhatsAppMessage } from './ghl-client';
import { OTP_EXPIRY_MINUTES } from './otp';

/**
 * Login passcode delivery.
 *
 * WhatsApp is the primary channel — it is what people in this market actually
 * read. Email is a fallback for the case that matters most: if WhatsApp is
 * down or a school's GHL connection breaks, everyone at that school would
 * otherwise be locked out entirely, because there is no password to fall back
 * on.
 *
 * This module owns every path a passcode can travel. The plaintext code passes
 * through here on its way out and is never logged: possession of the handset
 * or inbox is the whole proof.
 */

export type OtpChannel = 'whatsapp' | 'email';

export class OtpDeliveryError extends Error {
  /** True when the user has no email, so there was nothing to fall back to. */
  readonly noFallbackAvailable: boolean;

  constructor(message: string, noFallbackAvailable: boolean) {
    super(message);
    this.name = 'OtpDeliveryError';
    this.noFallbackAvailable = noFallbackAvailable;
  }
}

/** `jonathan@example.com` -> `jo***@example.com`. */
export function maskEmail(email: string): string {
  const at = email.indexOf('@');
  if (at < 1) return '***@***';

  const local = email.slice(0, at);
  const domain = email.slice(at);

  // Too short to partially reveal without giving up most of it.
  if (local.length <= 2) return `***${domain}`;

  return `${local.slice(0, 2)}***${domain}`;
}

function smtpConfigured(): boolean {
  return serverEnv('SMTP_HOST', '') !== '' && serverEnv('SMTP_FROM', '') !== '';
}

async function sendEmail(to: string, subject: string, text: string): Promise<void> {
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

  await transport.sendMail({ from: serverEnv('SMTP_FROM', ''), to, subject, text });
}

export interface SendLoginOtpParams {
  db: Database;
  locationId: string;
  /** E.164, already normalised. */
  phone: string;
  email: string | null;
  /** Display name for the GHL contact, if one has to be created. */
  name?: string | undefined;
  schoolName: string;
  /** Plaintext code. Never logged, never returned to a caller. */
  otp: string;
}

/**
 * Sends a login passcode, preferring WhatsApp and falling back to email.
 *
 * @throws {OtpDeliveryError} when no channel succeeded.
 */
export async function sendLoginOTP(
  params: SendLoginOtpParams,
): Promise<{ channel: OtpChannel }> {
  const { db, locationId, phone, email, schoolName, otp } = params;

  const message =
    `Your login OTP for ${schoolName} is: ${otp}\n\n` +
    `Valid for ${OTP_EXPIRY_MINUTES} minutes. Do not share this code.`;

  // -- WhatsApp -------------------------------------------------------------
  try {
    const { contactId } = await findOrCreateContact(db, locationId, {
      phone,
      name: params.name ?? '',
    });

    await sendWhatsAppMessage(db, locationId, contactId, message);
    return { channel: 'whatsapp' };
  } catch (error) {
    const reason = error instanceof Error ? error.message : 'Unknown WhatsApp error';
    // The reason is logged; the code never is.
    console.warn(`[otp-sender] WhatsApp OTP failed for locationId ${locationId}: ${reason}`);
  }

  // -- Email fallback -------------------------------------------------------
  if (email === null || email.trim() === '') {
    throw new OtpDeliveryError(
      'WhatsApp is unavailable and no email is on file.',
      true,
    );
  }

  if (!smtpConfigured()) {
    throw new OtpDeliveryError(
      'WhatsApp is unavailable and email delivery is not configured.',
      false,
    );
  }

  try {
    await sendEmail(
      email.trim(),
      `Your ${schoolName} Login OTP`,
      `Your login OTP is: ${otp}\n\n` +
        `Valid for ${OTP_EXPIRY_MINUTES} minutes. Do not share this code.`,
    );
    return { channel: 'email' };
  } catch (error) {
    const reason = error instanceof Error ? error.message : 'Unknown email error';
    console.warn(`[otp-sender] Email OTP failed for locationId ${locationId}: ${reason}`);
    throw new OtpDeliveryError(`All OTP delivery channels failed: ${reason}`, false);
  }
}
