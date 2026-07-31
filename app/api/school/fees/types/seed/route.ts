import { feeTypes } from '@/db/schema';
import { withSchoolAuth } from '@/lib/api-auth';
import { apiSuccess, handleApiError } from '@/lib/api-response';
import { db } from '@/lib/drizzle';
import { DEFAULT_FEE_TYPES } from '@/lib/fee-defaults';
import { listFeeTypes } from '@/lib/fee-queries';
import { FEE_WRITE_ROLES } from '@/lib/fee-roles';

/**
 * POST /api/school/fees/types/seed
 *
 * Creates the five fee heads most Pakistani schools start with, so a school
 * setting up does not have to type them before it can bill anything.
 *
 * Idempotent: the unique key is (location_id, name), so a head the school has
 * already created — or already renamed away from — is left exactly as it is
 * rather than duplicated or overwritten. Safe to press twice.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const POST = withSchoolAuth(
  async (_request, auth) => {
    try {
      const inserted = await db
        .insert(feeTypes)
        .values(
          DEFAULT_FEE_TYPES.map((seed) => ({
            locationId: auth.locationId,
            name: seed.name,
            description: seed.description,
            feeCategory: seed.feeCategory,
            sortOrder: seed.sortOrder,
          })),
        )
        .onConflictDoNothing({ target: [feeTypes.locationId, feeTypes.name] })
        .returning({ id: feeTypes.id });

      return apiSuccess({
        seeded: inserted.length,
        total: DEFAULT_FEE_TYPES.length,
        feeTypes: await listFeeTypes(auth.locationId),
      });
    } catch (error) {
      return handleApiError(error);
    }
  },
  { allowedRoles: FEE_WRITE_ROLES },
);
