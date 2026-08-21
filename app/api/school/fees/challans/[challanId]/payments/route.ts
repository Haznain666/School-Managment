import { and, eq, sql } from 'drizzle-orm';

import { feeChallans, feePayments, isPaymentMethod, ledgerTransactions } from '@/db/schema';
import { landingAccountFor, twoSidedLines } from '@/lib/accounting';
import { schoolUserIdForUid } from '@/lib/accounting-queries';
import { withSchoolAuth } from '@/lib/api-auth';
import { apiFailure, apiSuccess, handleApiError, readJsonBody } from '@/lib/api-response';
import { db, type Tx } from '@/lib/drizzle';
import {
  cashAccountForStaff,
  loadSystemAccounts,
  postTransaction,
  requireSystemAccount,
  LedgerError,
} from '@/lib/ledger';
import { settleEnrolmentIfFeePaid } from '@/lib/enrolment-fee-gate';
import { challanStatusFor, remainingBalance } from '@/lib/fee-calculator';
import { getChallanDetail } from '@/lib/fee-queries';
import { sendPaymentConfirmation } from '@/lib/ghl-fees';
import { formatAmount, paiseToNumeric, toPaise } from '@/lib/money';
import { isUuid, readOptionalString } from '@/lib/validation';

/**
 * /api/school/fees/challans/[challanId]/payments
 *
 * GET  what has been received against this challan
 * POST record a payment
 *
 * ── On correctness ───────────────────────────────────────────────────────
 * Three things have to hold here, and all three are enforced server-side:
 *
 *   1. The amount may not exceed what is still owed. A browser can send any
 *      number; the balance is read from the database and checked here.
 *   2. The payment row, the challan's running total and the ledger posting go
 *      out in one transaction, and the total is incremented *in SQL*. A
 *      payment that recorded without moving `paid_amount` would leave a parent
 *      chased for money the school already has.
 *   3. The WhatsApp confirmation is fired *after* the commit and never awaited.
 *      GoHighLevel being slow or down must not fail a request that has already
 *      taken a parent's cash.
 *
 * The overpayment check in (1) still reads the balance before writing, so two
 * clerks taking money for the same challan in the same instant could between
 * them exceed the total. That is rare, visible (the challan shows more paid
 * than billed) and recoverable, whereas a lost payment is neither — which is
 * why (2) is the one made race-proof.
 *
 * ── The ledger posting, added in Sprint 13.5 ─────────────────────────────
 * A fourth thing now holds, and it is inside the same transaction as (2): the
 * payment posts to the school's books. Debit the account the money landed in,
 * credit Fee Income.
 *
 * Which account it lands in is the whole of the per-staff cash design, and
 * this route deliberately does not know about it: `cashAccountForStaff` answers
 * with the clerk's own drawer if they have one and the office drawer if they
 * do not. A cheque lands in `1020 Cheques in Hand` rather than the bank,
 * because a cheque is not money until it clears and a school counting it as
 * bank balance will overdraw on one that bounces.
 *
 * **It is not fired-and-forgotten like the WhatsApp confirmation.** A payment
 * recorded without its posting understates the school's income silently, and
 * silently is the problem: nothing on any screen would ever say so. So it
 * commits with the payment or the payment does not happen.
 *
 * The one exception is a school with no chart of accounts — every school
 * migrated by `0027` has one, and a school provisioned since gets one at
 * creation, but a school that somehow has none must still be able to take a
 * parent's money at the counter. That case posts nothing, says so in the
 * response, and leaves `ledger_transaction_id` null.
 *
 * ── The fourth thing, added with the admission fee gate ──────────────────
 * A payment can be the one that confirms an admission. `settleEnrolmentIfFeePaid`
 * is awaited, unlike the WhatsApp confirmation above, and the difference is
 * deliberate: the clerk taking the money is the person who will be asked "so
 * are they enrolled now?", and the response says so. It is bounded — two
 * indexed reads and, at most, one write per guardian — and it swallows its own
 * failures, so it can delay the response but never fail it.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type RouteContext = { params: Promise<{ challanId: string }> };

function isDateOnly(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;

  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

export const GET = withSchoolAuth<RouteContext>(
  async (_request, auth, context) => {
    try {
      const { challanId } = await context.params;
      if (!isUuid(challanId)) return apiFailure('not_found', 'Challan not found.', 404);

      const challan = await getChallanDetail(auth.locationId, challanId);
      if (challan === null) return apiFailure('not_found', 'Challan not found.', 404);

      return apiSuccess({
        payments: challan.payments,
        balance: remainingBalance(challan.totalAmount, challan.paidAmount).toFixed(2),
      });
    } catch (error) {
      return handleApiError(error);
    }
  },
  { permission: 'fees.read' },
);

interface RecordPaymentBody {
  amount?: unknown;
  paymentMethod?: unknown;
  referenceNumber?: unknown;
  paymentDate?: unknown;
  notes?: unknown;
}

/**
 * The two accounts a fee payment moves between, or null if the school has none.
 *
 * Separated out because the decision has three inputs and no side effects, and
 * because it is where the per-staff cash rule actually lives: the money lands
 * in the collector's own drawer when they have one, and in the office drawer
 * when they do not. The route above does not know which happened, which is
 * what lets a school switch the behaviour on for one clerk without anything in
 * the fee module changing.
 *
 * Returns null rather than throwing when the chart is missing. A school with
 * no accounts has to be able to take a parent's money; posting is what waits.
 */
