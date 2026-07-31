import { randomUUID } from 'node:crypto';

import { and, eq, sql } from 'drizzle-orm';

import {
  feeChallans,
  feePayments,
  isPaymentMethod,
  PAYABLE_CHALLAN_STATUSES,
  schools,
} from '@/db/schema';
import { withSchoolAuth } from '@/lib/api-auth';
import { apiFailure, apiSuccess, handleApiError, readJsonBody } from '@/lib/api-response';
import { db } from '@/lib/drizzle';
import { getChallanDetail } from '@/lib/fee-queries';
import { FEE_READ_ROLES, FEE_WRITE_ROLES } from '@/lib/fee-roles';
import { sendPaymentConfirmationWhatsApp } from '@/lib/ghl-fees';
import { formatPkr, paiseToNumericString, parsePaise } from '@/lib/money';
import { isUuid, readOptionalString, readString } from '@/lib/validation';

/**
 * /api/school/fees/challans/[challanId]/payments
 *
 * GET  what has been paid against this challan
 * POST record a payment
 *
 * ── On atomicity ─────────────────────────────────────────────────────────
 * A payment row and the challan's running `paid_amount` must move together: a
 * payment recorded against a challan that still reads unpaid would be collected
 * twice, and a challan marked paid with no payment row behind it is money that
 * cannot be accounted for. Both statements go out in one `db.batch()`, which
 * Neon runs as a single transaction.
 *
 * The increment is expressed as `paid_amount + ?` in SQL rather than computed
 * in JavaScript and written back, so two clerks taking two instalments at the
 * same moment cannot each overwrite the other's total.
 *
 * The WhatsApp confirmation runs afterwards and cannot fail the payment. The
 * family has already handed over the money; a CRM outage is not their problem.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type RouteContext = { params: Promise<{ challanId: string }> };

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export const GET = withSchoolAuth<RouteContext>(
  async (_request, auth, context) => {
    try {
      const { challanId } = await context.params;
      if (!isUuid(challanId)) return apiFailure('not_found', 'Challan not found.', 404);

      const challan = await getChallanDetail(auth.locationId, challanId);
      if (challan === null) return apiFailure('not_found', 'Challan not found.', 404);

      return apiSuccess({ payments: challan.payments });
    } catch (error) {
      return handleApiError(error);
    }
  },
  { allowedRoles: FEE_READ_ROLES },
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

      // Reading through `getChallanDetail` is what proves the challan belongs
      // to the caller's tenant — the id came off the URL.
      const challan = await getChallanDetail(auth.locationId, challanId);
      if (challan === null) return apiFailure('not_found', 'Challan not found.', 404);

      if (!(PAYABLE_CHALLAN_STATUSES as readonly string[]).includes(challan.status)) {
        return apiFailure(
          'not_payable',
          challan.status === 'paid'
            ? 'This challan is already fully paid.'
            : `A ${challan.status} challan cannot take a payment.`,
          409,
        );
      }

      const body = await readJsonBody<RecordPaymentBody>(request);
      if (body === null) {
        return apiFailure('invalid_body', 'Expected a JSON body.', 400);
      }

      const amountPaise = parsePaise(readString(body.amount));
      if (amountPaise === null || amountPaise <= 0) {
        return apiFailure(
          'invalid_body',
          'Enter the amount received in rupees, e.g. 5000 or 5000.50.',
          400,
        );
      }

      // Overpayment is refused rather than absorbed: this module has no way to
      // issue a refund or carry a credit forward, so accepting more than is
      // owed would create a balance nothing can spend.
      if (amountPaise > challan.balancePaise) {
        return apiFailure(
          'exceeds_balance',
          `That is more than the outstanding balance of PKR ${formatPkr(challan.balancePaise)}.`,
          400,
        );
      }

      if (!isPaymentMethod(body.paymentMethod)) {
        return apiFailure(
          'invalid_body',
          'Choose cash, bank transfer or cheque.',
          400,
        );
      }

      const paymentDate = readOptionalString(body.paymentDate);
      if (
        paymentDate !== null &&
        (!ISO_DATE.test(paymentDate) || Number.isNaN(Date.parse(paymentDate)))
      ) {
        return apiFailure('invalid_body', 'Enter a valid payment date.', 400);
      }

      const amount = paiseToNumericString(amountPaise);
      const nextPaidPaise = challan.paidPaise + amountPaise;
      const nextStatus = nextPaidPaise >= challan.totalPaise ? 'paid' : 'partial';

      const paymentId = randomUUID();

      await db.batch([
        db.insert(feePayments).values({
          id: paymentId,
          // Tenant comes from the verified session, never from the body.
          locationId: auth.locationId,
          challanId,
          amount,
          paymentMethod: body.paymentMethod,
          referenceNumber: readOptionalString(body.referenceNumber),
          ...(paymentDate === null ? {} : { paymentDate }),
          collectedByUid: auth.uid,
          notes: readOptionalString(body.notes),
        }),
        db
          .update(feeChallans)
          .set({
            // Incremented in SQL, not read-modify-written, so concurrent
            // instalments cannot clobber one another.
            paidAmount: sql`${feeChallans.paidAmount} + ${amount}::numeric`,
            status: nextStatus,
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(feeChallans.id, challanId),
              eq(feeChallans.locationId, auth.locationId),
            ),
          ),
      ]);

      const updated = await getChallanDetail(auth.locationId, challanId);

      // After the money is safely recorded, never before, and never fatal.
      if (challan.guardianPhone !== null && challan.guardianName !== null) {
        const schoolRows = await db
          .select({ name: schools.name })
          .from(schools)
          .where(eq(schools.locationId, auth.locationId))
          .limit(1);

        await sendPaymentConfirmationWhatsApp(db, auth.locationId, {
          guardianPhone: challan.guardianPhone,
          guardianName: challan.guardianName,
          studentName: challan.studentName,
          challanNumber: challan.challanNumber,
          amountPaid: formatPkr(amountPaise),
          schoolName: schoolRows[0]?.name ?? 'your school',
        });
      }

      return apiSuccess(
        {
          payment: { id: paymentId, amountPaise },
          challan: {
            newStatus: updated?.status ?? nextStatus,
            newPaidPaise: updated?.paidPaise ?? nextPaidPaise,
            balancePaise: updated?.balancePaise ?? 0,
          },
        },
        201,
      );
    } catch (error) {
      return handleApiError(error);
    }
  },
  { allowedRoles: FEE_WRITE_ROLES },
);
