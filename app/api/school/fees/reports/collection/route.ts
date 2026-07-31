import { withSchoolAuth } from '@/lib/api-auth';
import { apiSuccess, handleApiError } from '@/lib/api-response';
import { getCollectionSummary } from '@/lib/fee-queries';
import { FEE_READ_ROLES } from '@/lib/fee-roles';

/**
 * GET /api/school/fees/reports/collection
 *
 * Billed against collected, by billing month.
 *
 * "Collected" means money recorded against challans *for that month*, not
 * money received during it — a family settling June's bill in August belongs
 * to June's collection rate, which is the number a school judges a month by.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = withSchoolAuth(
  async (request, auth) => {
    try {
      const url = new URL(request.url);

      const periods = await getCollectionSummary(auth.locationId, {
        academicYearId: url.searchParams.get('academicYearId') ?? undefined,
      });

      const totalBilledPaise = periods.reduce(
        (total, period) => total + period.billedPaise,
        0,
      );
      const totalCollectedPaise = periods.reduce(
        (total, period) => total + period.collectedPaise,
        0,
      );

      return apiSuccess({
        periods,
        totalBilledPaise,
        totalCollectedPaise,
        totalOutstandingPaise: Math.max(totalBilledPaise - totalCollectedPaise, 0),
        overallRate:
          totalBilledPaise === 0
            ? 0
            : Math.round((totalCollectedPaise / totalBilledPaise) * 1000) / 10,
      });
    } catch (error) {
      return handleApiError(error);
    }
  },
  { allowedRoles: FEE_READ_ROLES },
);
