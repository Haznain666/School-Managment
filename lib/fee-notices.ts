import 'server-only';

import { and, eq } from 'drizzle-orm';

import { schools } from '@/db/schema';

import { formatDateOnly } from './dates';
import type { Database } from './drizzle';
import { enqueueEmail } from './email-outbox';
import { smtpConfigured } from './email-sender';
import { primaryGuardiansFor } from './fee-queries';
import { formatPkr } from './money';

/**
 * Fee notices to guardians (Sprint 5).
 *
 * ── One channel ──────────────────────────────────────────────────────────
 * **Email.** This file was `lib/ghl-fees.ts` and sent over WhatsApp through
 * GoHighLevel when a school had bought the add-on, falling back to email
 * otherwise. WhatsApp was removed from the platform on 2026-08-22, and with it
 * the only reason this module knew what GoHighLevel was — hence the rename.
 *
 * ── The guardian nobody can reach ────────────────────────────────────────
 * A guardian with no email address receives nothing. That is a real and
 * currently common state, so it is *counted and reported* by
 * `/api/school/fees/reminders` rather than logged and forgotten. This module
 * does not decide what to do about it — it cannot, being unawaited — but
 * `canReachGuardian` below is the single definition of "reachable" that the
 * route counts with, so the report and the sending cannot disagree.
 *
 * ── On failure ───────────────────────────────────────────────────────────
 * Nothing in this file may throw, and nothing in this file may block. Taking a
 * parent's cash and then failing the request because a mail host was slow would
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
 *
 * The phone number is deliberately not consulted. Nothing on this platform
 * sends to one, so a guardian with a perfect mobile and no address is
 * unreachable, and the report must say so rather than implying a channel that
 * does not exist.
 */
export function canReachGuardian(guardian: GuardianContact): boolean {
  return (
    guardian.email !== null && guardian.email.trim() !== '' && smtpConfigured()
  );
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
 * Queues one notice.
 *
 * Returns true when the outbox accepted the message — not that a mail server
 * did. The reminders route has always reported this count as "queued", which
 * was a slight overstatement of an unawaited send and is now exactly right.
 */
async function notifyGuardian(
  locationId: string,
  guardian: GuardianContact,
  subject: string,
  message: string,
): Promise<boolean> {
  const email = guardian.email;

  if (email === null || email.trim() === '' || !smtpConfigured()) {
    // Not an error: a school may legitimately hold no address for this
    // guardian. The route is what tells the admin how many of these there were.
    console.info(`[fee-notices] no address for ${guardian.name} at ${locationId}`);
    return false;
  }

  try {
    // ── Why the outbox matters most here ───────────────────────────────
    // This is the one path that was already a fan-out: "send all reminders"
    // over a defaulters list of two hundred, each send taking up to ~103
    // seconds against `smtp.titan.email`. Unawaited, that was two hundred
    // SMTP connections opened from inside one request and racing the
    // process's lifetime — the last of them would not have finished for
    // hours, if the process lived that long. Queued, it is two hundred
    // INSERTs and a drainer that works through them at a rate the mail host
    // will tolerate.
    await enqueueEmail({
      locationId,
      to: email.trim(),
      subject,
      text: message,
    });
    return true;
  } catch (error) {
    console.warn(
      `[fee-notices] could not queue email for ${guardian.name} at ${locationId}:`,
      error,
    );
    return false;
  }
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
 * "send all" loop, so a single bad address must not stop the rest going out.
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
      `${params.studentName} of ${formatPkr(params.amountDue)} was due on ` +
      `${params.dueDate}. Please pay at your nearest bank. - ${schoolName}`;

    await notifyGuardian(
      locationId,
      params.guardian,
      `Fee challan ${params.challanNumber} is overdue — ${schoolName}`,
      message,
    );

    console.info(
      `[fee-notices] fee reminder queued for challan ${params.challanNumber} at ${locationId}`,
    );
  } catch (error) {
    // The challan is unchanged and the report still shows it as overdue; the
    // school can send again. Nothing here is worth failing a request over.
    console.warn(
      `[fee-notices] fee reminder failed for challan ${params.challanNumber} at ${locationId}:`,
      error,
    );
  }
}

