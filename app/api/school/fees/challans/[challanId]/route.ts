import { and, eq } from 'drizzle-orm';

import { feeChallans } from '@/db/schema';
import { withSchoolAuth } from '@/lib/api-auth';
import { apiFailure, apiSuccess, handleApiError, readJsonBody } from '@/lib/api-response';
import { db } from '@/lib/drizzle';
import { calculateLateFee, challanStatusFor } from '@/lib/fee-calculator';
import { getChallanDetail, getLateFeeRule } from '@/lib/fee-queries';
import { paiseToNumeric, toPaise } from '@/lib/money';
import { isUuid, readOptionalString } from '@/lib/validation';

/**
 * /api/school/fees/challans/[challanId]
 *
 * GET   one challan with its lines, payments and school details
 * PATCH cancel it, waive it, move the due date, or apply the late fee
 *
 * There is no DELETE. A challan that has been printed and handed to a parent
 * has left the building; it is cancelled, which is a status a human can explain
 * to the parent standing at the counter, not a row that quietly vanishes.
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

      return apiSuccess({ challan });
    } catch (error) {
      return handleApiError(error);
    }
  },
  { permission: 'fees.read' },
);

interface UpdateChallanBody {
  /** `cancel` or `waive`. Both are terminal. */
  action?: unknown;
  dueDate?: unknown;
  notes?: unknown;
  /** Recomputes the overdue charge from the school's policy. */
  applyLateFee?: unknown;
}

export const PATCH = withSchoolAuth<RouteContext>(
  async (request, auth, context) => {
    try {
      const { challanId } = await context.params;
      if (!isUuid(challanId)) return apiFailure('not_found', 'Challan not found.', 404);

      const existing = await getChallanDetail(auth.locationId, challanId);
      if (existing === null) return apiFailure('not_found', 'Challan not found.', 404);

      const body = await readJsonBody<UpdateChallanBody>(request);
      if (body === null) {
        return apiFailure('invalid_body', 'Expected a JSON body.', 400);
      }

      const updates: Partial<typeof feeChallans.$inferInsert> = { updatedAt: new Date() };

      // Closing a challan and charging it more are contradictory instructions;
      // taking both would let the late fee branch reopen what was just waived.
      if (
        body.applyLateFee === true &&
        (body.action === 'cancel' || body.action === 'waive')
      ) {
        return apiFailure(
          'invalid_body',
          'A challan cannot be closed and charged a late fee in the same request.',
          400,
        );
      }

      if (body.action === 'cancel' || body.action === 'waive') {
        if (existing.status === 'cancelled' || existing.status === 'waived') {
          return apiFailure(
            'already_closed',
            `This challan is already ${existing.status}.`,
            409,
          );
        }

        // Money already taken cannot be un-taken by a status change; refunding
        // it is a conversation at the counter, not a button here.
        if (body.action === 'cancel' && toPaise(existing.paidAmount) > 0) {
          return apiFailure(
            'has_payments',
            'Payments have already been recorded against this challan, so it cannot be cancelled. Waive the balance instead.',
            409,
          );
        }

        updates.status = body.action === 'cancel' ? 'cancelled' : 'waived';
      }

      if (body.dueDate !== undefined) {
        if (!isDateOnly(body.dueDate)) {
          return apiFailure('invalid_body', 'Enter a valid due date.', 400);
        }
        updates.dueDate = body.dueDate;
      }

      if (body.notes !== undefined) {
        updates.notes = readOptionalString(body.notes);
      }

      if (body.applyLateFee === true) {
        if (existing.status === 'paid' || existing.status === 'cancelled' || existing.status === 'waived') {
          return apiFailure(
            'not_applicable',
            'Late fees only apply to challans that are still owing.',
            409,
          );
        }

        const rule = await getLateFeeRule(auth.locationId);
        if (rule === null || !rule.isEnabled) {
          return apiFailure(
            'late_fees_disabled',
            'Late fees are switched off for this school. Enable them in Fee settings first.',
            409,
          );
        }

        const lateFee = calculateLateFee(
          updates.dueDate ?? existing.dueDate,
          rule,
        );

        if (lateFee <= 0) {
          return apiFailure(
            'not_overdue',
            'This challan is not overdue yet, so there is no late fee to add.',
            409,
          );
        }

        // The late fee replaces whatever was charged before rather than
        // stacking on it, so applying twice does not double the penalty.
        const lateFeePaise = toPaise(lateFee);
        const basePaise =
          toPaise(existing.subtotal) - toPaise(existing.concessionAmount);

        updates.lateFeeAmount = paiseToNumeric(lateFeePaise);
        updates.totalAmount = paiseToNumeric(basePaise + lateFeePaise);
        updates.status = challanStatusFor(
          paiseToNumeric(basePaise + lateFeePaise),
          existing.paidAmount,
          existing.status,
        );
      }

      if (Object.keys(updates).length <= 1) {
        return apiFailure('invalid_body', 'No changes to apply.', 400);
      }

      const updated = await db
        .update(feeChallans)
        .set(updates)
        .where(
          and(
            eq(feeChallans.id, challanId),
            eq(feeChallans.locationId, auth.locationId),
          ),
        )
        .returning({ id: feeChallans.id });

      if (updated[0] === undefined) {
        return apiFailure('not_found', 'Challan not found.', 404);
      }

      return apiSuccess({ challan: await getChallanDetail(auth.locationId, challanId) });
    } catch (error) {
      return handleApiError(error);
    }
  },
  { permission: 'fees.write' },
);
