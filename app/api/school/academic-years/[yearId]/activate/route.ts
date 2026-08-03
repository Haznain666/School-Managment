import { and, eq, ne } from 'drizzle-orm';

import { academicYears } from '@/db/schema';
import { withSchoolAuth } from '@/lib/api-auth';
import { apiFailure, apiSuccess, handleApiError } from '@/lib/api-response';
import { getAcademicYear } from '@/lib/admissions-queries';
import { db } from '@/lib/drizzle';
import { isUuid } from '@/lib/validation';

/**
 * POST /api/school/academic-years/[yearId]/activate
 *
 * Makes one year the school's current session. Everything that says "this year"
 * — new enrolments, the dashboard counts, the public application form — reads
 * that flag, so exactly one row may hold it.
 *
 * The promotion runs before the demotion: if the second statement fails the
 * school briefly has two active years, which the queries resolve by taking the
 * first. The other order would leave them with none, which breaks enrolment
 * outright.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type RouteContext = { params: Promise<{ yearId: string }> };

export const POST = withSchoolAuth<RouteContext>(
  async (_request, auth, context) => {
    try {
      const { yearId } = await context.params;
      if (!isUuid(yearId)) {
        return apiFailure('not_found', 'Academic year not found.', 404);
      }

      const existing = await getAcademicYear(auth.locationId, yearId);
      if (existing === null) {
        return apiFailure('not_found', 'Academic year not found.', 404);
      }

      const now = new Date();

      await db
        .update(academicYears)
        .set({ isActive: true, updatedAt: now })
        .where(
          and(
            eq(academicYears.id, yearId),
            eq(academicYears.locationId, auth.locationId),
          ),
        );

      await db
        .update(academicYears)
        .set({ isActive: false, updatedAt: now })
        .where(
          and(
            eq(academicYears.locationId, auth.locationId),
            ne(academicYears.id, yearId),
          ),
        );

      return apiSuccess({ success: true, academicYearId: yearId });
    } catch (error) {
      return handleApiError(error);
    }
  },
  { permission: 'admissions.write' },
);
