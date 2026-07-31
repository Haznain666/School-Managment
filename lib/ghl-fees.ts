import 'server-only';

import { and, eq } from 'drizzle-orm';

import { schools } from '@/db/schema';

import type { Database } from './drizzle';
import { findOrCreateContact, sendWhatsAppMessage } from './ghl-client';
import { formatAmount } from './money';
import { isValidPhone, normalizePhone } from './phone';

/**
 * WhatsApp messaging for the Fee module (Sprint 5).
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
 * Resolves the guardian's GHL contact and posts a WhatsApp message to it.
 * Shared by both senders; every failure path is the caller's `catch`.
 */
async function whatsAppToGuardian(
  db: Database,
  locationId: string,
  guardian: { name: string; phone: string },
  message: string,
): Promise<void> {
  if (!isValidPhone(guardian.phone)) {
    console.warn(
      `[ghl-fees] skipping WhatsApp for ${guardian.name} at ${locationId}: unusable phone number.`,
    );
    return;
  }

  const contact = await findOrCreateContact(db, locationId, {
    phone: normalizePhone(guardian.phone),
    name: guardian.name,
  });

  await sendWhatsAppMessage(db, locationId, contact.contactId, message);
}

export interface FeeReminderParams {
  guardianName: string;
  /** The guardian's number, normalised to E.164 before sending. */
  guardianPhone: string;
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
export async function sendFeeReminderWhatsApp(
  db: Database,
  locationId: string,
  params: FeeReminderParams,
): Promise<void> {
  try {
    const schoolName =
      params.schoolName ?? (await schoolNameFor(db, locationId)) ?? 'your school';

    const message =
      `Dear ${params.guardianName}, fee challan ${params.challanNumber} for ` +
      `${params.studentName} of PKR ${formatAmount(params.amountDue)} was due on ` +
      `${params.dueDate}. Please pay at your nearest bank. - ${schoolName}`;

    await whatsAppToGuardian(
      db,
      locationId,
      { name: params.guardianName, phone: params.guardianPhone },
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
  guardianName: string;
  guardianPhone: string;
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
export async function sendPaymentConfirmationWhatsApp(
  db: Database,
  locationId: string,
  params: PaymentConfirmationParams,
): Promise<void> {
  try {
    const schoolName =
      params.schoolName ?? (await schoolNameFor(db, locationId)) ?? 'your school';

    const message =
      `Dear ${params.guardianName}, payment of PKR ${formatAmount(params.amountPaid)} ` +
      `received for ${params.studentName} against challan ${params.challanNumber}. ` +
      `Thank you. - ${schoolName}`;

    await whatsAppToGuardian(
      db,
      locationId,
      { name: params.guardianName, phone: params.guardianPhone },
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
