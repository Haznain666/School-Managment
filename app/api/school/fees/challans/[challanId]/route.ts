import { and, eq } from 'drizzle-orm';

import { feeChallans, isChallanStatus } from '@/db/schema';
import { withSchoolAuth } from '@/lib/api-auth';
import { apiFailure, apiSuccess, handleApiError, readJsonBody } from '@/lib/api-response';
import { db } from '@/lib/drizzle';
import { getChallanDetail } from '@/lib/fee-queries';
import { FEE_READ_ROLES, FEE_WRITE_ROLES } from '@/lib/fee-roles';
import { isUuid, readOptionalString } from '@/lib/validation';

/**
 * /api/school/fees/challans/[challanId]
 *
 * GET   the challan with its line items, payments and guardian contact
 * PATCH cancel it, waive it, or adjust the due date and notes
 *
 * Amounts are not editable. A challan is a document a family may already be
 * holding and a bank may already have stamped; changing what it says after the
 * fact would make the paper and the record disagree. A wrong challan is
 * cancelled and a new one raised, which leaves both visible.
 *
 * Cancelling or waiving a challan that has money against it is refused — that
 * would strand the payment rows on a bill that no longer counts.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type RouteContext = { params: Promise<{ challanId: string }> };

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Statuses an admin may set by hand. Paid and partial come from payments. */
const SETTABLE_STATUSES = ['cancelled', 'waived'] as const;

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
  { allowedRoles: FEE_READ_ROLES },
);

interface UpdateChallanBody {
  status?: unknown;
  notes?: unknown;
  dueDate?: unknown;
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

      const updates: Partial<typeof feeChallans.$inferInsert> = {};

      if (body.status !== undefined) {
        if (
          !isChallanStatus(body.status) ||
          !(SETTABLE_STATUSES as readonly string[]).includes(body.status)
        ) {
          return apiFailure(
            'invalid_body',
            'A challan can only be cancelled or waived by hand — paid and partial follow from payments.',
            400,
          );
        }

        if (existing.paidPaise > 0) {
          return apiFailure(
            'has_payments',
            'This challan already has payments recorded against it, so it cannot be cancelled or waived. Record a refund outside the system and add a note instead.',
            409,
          );
        }

        updates.status = body.status;
      }

      if (body.dueDate !== undefined) {
        const dueDate = readOptionalString(body.dueDate);
        if (
          dueDate === null ||
          !ISO_DATE.test(dueDate) ||
          Number.isNaN(Date.parse(dueDate))
        ) {
          return apiFailure('invalid_body', 'Enter a valid due date.', 400);
        }
        updates.dueDate = dueDate;
      }

      if (body.notes !== undefined) updates.notes = readOptionalString(body.notes);

      if (Object.keys(updates).length === 0) {
        return apiFailure('invalid_body', 'No fields to update.', 400);
      }

      updates.updatedAt = new Date();

      await db
        .update(feeChallans)
        .set(updates)
        .where(
          and(
            eq(feeChallans.id, challanId),
            eq(feeChallans.locationId, auth.locationId),
          ),
        );

      return apiSuccess({ challan: await getChallanDetail(auth.locationId, challanId) });
    } catch (error) {
      return handleApiError(error);
    }
  },
  { allowedRoles: FEE_WRITE_ROLES },
);