/** One voucher, as the email describes it. */
export interface FeeVoucherNotice {
  studentProfileId: string;
  studentName: string;
  challanNumber: string;
  /** `Aug 2026`, or the session name for a one-off. */
  periodLabel: string;
  /** `YYYY-MM-DD`. Rendered as DD-MMM-YYYY. */
  dueDate: string;
  /** PKR payable. */
  totalAmount: string | number;
  items: readonly {
    description: string;
    netAmount: string;
    /** `Sibling Discount 20%`, when one applied. */
    concessionDetail?: string | null;
  }[];
  /**
   * The contact to write to, when the caller already knows it.
   *
   * A family voucher is one slip for several children and goes to the guardian
   * it was issued to — not to each child's primary contact, which would be the
   * same person receiving the same voucher three times. Omitted everywhere
   * else, where the primary contact per student is the right answer and is
   * resolved in one query for the whole batch.
   */
  guardian?: GuardianContact | undefined;
}

/**
 * Emails a freshly raised voucher to each student's primary contact.
 *
 * -- Why a voucher has to reach the parent by itself --------------------
 * Every route that raised one left the paper in the office and told nobody. A
 * school's actual process was then a child carrying a slip home, which is how a
 * fee becomes overdue for reasons that have nothing to do with money. This is
 * the whole of Sprint 18's through-line: *a voucher has to reach the parent by
 * itself.*
 *
 * -- Shape: exactly the reminder's, and for the same reasons ------------
 * Never awaited inside a request, never able to fail a generation, and queued
 * through `enqueueEmail` rather than sent. A bulk run of three hundred vouchers
 * is three hundred INSERTs and a drainer, not three hundred SMTP connections
 * opened from inside one request and racing the process's lifetime -- see
 * `notifyGuardian` for what that cost when the reminders path did it.
 *
 * It also swallows everything. A generation that failed because a mail host was
 * slow would leave the school with no voucher *and* no email, which is strictly
 * worse than a voucher nobody was told about.
 *
 * One query for the guardians of the whole batch, so the bulk caller pays for
 * one lookup rather than one per child.
 */
export async function sendFeeVouchers(
  db: Database,
  locationId: string,
  notices: readonly FeeVoucherNotice[],
): Promise<void> {
  if (notices.length === 0) return;

  try {
    const needLookup = notices.filter((notice) => notice.guardian === undefined);

    const [schoolName, guardians] = await Promise.all([
      schoolNameFor(db, locationId),
      primaryGuardiansFor(
        locationId,
        needLookup.map((notice) => notice.studentProfileId),
      ),
    ]);

    const school = schoolName ?? 'your school';

    for (const notice of notices) {
      const guardian = notice.guardian ?? guardians.get(notice.studentProfileId);
      // A child with no guardian recorded is a real state -- an older record, a
      // conversion that skipped it -- and not one worth logging per voucher on
      // a three-hundred-strong run.
      if (guardian === undefined) continue;

      const lines = notice.items
        .map((item) => {
          const detail =
            item.concessionDetail === null || item.concessionDetail === undefined
              ? ''
              : ` (${item.concessionDetail})`;
          return `  ${item.description}${detail}: ${formatPkr(item.netAmount)}`;
        })
        .join('\n');

      const message =
        `Dear ${guardian.name},\n\n` +
        `Fee voucher ${notice.challanNumber} has been issued for ${notice.studentName} ` +
        `for ${notice.periodLabel}.\n\n` +
        `${lines}\n\n` +
        `Total payable: ${formatPkr(notice.totalAmount)}\n` +
        `Due on: ${formatDateOnly(notice.dueDate)}\n\n` +
        `A printed copy is available from the school office. ` +
        `Please pay at your nearest bank on or before the due date.\n\n` +
        `- ${school}`;

      await notifyGuardian(
        locationId,
        guardian,
        `Fee voucher ${notice.challanNumber} - ${school}`,
        message,
      );
    }

    console.info(
      `[fee-notices] ${notices.length} fee voucher email(s) processed at ${locationId}`,
    );
  } catch (error) {
    // The vouchers are already written and printable. Nothing here is worth
    // failing a generation over.
    console.warn(`[fee-notices] fee voucher emails failed at ${locationId}:`, error);
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
      `Dear ${params.guardian.name}, payment of ${formatPkr(params.amountPaid)} ` +
      `received for ${params.studentName} against challan ${params.challanNumber}. ` +
      `Thank you. - ${schoolName}`;

    await notifyGuardian(
      locationId,
      params.guardian,
      `Payment received for challan ${params.challanNumber} — ${schoolName}`,
      message,
    );

    console.info(
      `[fee-notices] payment confirmation queued for challan ${params.challanNumber} at ${locationId}`,
    );
  } catch (error) {
    console.warn(
      `[fee-notices] payment confirmation failed for challan ${params.challanNumber} at ${locationId}:`,
      error,
    );
  }
}
