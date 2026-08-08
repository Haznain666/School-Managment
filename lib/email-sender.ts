import 'server-only';

import nodemailer from 'nodemailer';

import { serverEnv } from './env';

/**
 * Outbound email over SMTP.
 *
 * ── Why this module exists ───────────────────────────────────────────────
 * `smtpConfigured()` and `sendEmail()` were duplicated character-for-character
 * in `lib/invite-sender.ts` and `lib/otp-sender.ts`. Two copies of a transport
 * is two places to change a port, a TLS rule or a `from` address, and one of
 * them is always missed. Now there is one.
 *
 * ── What this is not ─────────────────────────────────────────────────────
 * It is not the channel that carries sign-in codes. Those are GoTrue's, sent
 * by Supabase using the SMTP configured in the Supabase dashboard — a
 * different set of credentials that this module never sees. What travels here
 * is everything the application sends in its own voice: invitations, the
 * invite-acceptance passcode, and fee notices.
 *
 * ── On failing softly ────────────────────────────────────────────────────
 * Nothing here retries or queues. A school's SMTP being down is not something
 * this process can fix mid-request, and every caller already treats a failed
 * send as a reportable outcome rather than a crash.
 */

/**
 * True when there is somewhere to send from and something to send through.
 *
 * Checked before attempting a send so "SMTP was never configured" is reported
 * as itself rather than as a connection error twenty seconds later.
 */
export function smtpConfigured(): boolean {
  return serverEnv('SMTP_HOST', '') !== '' && serverEnv('SMTP_FROM', '') !== '';
}

export async function sendEmail(
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
    /**
     * Bounded waits, because nodemailer's defaults are minutes long and every
     * caller here is inside a request someone is watching.
     *
     * This is not hypothetical: connecting to smtp.titan.email on 587 was
     * measured at 111 seconds where 465 took 1.4. Without a ceiling the
     * operator sees a spinner that never resolves and concludes the feature is
     * broken; with one they get a reportable error in fifteen seconds and can
     * act on it. Slow is a failure mode, and it should look like one.
     *
     * Generous enough for a healthy server on a poor connection — a normal
     * send completes well inside a second or two.
     */
    connectionTimeout: 15_000,
    greetingTimeout: 15_000,
    socketTimeout: 20_000,
  });

  await transport.sendMail({ from: serverEnv('SMTP_FROM', ''), to, subject, text });
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
