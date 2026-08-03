import { and, eq } from 'drizzle-orm';

import { isPaymentMode, isPayslipStatus, payslips } from '@/db/schema';
import { withSchoolAuth } from '@/lib/api-auth';
import { apiFailure, apiSuccess, handleApiError, readJsonBody } from '@/lib/api-response';
import { db } from '@/lib/drizzle';
import { getPayslipDetail } from '@/lib/hr-queries';
import { isIsoDate, isUuid, readOptionalString } from '@/lib/validation';
import { PAYROLL_READ_ROLES, PAYROLL_WRITE_ROLES } from '@/types/school-auth';

/**
 * /api/school/payroll/payslips/[payslipId]
 *
 * GET   one payslip with its lines, for the screen and the printable slip
 * PATCH record how it was paid, or hold it
 *
 * ── What may and may not change ──────────────────────────────────────────
 * Only the payment fields. Not one amount, not one line. A payslip is a
 * snapshot of what was computed, and a school that could edit the net figure
 * after the fact would have no record of what it actually owed — which is
 * precisely what a payslip is for.
 *
 * Marking one paid is refused while its run is still a draft. A draft is
 * regenerable, and a payslip marked paid against a run that is then recomputed
 * would leave the school believing it had already paid a figure that no longer
 * exists.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type RouteContext = { params: Promise<{ payslipId: string }> };

export const GET = withSchoolAuth<RouteContext>(
  async (_request, auth, context) => {
    try {
      const { payslipId } = await context.params;
      if (!isUuid(payslipId)) {
        return apiFailure('not_found', 'Payslip not found.', 404);
      }

      const payslip = await getPayslipDetail(auth.locationId, payslipId);
      if (payslip === null) {
        return apiFailure('not_found', 'Payslip not found.', 404);
      }

      return apiSuccess({ payslip });
    } catch (error) {
      return handleApiError(error);
    }
  },
  { allowedRoles: PAYROLL_READ_ROLES },
);

interface UpdatePayslipBody {
  status?: unknown;
  paymentMode?: unknown;
  paidOn?: unknown;
  paymentReference?: unknown;
  notes?: unknown;
}

export const PATCH = withSchoolAuth<RouteContext>(
  async (request, auth, context) => {
    try {
      const { payslipId } = await context.params;
      if (!isUuid(payslipId)) {
        return apiFailure('not_found', 'Payslip not found.', 404);
      }

      const existing = await getPayslipDetail(auth.locationId, payslipId);
      if (existing === null) {
        return apiFailure('not_found', 'Payslip not found.', 404);
      }

      const body = await readJsonBody<UpdatePayslipBody>(request);
      if (body === null) {
        return apiFailure('invalid_body', 'Expected a JSON body.', 400);
      }

      const updates: Partial<typeof payslips.$inferInsert> = {};

      if (body.status !== undefined) {
        if (!isPayslipStatus(body.status)) {
          return apiFailure('invalid_body', 'Choose a valid payslip status.', 400);
        }

        if (body.status === 'paid' && existing.runStatus === 'draft') {
          return apiFailure(
            'invalid_state',
            'Approve the payroll run before marking payslips paid.',
            409,
          );
        }

        updates.status = body.status;

        // A payslip marked paid with no date recorded defaults to today, so a
        // clerk cannot leave the school without a payment date on record.
        if (body.status === 'paid' && body.paidOn === undefined) {
          updates.paidOn = new Date().toISOString().slice(0, 10);
        }
      }

      if (body.paymentMode !== undefined) {
        if (body.paymentMode === null) updates.paymentMode = null;
        else if (isPaymentMode(body.paymentMode)) updates.paymentMode = body.paymentMode;
        else return apiFailure('invalid_body', 'Choose a valid payment method.', 400);
      }

      if (body.paidOn !== undefined) {
        const paidOn = readOptionalString(body.paidOn);
        if (paidOn !== null && !isIsoDate(paidOn)) {
          return apiFailure('invalid_body', 'Enter a valid payment date.', 400);
        }
        updates.paidOn = paidOn;
      }

      if (body.paymentReference !== undefined) {
        updates.paymentReference = readOptionalString(body.paymentReference);
      }

      if (body.notes !== undefined) {
        updates.notes = readOptionalString(body.notes);
      }

      if (Object.keys(updates).length === 0) {
        return apiFailure('invalid_body', 'No fields to update.', 400);
      }

      updates.updatedAt = new Date();

      const updated = await db
        .update(payslips)
        .set(updates)
        .where(and(eq(payslips.id, payslipId), eq(payslips.locationId, auth.locationId)))
        .returning({ id: payslips.id });

      if (updated[0] === undefined) {
        return apiFailure('not_found', 'Payslip not found.', 404);
      }

      return apiSuccess({ payslip: await getPayslipDetail(auth.locationId, payslipId) });
    } catch (error) {
      return handleApiError(error);
    }
  },
  { allowedRoles: PAYROLL_WRITE_ROLES },
);
