import { and, eq } from 'drizzle-orm';

import { leaveTypes } from '@/db/schema';
import { withSchoolAuth } from '@/lib/api-auth';
import { apiFailure, apiSuccess, handleApiError, readJsonBody } from '@/lib/api-response';
import { db } from '@/lib/drizzle';
import { getLeaveType } from '@/lib/hr-queries';
import { isUuid, readBoolean, readOptionalString, readString } from '@/lib/validation';

/**
 * PATCH /api/school/hr/leave-types/[leaveTypeId]
 *
 * Renames a leave head, adjusts its quota, changes whether it is paid, or
 * retires it. No DELETE: approved requests reference it, and a payslip that
 * docked someone has to stay explainable.
 *
 * Changing `isPaid` does not rewrite payslips already issued — those carry
 * their own snapshot — but it does change what the *next* run computes for
 * leave already approved under the old setting. That is the intended
 * behaviour: a school correcting a mistake wants the correction applied.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type RouteContext = { params: Promise<{ leaveTypeId: string }> };

interface UpdateLeaveTypeBody {
  name?: unknown;
  description?: unknown;
  annualQuotaDays?: unknown;
  isPaid?: unknown;
  isActive?: unknown;
  sortOrder?: unknown;
}

export const PATCH = withSchoolAuth<RouteContext>(
  async (request, auth, context) => {
    try {
      const { leaveTypeId } = await context.params;
      if (!isUuid(leaveTypeId)) {
        return apiFailure('not_found', 'Leave type not found.', 404);
      }

      const existing = await getLeaveType(auth.locationId, leaveTypeId);
      if (existing === null) {
        return apiFailure('not_found', 'Leave type not found.', 404);
      }

      const body = await readJsonBody<UpdateLeaveTypeBody>(request);
      if (body === null) {
        return apiFailure('invalid_body', 'Expected a JSON body.', 400);
      }

      const updates: Partial<typeof leaveTypes.$inferInsert> = {};

      if (body.name !== undefined) {
        const name = readString(body.name);
        if (name === '' || name.length > 60) {
          return apiFailure(
            'invalid_body',
            'Enter a leave name of 60 characters or fewer.',
            400,
          );
        }
        updates.name = name;
      }

      if (body.description !== undefined) {
        updates.description = readOptionalString(body.description);
      }

      if (body.annualQuotaDays !== undefined) {
        const quota = Number(body.annualQuotaDays);
        if (!Number.isInteger(quota) || quota < 0 || quota > 365) {
          return apiFailure(
            'invalid_body',
            'The annual quota must be a whole number of days between 0 and 365.',
            400,
          );
        }
        updates.annualQuotaDays = quota;
      }

      if (body.isPaid !== undefined) {
        updates.isPaid = readBoolean(body.isPaid, existing.isPaid);
      }

      if (body.isActive !== undefined) {
        updates.isActive = readBoolean(body.isActive, existing.isActive);
      }

      if (body.sortOrder !== undefined) {
        const sortOrder = Number(body.sortOrder);
        if (!Number.isInteger(sortOrder) || sortOrder < 0 || sortOrder > 999) {
          return apiFailure(
            'invalid_body',
            'The display order must be a whole number between 0 and 999.',
            400,
          );
        }
        updates.sortOrder = sortOrder;
      }

      if (Object.keys(updates).length === 0) {
        return apiFailure('invalid_body', 'No fields to update.', 400);
      }

      const updated = await db
        .update(leaveTypes)
        .set(updates)
        .where(
          and(eq(leaveTypes.id, leaveTypeId), eq(leaveTypes.locationId, auth.locationId)),
        )
        .returning({ id: leaveTypes.id });

      if (updated[0] === undefined) {
        return apiFailure('not_found', 'Leave type not found.', 404);
      }

      return apiSuccess({ leaveType: await getLeaveType(auth.locationId, leaveTypeId) });
    } catch (error) {
      return handleApiError(error);
    }
  },
  { permission: 'hr.write' },
);
