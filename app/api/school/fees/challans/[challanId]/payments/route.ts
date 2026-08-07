import { and, eq, sql } from 'drizzle-orm';

import { feeChallans, feePayments, isPaymentMethod } from '@/db/schema';
import { withSchoolAuth } from '@/lib/api-auth';
import { apiFailure, apiSuccess, handleApiError, readJsonBody } from '@/lib/api-response';
import { batch, db, type Tx } from '@/lib/drizzle';
import { challanStatusFor, remainingBalance } from '@/lib/fee-calculator';
import { getChallanDetail } from '@/lib/fee-queries';
import { sendPaymentConfirmationWhatsApp } from '@/lib/ghl-fees';
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
 *   2. The payment row and the challan's running total go out through
 *      `batch()`, in one transaction, and the total is incremented *in SQL*. A
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

      // Deferred until `batch()` opens the transaction: a Drizzle builder is
      // bound to the session that created it, so these must be built on `tx`.
      const statements: ((tx: Tx) => PromiseLike<unknown>)[] = [
        (tx) =>
          tx.insert(feePayments).values({
            locationId: auth.locationId,
            challanId,
            amount: delta,
            paymentMethod,
            referenceNumber: readOptionalString(body.referenceNumber),
            paymentDate,
            collectedByUid: auth.uid,
            notes: readOptionalString(body.notes),
          }),
        (tx) =>
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
            ),
      ];

      await batch(db, (tx) => statements.map((statement) => statement(tx)));

      // Fired, not awaited. The money is already recorded; a slow or broken
      // GHL must not turn a successful payment into a failed request.
      if (challan.guardian !== null) {
        void sendPaymentConfirmationWhatsApp(db, auth.locationId, {
          guardianName: challan.guardian.name,
          guardianPhone: challan.guardian.phone,
          studentName: challan.studentName,
          challanNumber: challan.challanNumber,
          amountPaid: amountPaise / 100,
          schoolName: challan.schoolName,
        }).catch((error: unknown) => {
          console.warn('[fees] payment confirmation could not be queued:', error);
        });
      }

      return apiSuccess(
        {
          payment: {
            amount: paiseToNumeric(amountPaise),
            paymentMethod: body.paymentMethod,
            paymentDate,
          },
          newStatus,
          newPaidAmount,
          balance: ((totalPaise - newPaidPaise) / 100).toFixed(2),
        },
        201,
      );
    } catch (error) {
      return handleApiError(error);
    }
  },
  { permission: 'fees.write' },
);