async function resolvePosting(input: {
  locationId: string;
  systemAccounts: Awaited<ReturnType<typeof loadSystemAccounts>>;
  collector: string | null;
  paymentMethod: 'cash' | 'bank_transfer' | 'cheque';
}): Promise<{ landingAccountId: string; incomeAccountId: string } | null> {
  try {
    const income = requireSystemAccount(input.systemAccounts, 'fee_income', 'Fee Income');
    const landingKey = landingAccountFor(input.paymentMethod);
    const landing = requireSystemAccount(
      input.systemAccounts,
      landingKey,
      landingKey === 'bank'
        ? 'Bank Account'
        : landingKey === 'cheques_in_hand'
          ? 'Cheques in Hand'
          : 'Cash in Hand',
    );

    // Only cash sits in a person's drawer. A transfer is already at the bank
    // and a cheque is a piece of paper the office files, so neither belongs to
    // the individual who happened to key it in.
    const account =
      landingKey === 'cash_in_hand'
        ? await cashAccountForStaff(input.locationId, input.collector, landing)
        : landing;

    return { landingAccountId: account.id, incomeAccountId: income.id };
  } catch (error) {
    if (error instanceof LedgerError) {
      console.warn('[fees] payment not posted to the ledger:', error.message);
      return null;
    }
    throw error;
  }
}

