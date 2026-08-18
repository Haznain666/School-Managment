import 'server-only';

import nodemailer from 'nodemailer';

import { serverEnv } from './env';
import { normalizeSmtpSecret, readConfiguredSmtpPass } from './smtp-credentials';

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

/**
 * The credentials this process will actually offer at AUTH.
 *
 * ── Why these do not come straight out of `process.env` ──────────────────
 * Because what `process.env` holds is not necessarily what the operator
 * entered. A `#` in an unquoted `.env` line truncates the value at that point,
 * a panel stores wrapping quotes literally, and both fail as `535` with the
 * panel still displaying something that looks right. `lib/smtp-credentials.ts`
 * documents the measurements; this is the one place the resolution happens, so
 * the transport, the boot check and the diagnostics route can never disagree
 * about which password production is using.
 *
 * `SMTP_PASS_B64` wins over `SMTP_PASS` — it is the form nothing can damage.
 */
export function resolveSmtpCredentials(): { user: string; pass: string } {
  return {
    user: normalizeSmtpSecret(process.env.SMTP_USER) ?? '',
    pass: readConfiguredSmtpPass(process.env.SMTP_PASS, process.env.SMTP_PASS_B64) ?? '',
  };
}

/**
 * The transport, built once per call from the resolved credentials.
 *
 * Shared with the diagnostics route so that `verify()` there exercises the
 * exact object `sendEmail` uses. A diagnostic that builds its own transport can
 * only ever prove something about itself.
 */
function createTransport(): nodemailer.Transporter {
  const port = Number.parseInt(serverEnv('SMTP_PORT', '587'), 10);
  const { user, pass } = resolveSmtpCredentials();

  return nodemailer.createTransport({
    host: serverEnv('SMTP_HOST', ''),
    port: Number.isFinite(port) ? port : 587,
    // 465 is implicit TLS; 587 upgrades via STARTTLS.
    secure: port === 465,
    auth: { user, pass },
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
}

/**
 * Opens a connection and authenticates, without sending anything.
 *
 * The only honest answer to "are these credentials right in production", and
 * the reason the diagnostics route exists: it runs inside the deployed process,
 * against the deployed environment, and returns the server's own reply.
 */
export async function verifySmtp(): Promise<void> {
  await createTransport().verify();
}

export async function sendEmail(
  to: string,
  subject: string,
  text: string,
): Promise<void> {
  await createTransport().sendMail({
    from: serverEnv('SMTP_FROM', ''),
    to,
    subject,
    text,
  });
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
