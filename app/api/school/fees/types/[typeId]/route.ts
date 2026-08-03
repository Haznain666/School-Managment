import { and, eq } from 'drizzle-orm';

import { feeTypes, isFeeCategory } from '@/db/schema';
import { withSchoolAuth } from '@/lib/api-auth';
import { apiFailure, apiSuccess, handleApiError, readJsonBody } from '@/lib/api-response';
import { db } from '@/lib/drizzle';
import { getFeeType } from '@/lib/fee-queries';
import { isUuid, readBoolean, readOptionalString, readString } from '@/lib/validation';

/**
 * /api/school/fees/types/[typeId]
 *
 * GET   one fee head
 * PATCH rename it, recategorise it, or retire it
 *
 * There is no DELETE. A head that has ever been billed is referenced by
 * structures and challan lines; retiring it with `isActive: false` keeps it off
 * new challans while leaving the ones already issued explainable.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type RouteContext = { params: Promise<{ typeId: string }> };

export const GET = withSchoolAuth<RouteContext>(
  async (_request, auth, context) => {
    try {
      const { typeId } = await context.params;
      if (!isUuid(typeId)) return apiFailure('not_found', 'Fee type not found.', 404);

      const feeType = await getFeeType(auth.locationId, typeId);
      if (feeType === null) return apiFailure('not_found', 'Fee type not found.', 404);

      return apiSuccess({ feeType });
    } catch (error) {
      return handleApiError(error);
    }
  },
  { permission: 'fees.read' },
);

interface UpdateFeeTypeBody {
  name?: unknown;
  description?: unknown;
  feeCategory?: unknown;
  isActive?: unknown;
  sortOrder?: unknown;
}

export const PATCH = withSchoolAuth<RouteContext>(
  async (request, auth, context) => {
    try {
      const { typeId } = await context.params;
      if (!isUuid(typeId)) return apiFailure('not_found', 'Fee type not found.', 404);

      const existing = await getFeeType(auth.locationId, typeId);
      if (existing === null) return apiFailure('not_found', 'Fee type not found.', 404);

      const body = await readJsonBody<UpdateFeeTypeBody>(request);
      if (body === null) {
        return apiFailure('invalid_body', 'Expected a JSON body.', 400);
      }

      const updates: Partial<typeof feeTypes.$inferInsert> = {};

      if (body.name !== undefined) {
        const name = readString(body.name);
        if (name === '' || name.length > 80) {
          return apiFailure(
            'invalid_body',
            'Enter a fee name of 80 characters or fewer.',
            400,
          );
        }
        updates.name = name;
      }

      if (body.description !== undefined) {
        updates.description = readOptionalString(body.description);
      }

      if (body.feeCategory !== undefined) {
        if (!isFeeCategory(body.feeCategory)) {
          return apiFailure(
            'invalid_body',
            'Choose whether this fee is monthly, one time or annual.',
            400,
          );
        }
        updates.feeCategory = body.feeCategory;
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
        .update(feeTypes)
        .set(updates)
        .where(and(eq(feeTypes.id, typeId), eq(feeTypes.locationId, auth.locationId)))
        .returning({ id: feeTypes.id });

      if (updated[0] === undefined) {
        return apiFailure('not_found', 'Fee type not found.', 404);
      }

      return apiSuccess({ feeType: await getFeeType(auth.locationId, typeId) });
    } catch (error) {
      return handleApiError(error);
    }
  },
  { permission: 'fees.write' },
);
