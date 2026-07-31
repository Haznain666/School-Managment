import { withSchoolAuth } from '@/lib/api-auth';
import { apiSuccess, handleApiError } from '@/lib/api-response';
import { listOutstanding } from '@/lib/fee-queries';
import { FEE_READ_ROLES } from '@/lib/fee-roles';

/**
 * GET /api/school/fees/reports/outstanding
 *
 * Unpaid and partly-paid challans, worst overdue first — the list a school
 * works down when chasing money.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function readMonth(value: string | null): number | undefined {
  if (value === null || value === '') return undefined;
  const parsed = Number.parseInt(value, 10);
  return Number.isInteger(parsed) && parsed >= 1 && parsed <= 12 ? parsed : undefined;
}

function readYear(value: string | null): number | undefined {
  if (value === null || value === '') return undefined;
  const parsed = Number.parseInt(value, 10);
  return Number.isInteger(parsed) && parsed >= 2000 && parsed <= 2100 ? parsed : undefined;
}

export const GET = withSchoolAuth(
  async (request, auth) => {
    try {
      const url = new URL(request.url);

      const rows = await listOutstanding(auth.locationId, {
        gradeId: url.searchParams.get('gradeId') ?? undefined,
        sectionId: url.searchParams.get('sectionId') ?? undefined,
        academicYearId: url.searchParams.get('academicYearId') ?? undefined,
        billingMonth: readMonth(url.searchParams.get('billingMonth')),
        billingYear: readYear(url.searchParams.get('billingYear')),
      });

      const totalOutstandingPaise = rows.reduce(
        (total, row) => total + row.balancePaise,
        0,
      );

      return apiSuccess({ rows, totalOutstandingPaise, count: rows.length });
    } catch (error) {
      return handleApiError(error);
    }
  },
  { allowedRoles: FEE_READ_ROLES },
);