export const POST = withSchoolAuth<RouteContext>(
  async (request, auth, context) => {
    try {
      const { challanId } = await context.params;
      if (!isUuid(challanId)) return apiFailure('not_found', 'Challan not found.', 404);

      const challan = await getChallanDetail(auth.locationId, challanId);
      if (challan === null) return apiFailure('not_found', 'Challan not found.', 404);

      if (challan.status === 'cancelled' || challan.status === 'waived') {
        return apiFailure(
          'challan_closed',
          `This challan is ${challan.status}, so no payment can be recorded against it.`,
          409,
        );
      }

      const body = await readJsonBody<RecordPaymentBody>(request);
      if (body === null) {
        return apiFailure('invalid_body', 'Expected a JSON body.', 400);
      }

      const amount = Number(body.amount);
      if (!Number.isFinite(amount) || amount <= 0) {
        return apiFailure('invalid_body', 'Enter an amount greater than zero.', 400);
      }

      if (!isPaymentMethod(body.paymentMethod)) {
        return apiFailure(
          'invalid_body',
          'Choose whether this was cash, a bank transfer or a cheque.',
          400,
        );
      }

      // Bound to a local because the insert below is built inside a callback,
      // and TypeScript drops the narrowing above for a property read there —
      // it cannot know the object is unchanged by the time the callback runs.
      const paymentMethod = body.paymentMethod;

      const paymentDate = isDateOnly(body.paymentDate)
        ? body.paymentDate
        : new Date().toISOString().slice(0, 10);

      // The balance is read from the database, never from the request. All of
      // this is in paise: a float comparison here would let a rounding artefact
      // through as an overpayment.
      const amountPaise = toPaise(amount);
      const totalPaise = toPaise(challan.totalAmount);
      const paidPaise = toPaise(challan.paidAmount);
      const remainingPaise = totalPaise - paidPaise;

      if (amountPaise > remainingPaise) {
        return apiFailure(
          'amount_too_large',
          `Only PKR ${formatAmount(remainingPaise / 100)} is still owed on this challan.`,
          400,
        );
      }

      const newPaidPaise = paidPaise + amountPaise;
      const newPaidAmount = paiseToNumeric(newPaidPaise);
      const newStatus = challanStatusFor(
        challan.totalAmount,
        newPaidAmount,
        challan.status,
      );

      const delta = paiseToNumeric(amountPaise);

      // Resolved before the transaction opens: two indexed reads that do not
      // need to be inside it, and keeping them out shortens the window the
      // challan row is held for.
      const systemAccounts = await loadSystemAccounts(auth.locationId);
      const collector = await schoolUserIdForUid(auth.locationId, auth.uid);

      const posting = await resolvePosting({
        locationId: auth.locationId,
        systemAccounts,
        collector,
        paymentMethod,
      });

      const challanUpdate = (tx: Tx): PromiseLike<unknown> =>
        tx
          .update(feeChallans)
          .set({
            // Incremented in SQL rather than written from the value read
            // above. Two clerks recording at the same moment would otherwise
            // each write `read + their own amount`, and the second would
            // erase the first — a parent's money vanishing from the ledger.
            paidAmount: sql`${feeChallans.paidAmount} + ${delta}`,
            // Derived from the incremented total for the same reason, and it
            // leaves a cancelled or waived challan's status alone: those are
            // decisions a human made.
            status: sql`CASE
              WHEN ${feeChallans.status} IN ('cancelled', 'waived') THEN ${feeChallans.status}
              WHEN ${feeChallans.paidAmount} + ${delta} >= ${feeChallans.totalAmount} THEN 'paid'
              WHEN ${feeChallans.paidAmount} + ${delta} > 0 THEN 'partial'
              ELSE 'unpaid'
            END`,
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(feeChallans.id, challanId),
              eq(feeChallans.locationId, auth.locationId),
            ),
          );

      // One transaction: the payment, the challan's running total, and the
      // ledger posting. `batch()` used to open it; it is written out here
      // because the posting has to read the id of the row it is linked to,
      // which a list of independent statements cannot express.
      const ledgerTransactionId = await db.transaction(async (tx) => {
        const transactionId =
          posting === null
            ? null
            : await postTransaction(tx, {
                locationId: auth.locationId,
                entryDate: paymentDate,
                memo: `Fee received — ${challan.studentName} (${challan.challanNumber})`,
                source: 'fee_payment',
                referenceNumber: readOptionalString(body.referenceNumber),
                createdByUid: auth.uid,
                lines: twoSidedLines(
                  posting.landingAccountId,
                  posting.incomeAccountId,
                  amountPaise,
                ),
              });

        const [payment] = await tx
          .insert(feePayments)
          .values({
            locationId: auth.locationId,
            challanId,
            amount: delta,
            paymentMethod,
            referenceNumber: readOptionalString(body.referenceNumber),
            paymentDate,
            collectedByUid: auth.uid,
            notes: readOptionalString(body.notes),
            ledgerTransactionId: transactionId,
          })
          .returning({ id: feePayments.id });

        // `source_id` points at the payment, which does not exist until the
        // line above. Set here rather than left null: the day book's "what
        // caused this" link, and the guard that stops the `0027` backfill
        // touching a payment that already has a posting, both read it.
        if (transactionId !== null && payment !== undefined) {
          await tx
            .update(ledgerTransactions)
            .set({ sourceId: payment.id })
            .where(eq(ledgerTransactions.id, transactionId));
        }

        await challanUpdate(tx);

        return transactionId;
      });

      // Fired, not awaited. The money is already recorded; a slow or broken
      // GHL or SMTP must not turn a successful payment into a failed request.
      // Unlike the reminders route, an unreachable guardian is not reported
      // back here: the payment succeeded either way, and the person who would
      // read the message is standing at the counter holding a receipt.
      if (challan.guardian !== null) {
        void sendPaymentConfirmation(db, auth.locationId, {
          guardian: challan.guardian,
          studentName: challan.studentName,
          challanNumber: challan.challanNumber,
          amountPaid: amountPaise / 100,
          schoolName: challan.schoolName,
        }).catch((error: unknown) => {
          console.warn('[fees] payment confirmation could not be queued:', error);
        });
      }

      const gate = await settleEnrolmentIfFeePaid({
        locationId: auth.locationId,
        studentProfileId: challan.studentProfileId,
        actorUid: auth.uid,
      });

      return apiSuccess(
        {
          payment: {
            amount: paiseToNumeric(amountPaise),
            paymentMethod: body.paymentMethod,
            paymentDate,
            /**
             * Null only at a school with no chart of accounts. The receipt
             * screen says so rather than staying quiet: a payment that did not
             * reach the books is a reconciliation problem, and the person who
             * can fix it is the one standing there.
             */
            ledgerTransactionId,
          },
          newStatus,
          newPaidAmount,
          balance: ((totalPaise - newPaidPaise) / 100).toFixed(2),
          enrolment: {
            justCleared: gate.cleared,
            welcomesQueued: gate.welcomes.filter((one) => one.emailQueued).length,
            // Only the guardians who could not be reached. A clerk needs to
            // know that the father has no address on file; they do not need a
            // line about the two parents it worked for.
            welcomeProblems: gate.welcomes
              .filter((one) => one.reason !== null)
              .map((one) => one.reason as string),
          },
        },
        201,
      );
    } catch (error) {
      return handleApiError(error);
    }
  },
  { permission: 'fees.write' },
);
