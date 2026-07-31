import { withSchoolAuth } from '@/lib/api-auth';
import { apiSuccess, handleApiError } from '@/lib/api-response';
import { listOutstandingChallans } from '@/lib/fee-queries';
import { maskPhone } from '@/lib/phone';
import { toPaise } from '@/lib/money';
import { FEE_READ_ROLES } from '@/types/school-auth';

/**
 * GET /api/school/fees/reports/defaulters
 *
 * Challans at least `minDaysOverdue` days past due — the chase list.
 *
 * Guardian numbers come back masked. The screen exists to decide *who* to
 * remind, and the reminder endpoint reads the real number server-side, so
 * shipping full numbers to a browser would be handing out a parent contact list
 * for no gain.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const DEFAULT_MIN_DAYS = 30;

export const GET = withSchoolAuth(
  async (request, auth) => {
    try {
      const url = new URL(request.url);

      const raw = Number.parseInt(url.searchParams.get('minDaysOverdue') ?? '', 10);
      const minDaysOverdue =
        Number.isFinite(raw) && raw >= 0 && raw <= 3650 ? raw : DEFAULT_MIN_DAYS;

      const rows = await listOutstandingChallans(auth.locationId, {
        minDaysOverdue,
        gradeId: url.searchParams.get('gradeId') ?? undefined,
        sectionId: url.searchParams.get('sectionId') ?? undefined,
        academicYearId: url.searchParams.get('academicYearId') ?? undefined,
      });

      const totalPaise = rows.reduce((sum, row) => sum + toPaise(row.balance), 0);

      return apiSuccess({
        minDaysOverdue,
        defaulters: rows.map((row) => ({
          ...row,
          guardianPhone: row.guardianPhone === null ? null : maskPhone(row.guardianPhone),
        })),
        totalOutstanding: (totalPaise / 100).toFixed(2),
      });
    } catch (error) {
      return handleApiError(error);
    }
  },
  { allowedRoles: FEE_READ_ROLES },
);
