import 'server-only';

import type { Database } from './drizzle';
import { findOrCreateContact, sendWhatsAppMessage } from './ghl-client';

/**
 * Fee notifications over WhatsApp.
 *
 * ── On never throwing ────────────────────────────────────────────────────
 * Nothing in this file may fail an operation. A payment recorded at the school
 * counter has already happened — the family handed over cash — so a GHL outage
 * must not turn that into an error the clerk has to work around, and must
 * certainly not roll back the payment row. Every function catches everything,
 * logs a warning, and returns.
 *
 * That is also why these are called *after* the database writes have
 * committed, never inside a batch.
 */

export interface FeeReminderParams {
  /** E.164, already normalised. */
  guardianPhone: string;
  guardianName: string;
  studentName: string;
  challanNumber: string;
  /** `YYYY-MM-DD`. */
  dueDate: string;
  /** Display form, e.g. `12,500.00`. Formatted by the caller via lib/money. */
  amount: string;
  schoolName: string;
}

/**
 * Reminds a guardian that a challan is due.
 *
 * The message names the challan number because that is what a bank teller asks
 * for, and the amount because a parent with three children needs to know which
 * bill this is.
 */
export async function sendFeeReminderWhatsApp(
  db: Database,
  locationId: string,
  params: FeeReminderParams,
): Promise<void> {
  const message =
    `Dear ${params.guardianName}, this is a reminder that the fee challan ` +
    `${params.challanNumber} for ${params.studentName} amounting to PKR ${params.amount} ` +
    `is due on ${params.dueDate}. Please deposit at your nearest branch. - ${params.schoolName}`;

  try {
    const contact = await findOrCreateContact(db, locationId, {
      phone: params.guardianPhone,
      name: params.guardianName,
    });

    await sendWhatsAppMessage(db, locationId, contact.contactId, message);
  } catch (error) {
    console.warn(
      `[ghl-fees] fee reminder not delivered for challan ${params.challanNumber} at ${locationId}:`,
      error,
    );
  }
}

export interface PaymentConfirmationParams {
  /** E.164, already normalised. */
  guardianPhone: string;
  guardianName: string;
  studentName: string;
  challanNumber: string;
  /** Display form, e.g. `12,500.00`. */
  amountPaid: string;
  schoolName: string;
}

/**
 * Confirms a payment to a guardian.
 *
 * Worth sending even though the payer was standing at the counter: in this
 * market the person who pays is often not the person who holds the account,
 * and a WhatsApp receipt is the only record the family keeps.
 */
export async function sendPaymentConfirmationWhatsApp(
  db: Database,
  locationId: string,
  params: PaymentConfirmationParams,
): Promise<void> {
  const message =
    `Dear ${params.guardianName}, payment of PKR ${params.amountPaid} received for ` +
    `${params.studentName} challan ${params.challanNumber}. Thank you. - ${params.schoolName}`;

  try {
    const contact = await findOrCreateContact(db, locationId, {
      phone: params.guardianPhone,
      name: params.guardianName,
    });

    await sendWhatsAppMessage(db, locationId, contact.contactId, message);
  } catch (error) {
    console.warn(
      `[ghl-fees] payment confirmation not delivered for challan ${params.challanNumber} at ${locationId}:`,
      error,
    );
  }
}

export interface BulkReminderTarget extends FeeReminderParams {
  challanId: string;
}

export interface BulkReminderResult {
  queued: number;
  failed: number;
}

/**
 * Sends a batch of reminders.
 *
 * Sequential rather than parallel on purpose: GHL rate-limits, and a defaulters
 * run against two hundred families would trip it and lose most of the batch.
 * `ghlFetch` already backs off on 429, but not starting two hundred requests at
 * once is cheaper than recovering from them.
 *
 * Always resolves. `failed` counts sends that did not land, so the caller can
 * report honestly rather than claiming every message went out.
 */
export async function sendBulkFeeReminders(
  db: Database,
  locationId: string,
  targets: readonly BulkReminderTarget[],
): Promise<BulkReminderResult> {
  let queued = 0;
  let failed = 0;

  for (const target of targets) {
    try {
      const contact = await findOrCreateContact(db, locationId, {
        phone: target.guardianPhone,
        name: target.guardianName,
      });

      await sendWhatsAppMessage(
        db,
        locationId,
        contact.contactId,
        `Dear ${target.guardianName}, this is a reminder that the fee challan ` +
          `${target.challanNumber} for ${target.studentName} amounting to PKR ${target.amount} ` +
          `is due on ${target.dueDate}. Please deposit at your nearest branch. - ${target.schoolName}`,
      );

      queued += 1;
    } catch (error) {
      failed += 1;
      console.warn(
        `[ghl-fees] bulk reminder failed for challan ${target.challanNumber}:`,
        error,
      );
    }
  }

  return { queued, failed };
}
