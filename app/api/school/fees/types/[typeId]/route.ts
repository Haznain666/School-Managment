import { and, eq, ne } from 'drizzle-orm';

import { feeTypes } from '@/db/schema';
import { withSchoolAuth } from '@/lib/api-auth';
import { apiFailure, apiSuccess, handleApiError, readJsonBody } from '@/lib/api-response';
import { db } from '@/lib/drizzle';
import { getFeeType } from '@/lib/fee-queries';
import { FEE_READ_ROLES, FEE_WRITE_ROLES } from '@/lib/fee-roles';
import { isUuid, readOptionalString, readString } from '@/lib/validation';

/**
 * /api/school/fees/types/[typeId]
 *
 * GET   one fee head
 * PATCH rename it, re-describe it, reorder it, or switch it off
 *
 * `fee_category` is deliberately not editable. Switching a head from monthly to
 * annual after challans have been raised under it would silently change what
 * every future bulk run charges, with no trace of when the meaning shifted — a
 * school that needs a different category should switch this head off and add a
 * new one. Deletion is refused for the same reason: `fee_challan_items` points
 * here, and history has to stay explicable.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type RouteContext = { params: Promise<{ typeId: string }> };

export const GET = withSchoolAuth<RouteContext>(
  async (_request, auth, context) => {
    try {
      const { typeId } = await context.params;
      if (!isUuid(typeId)) return apiFailure('not_found', 'Fee head not found.', 404);

      const feeType = await getFeeType(auth.locationId, typeId);
      if (feeType === null) return apiFailure('not_found', 'Fee head not found.', 404);

      return apiSuccess({ feeType });
    } catch (error) {
      return handleApiError(error);
    }
  },
  { allowedRoles: FEE_READ_ROLES },
);

interface UpdateFeeTypeBody {
  name?: unknown;
  description?: unknown;
  isActive?: unknown;
  sortOrder?: unknown;
}

export const PATCH = withSchoolAuth<RouteContext>(
  async (request, auth, context) => {
    try {
      const { typeId } = await context.params;
      if (!isUuid(typeId)) return apiFailure('not_found', 'Fee head not found.', 404);

      const existing = await getFeeType(auth.locationId, typeId);
      if (existing === null) return apiFailure('not_found', 'Fee head not found.', 404);

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
            'Enter a name of 80 characters or fewer.',
            400,
          );
        }
        updates.name = name;
      }

      if (body.description !== undefined) {
        updates.description = readOptionalString(body.description);
      }

      if (typeof body.isActive === 'boolean') updates.isActive = body.isActive;

      if (body.sortOrder !== undefined) {
        const sortOrder = Number(body.sortOrder);
        if (!Number.isInteger(sortOrder) || sortOrder < 0 || sortOrder > 999) {
          return apiFailure('invalid_body', 'Sort order must be 0 to 999.', 400);
        }
        updates.sortOrder = sortOrder;
      }

      if (Object.keys(updates).length === 0) {
        return apiFailure('invalid_body', 'No fields to update.', 400);
      }

      // Names are unique per school. Checked here rather than caught from the
      // constraint so the caller gets a message naming the actual problem.
      if (updates.name !== undefined && updates.name !== existing.name) {
        const clash = await db
          .select({ id: feeTypes.id })
          .from(feeTypes)
          .where(
            and(
              eq(feeTypes.locationId, auth.locationId),
              eq(feeTypes.name, updates.name),
              ne(feeTypes.id, typeId),
            ),
          )
          .limit(1);

        if (clash[0] !== undefined) {
          return apiFailure(
            'already_exists',
            'Another fee head at this school already uses that name.',
            409,
          );
        }
      }

      const updated = await db
        .update(feeTypes)
        .set(updates)
        .where(and(eq(feeTypes.id, typeId), eq(feeTypes.locationId, auth.locationId)))
        .returning({ id: feeTypes.id });

      if (updated[0] === undefined) {
        return apiFailure('not_found', 'Fee head not found.', 404);
      }

      return apiSuccess({ feeType: await getFeeType(auth.locationId, typeId) });
    } catch (error) {
      return handleApiError(error);
    }
  },
  { allowedRoles: FEE_WRITE_ROLES },
);

export const DELETE = withSchoolAuth(
  () =>
    apiFailure(
      'method_not_allowed',
      'Fee heads are deactivated, not deleted — past challans still reference them. PATCH with isActive: false.',
      405,
    ),
  { allowedRoles: FEE_WRITE_ROLES },
);
