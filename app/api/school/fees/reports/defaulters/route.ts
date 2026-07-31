import { withSchoolAuth } from '@/lib/api-auth';
import { apiSuccess, handleApiError } from '@/lib/api-response';
import { listDefaulters } from '@/lib/fee-queries';
import { FEE_READ_ROLES } from '@/lib/fee-roles';

/**
 * GET /api/school/fees/reports/defaulters
 *
 * Students whose challans are more than `minDaysOverdue` past due, with the
 * guardian's number attached so the school can act on the list rather than
 * just read it.
 *
 * The threshold defaults to 30 days: below that a family is usually just late,
 * and treating them as a defaulter is how a school loses one.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const DEFAULT_MIN_DAYS_OVERDUE = 30;

export const GET = withSchoolAuth(
  async (request, auth) => {
    try {
      const url = new URL(request.url);

      const raw = Number.parseInt(
        url.searchParams.get('minDaysOverdue') ?? String(DEFAULT_MIN_DAYS_OVERDUE),
        10,
      );
      const minDaysOverdue =
        Number.isInteger(raw) && raw >= 0 && raw <= 3650
          ? raw
          : DEFAULT_MIN_DAYS_OVERDUE;

      const rows = await listDefaulters(auth.locationId, minDaysOverdue);

      return apiSuccess({
        rows,
        minDaysOverdue,
        count: rows.length,
        totalOverduePaise: rows.reduce((total, row) => total + row.balancePaise, 0),
      });
    } catch (error) {
      return handleApiError(error);
    }
  },
  { allowedRoles: FEE_READ_ROLES },
);
