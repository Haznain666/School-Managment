import 'server-only';

import { and, eq } from 'drizzle-orm';

import { schools } from '@/db/schema';

import { isWhatsAppEnabled } from './channels';
import type { Database } from './drizzle';
import { enqueueEmail } from './email-outbox';
import { smtpConfigured } from './email-sender';
import { findOrCreateContact, sendWhatsAppMessage } from './ghl-client';
import { formatAmount } from './money';
import { isValidPhone, normalizePhone } from './phone';

/**
 * Fee notices to guardians (Sprint 5).
 *
 * ── Two channels, one switch ─────────────────────────────────────────────
 * WhatsApp when the school has bought it, email otherwise. The choice is per
 * school and lives in `lib/channels.ts`; nothing here decides policy, it only
 * reads the answer.
 *
 * Both are attempted when both are available, because a fee notice is the one
 * message a school most wants to have landed, and the two channels fail
 * independently.
 *
 * ── The guardian nobody can reach ────────────────────────────────────────
 * A guardian with no email at a school with WhatsApp off receives nothing.
 * That is a real and currently common state, so it is *counted and reported*
 * by `/api/school/fees/reminders` rather than logged and forgotten. This
 * module does not decide what to do about it — it cannot, being unawaited —
 * but `canReachGuardian` below is the single definition of "reachable" that
 * the route counts with, so the report and the sending cannot disagree.
 *
 * ── On failure ───────────────────────────────────────────────────────────
 * Nothing in this file may throw, and nothing in this file may block. Taking a
 * parent's cash and then failing the request because GoHighLevel was slow would
 * lose the school the payment record and leave the parent holding a receipt for
 * nothing. Both functions therefore catch everything, log a warning, and
 * return — and their callers invoke them as `void send(...).catch(...)` *after*
 * the database writes have already landed.
 *
 * A reminder that does not arrive is a nuisance. A payment that does not record
 * is a dispute. The asymmetry is the whole design.
 */

/** Everything a fee notice can be delivered to. */
export interface GuardianContact {
  name: string;
  phone: string;
  email: string | null;
}

/**
 * Could this guardian receive anything at all?
 *
 * Shared with `/api/school/fees/reminders` so the count it reports and the
 * sends that actually happen are decided by the same rule.
 */
export function canReachGuardian(
  guardian: GuardianContact,
  whatsAppEnabled: boolean,
): boolean {
  const byWhatsApp = whatsAppEnabled && isValidPhone(guardian.phone);
  const byEmail =
    guardian.email !== null && guardian.email.trim() !== '' && smtpConfigured();

  return byWhatsApp || byEmail;
}

/** The school's own name, for signing the message. Null when it cannot be read. */
async function schoolNameFor(
  db: Database,
  locationId: string,
): Promise<string | null> {
  const rows = await db
    .select({ name: schools.name })
    .from(schools)
    .where(and(eq(schools.locationId, locationId), eq(schools.isActive, true)))
    .limit(1);

  return rows[0]?.name ?? null;
}

/**
 * Delivers one notice on every channel available to this school.
 *
 * Each channel is tried inside its own try/catch: WhatsApp failing must not
 * stop the email, and neither may throw into an unawaited caller.
 *
 * Returns true when at least one channel accepted the message — which for
 * email now means the outbox accepted it, not that a mail server did. The
 * reminders route has always reported this count as "queued", which was a
 * slight overstatement of an unawaited send and is now exactly right.
 */
