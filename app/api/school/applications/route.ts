import { withSchoolAuth } from '@/lib/api-auth';
import { apiSuccess, handleApiError } from '@/lib/api-response';
import { listApplications } from '@/lib/admissions-queries';

/**
 * GET /api/school/applications — the admissions inbox.
 *
 * Read-only from inside the school. Applications are written by the public
 * endpoint at `/api/admissions/apply`, which is the only unauthenticated way
 * into this table; an admin creating a prospective student directly should be
 * enrolling them, not filing an application on their behalf.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = withSchoolAuth(
  async (request, auth) => {
    try {
      const url = new URL(request.url);

      // A branch-scoped admin only sees applications naming their branch.
      const branchId = auth.branchId ?? (url.searchParams.get('branchId') ?? undefined);

      const limitRaw = Number.parseInt(url.searchParams.get('limit') ?? '100', 10);

      const applications = await listApplications(auth.locationId, {
        status: url.searchParams.get('status') ?? undefined,
        branchId: branchId ?? undefined,
        academicYearId: url.searchParams.get('academicYearId') ?? undefined,
        search: url.searchParams.get('search') ?? undefined,
        limit: Number.isFinite(limitRaw) ? limitRaw : 100,
      });

      return apiSuccess({ applications });
    } catch (error) {
      return handleApiError(error);
    }
  },
  { allowedRoles: ['school_admin', 'branch_admin', 'hr_manager'] },
);
