import { withSchoolAuth } from '@/lib/api-auth';
import { apiFailure, apiSuccess, handleApiError } from '@/lib/api-response';
import { getCollectionSummary } from '@/lib/fee-queries';
import { toPaise } from '@/lib/money';
import { FEE_READ_ROLES } from '@/types/school-auth';

/**
 * GET /api/school/fees/reports/collection
 *
 * Money received per calendar month across a date range.
 *
 * Grouped by *payment* date, not billing month: this answers "what did we take
 * in March", which properly includes a March payment against a January challan.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function isDateOnly(value: string | null): value is string {
  if (value === null || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;

  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

/** The first day of the month `monthsBack` months before today. */
function monthsAgo(monthsBack: number): string {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth() - monthsBack, 1);
  return `${start.getFullYear()}-${String(start.getMonth() + 1).padStart(2, '0')}-01`;
}

export const GET = withSchoolAuth(
  async (request, auth) => {
    try {
      const url = new URL(request.url);

      const fromRaw = url.searchParams.get('fromDate');
      const toRaw = url.searchParams.get('toDate');

      // Defaults to the last twelve months, which is what the screen opens on.
      const fromDate = isDateOnly(fromRaw) ? fromRaw : monthsAgo(11);
      const toDate = isDateOnly(toRaw) ? toRaw : new Date().toISOString().slice(0, 10);

      if (fromDate > toDate) {
        return apiFailure('invalid_query', 'The start date must be before the end date.', 400);
      }

      const months = await getCollectionSummary(auth.locationId, fromDate, toDate);
      const totalPaise = months.reduce((sum, row) => sum + toPaise(row.collected), 0);

      return apiSuccess({
        fromDate,
        toDate,
        months,
        total: (totalPaise / 100).toFixed(2),
        paymentCount: months.reduce((sum, row) => sum + row.paymentCount, 0),
      });
    } catch (error) {
      return handleApiError(error);
    }
  },
  { allowedRoles: FEE_READ_ROLES },
);
