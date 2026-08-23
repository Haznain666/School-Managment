import { withSchoolAuth } from '@/lib/api-auth';
import { apiSuccess, handleApiError } from '@/lib/api-response';
import {
  APPLICATION_SORT_COLUMNS,
  countApplications,
  listApplications,
} from '@/lib/admissions-queries';
import { readListQuery } from '@/lib/list-query';

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

      const list = readListQuery(url.searchParams, {
        sortable: APPLICATION_SORT_COLUMNS,
        defaultSort: 'submittedAt',
        defaultDirection: 'desc',
      });

      const filters = {
        status: url.searchParams.get('status') ?? undefined,
        branchId: branchId ?? undefined,
        academicYearId: url.searchParams.get('academicYearId') ?? undefined,
        search: url.searchParams.get('search') ?? undefined,
      };

      const [applications, total] = await Promise.all([
        listApplications(auth.locationId, {
          ...filters,
          limit: list.limit,
          offset: list.offset,
          sort: list.sort,
          direction: list.direction,
        }),
        countApplications(auth.locationId, filters),
      ]);

      return apiSuccess({ applications, total, page: list.page, limit: list.limit });
    } catch (error) {
      return handleApiError(error);
    }
  },
  { permission: 'admissions.read' },
);
