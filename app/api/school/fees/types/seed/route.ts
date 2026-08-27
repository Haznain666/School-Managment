import { DEFAULT_FEE_TYPES } from '@/db/schema';
import { withSchoolAuth } from '@/lib/api-auth';
import { apiSuccess, handleApiError } from '@/lib/api-response';
import { listFeeTypes } from '@/lib/fee-queries';
import { seedDefaultFeeTypes } from '@/lib/school-bootstrap';

/**
 * POST /api/school/fees/types/seed
 *
 * Creates the five heads every Pakistani school bills under, so a school can
 * get to a working price list without inventing a taxonomy first.
 *
 * Idempotent: the unique key is (location_id, name), so re-running it leaves
 * existing heads exactly as they are — including any category or description
 * the school has since edited. The response says how many were actually new.
 *
 * The insert itself lives in `seedDefaultFeeTypes` since Sprint 17, because
 * provisioning now seeds the same five heads the moment a school is created.
 * Two copies of that list would be two taxonomies, and the second one to drift
 * would be the one no school ever clicked this button for.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const POST = withSchoolAuth(
  async (_request, auth) => {
    try {
      const { created } = await seedDefaultFeeTypes(auth.locationId);

      return apiSuccess(
        {
          seeded: created,
          skipped: DEFAULT_FEE_TYPES.length - created,
          feeTypes: await listFeeTypes(auth.locationId),
        },
        201,
      );
    } catch (error) {
      return handleApiError(error);
    }
  },
  { permission: 'fees.write' },
);
