import { withSchoolAuth } from '@/lib/api-auth';
import { apiSuccess, handleApiError } from '@/lib/api-response';
import { listOutstandingChallans } from '@/lib/fee-queries';

/**
 * GET /api/school/fees/reports/outstanding
 *
 * Unpaid and partly-paid challans, most overdue first. Filterable by grade,
 * section and billing month — the three questions a bursar actually asks.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function readIntParam(value: string | null): number | undefined {
  if (value === null || value === '') return undefined;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : undefined;
}

export const GET = withSchoolAuth(
  async (request, auth) => {
    try {
      const url = new URL(request.url);

      const rows = await listOutstandingChallans(auth.locationId, {
        gradeId: url.searchParams.get('gradeId') ?? undefined,
        sectionId: url.searchParams.get('sectionId') ?? undefined,
        academicYearId: url.searchParams.get('academicYearId') ?? undefined,
        billingMonth: readIntParam(url.searchParams.get('billingMonth')),
        billingYear: readIntParam(url.searchParams.get('billingYear')),
        limit: readIntParam(url.searchParams.get('limit')),
      });

      return apiSuccess({ outstanding: rows });
    } catch (error) {
      return handleApiError(error);
    }
  },
  { permission: 'fees.read' },
);
