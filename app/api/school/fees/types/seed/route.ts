import { DEFAULT_FEE_TYPES, feeTypes } from '@/db/schema';
import { withSchoolAuth } from '@/lib/api-auth';
import { apiSuccess, handleApiError } from '@/lib/api-response';
import { db } from '@/lib/drizzle';
import { listFeeTypes } from '@/lib/fee-queries';
import { FEE_WRITE_ROLES } from '@/types/school-auth';

/**
 * POST /api/school/fees/types/seed
 *
 * Creates the five heads every Pakistani school bills under, so a school can
 * get to a working price list without inventing a taxonomy first.
 *
 * Idempotent: the unique key is (location_id, name), so re-running it leaves
 * existing heads exactly as they are — including any category or description
 * the school has since edited. The response says how many were actually new.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const POST = withSchoolAuth(
  async (_request, auth) => {
    try {
      const inserted = await db
        .insert(feeTypes)
        .values(
          DEFAULT_FEE_TYPES.map((entry) => ({
            locationId: auth.locationId,
            name: entry.name,
            description: entry.description,
            feeCategory: entry.feeCategory,
            sortOrder: entry.sortOrder,
          })),
        )
        .onConflictDoNothing({ target: [feeTypes.locationId, feeTypes.name] })
        .returning({ id: feeTypes.id });

      return apiSuccess(
        {
          seeded: inserted.length,
          skipped: DEFAULT_FEE_TYPES.length - inserted.length,
          feeTypes: await listFeeTypes(auth.locationId),
        },
        201,
      );
    } catch (error) {
      return handleApiError(error);
    }
  },
  { allowedRoles: FEE_WRITE_ROLES },
);