async function notifyGuardian(
  db: Database,
  locationId: string,
  guardian: GuardianContact,
  subject: string,
  message: string,
): Promise<boolean> {
  let delivered = false;

  if (await isWhatsAppEnabled(locationId)) {
    if (!isValidPhone(guardian.phone)) {
      console.warn(
        `[ghl-fees] skipping WhatsApp for ${guardian.name} at ${locationId}: unusable phone number.`,
      );
    } else {
      try {
        const contact = await findOrCreateContact(db, locationId, {
          phone: normalizePhone(guardian.phone),
          name: guardian.name,
          email: guardian.email ?? undefined,
        });

        await sendWhatsAppMessage(db, locationId, contact.contactId, message);
        delivered = true;
      } catch (error) {
        console.warn(`[ghl-fees] WhatsApp failed for ${guardian.name} at ${locationId}:`, error);
      }
    }
  }

  const email = guardian.email;

  if (email !== null && email.trim() !== '' && smtpConfigured()) {
    try {
      // ── Why the outbox matters most here ─────────────────────────────
      // This is the one path that was already a fan-out: "send all
      // reminders" over a defaulters list of two hundred, each send taking
      // up to ~103 seconds against `smtp.titan.email`. Unawaited, that was
      // two hundred SMTP connections opened from inside one request and
      // racing the process's lifetime — the last of them would not have
      // finished for hours, if the process lived that long. Queued, it is
      // two hundred INSERTs and a drainer that works through them at a rate
      // the mail host will tolerate.
      await enqueueEmail({
        locationId,
        to: email.trim(),
        subject,
        text: message,
      });
      delivered = true;
    } catch (error) {
      console.warn(`[ghl-fees] could not queue email for ${guardian.name} at ${locationId}:`, error);
    }
  }

  if (!delivered) {
    // Not an error: a school may legitimately have neither channel for this
    // guardian. The route is what tells the admin how many of these there were.
    console.info(
      `[ghl-fees] no channel available for ${guardian.name} at ${locationId}`,
    );
  }

  return delivered;
}

export interface FeeReminderParams {
  guardian: GuardianContact;
  studentName: string;
  challanNumber: string;
  /** PKR still outstanding. */
  amountDue: string | number;
  /** `YYYY-MM-DD`, printed as-is. */
  dueDate: string;
  /** Overrides the school name lookup when the caller already has it. */
  schoolName?: string | undefined;
}

/**
 * Reminds a guardian that a challan is overdue.
 *
 * Never throws. Called for each row of the defaulters report, including from a
 * "send all" loop, so a single bad number must not stop the rest going out.
 */
export async function sendFeeReminder(
  db: Database,
  locationId: string,
  params: FeeReminderParams,
): Promise<void> {
  try {
    const schoolName =
      params.schoolName ?? (await schoolNameFor(db, locationId)) ?? 'your school';

    const message =
      `Dear ${params.guardian.name}, fee challan ${params.challanNumber} for ` +
      `${params.studentName} of PKR ${formatAmount(params.amountDue)} was due on ` +
      `${params.dueDate}. Please pay at your nearest bank. - ${schoolName}`;

    await notifyGuardian(
      db,
      locationId,
      params.guardian,
      `Fee challan ${params.challanNumber} is overdue — ${schoolName}`,
      message,
    );

    console.info(
      `[ghl-fees] fee reminder sent for challan ${params.challanNumber} at ${locationId}`,
    );
  } catch (error) {
    // The challan is unchanged and the report still shows it as overdue; the
    // school can send again. Nothing here is worth failing a request over.
    console.warn(
      `[ghl-fees] fee reminder failed for challan ${params.challanNumber} at ${locationId}:`,
      error,
    );
  }
}

export interface PaymentConfirmationParams {
  guardian: GuardianContact;
  studentName: string;
  challanNumber: string;
  /** PKR received in this payment. */
  amountPaid: string | number;
  schoolName?: string | undefined;
}

/**
 * Confirms a payment to the guardian.
 *
 * Never throws, and is deliberately never awaited inside the payment endpoint:
 * the money is already recorded by the time this runs.
 */
export async function sendPaymentConfirmation(
  db: Database,
  locationId: string,
  params: PaymentConfirmationParams,
): Promise<void> {
  try {
    const schoolName =
      params.schoolName ?? (await schoolNameFor(db, locationId)) ?? 'your school';

    const message =
      `Dear ${params.guardian.name}, payment of PKR ${formatAmount(params.amountPaid)} ` +
      `received for ${params.studentName} against challan ${params.challanNumber}. ` +
      `Thank you. - ${schoolName}`;

    await notifyGuardian(
      db,
      locationId,
      params.guardian,
      `Payment received for challan ${params.challanNumber} — ${schoolName}`,
      message,
    );

    console.info(
      `[ghl-fees] payment confirmation sent for challan ${params.challanNumber} at ${locationId}`,
    );
  } catch (error) {
    console.warn(
      `[ghl-fees] payment confirmation failed for challan ${params.challanNumber} at ${locationId}:`,
      error,
    );
  }
}
