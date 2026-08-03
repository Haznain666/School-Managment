import { withSchoolAuth } from '@/lib/api-auth';
import { apiFailure, apiSuccess, handleApiError } from '@/lib/api-response';
import { getSectionAttendanceReport } from '@/lib/academics-queries';
import { isUuid } from '@/lib/validation';

/**
 * /api/school/attendance/reports
 *
 * GET a month of attendance for one section, one row per student.
 *
 * A month is the unit because that is what schools report on and what a parent
 * meeting discusses. The counts are aggregated in Postgres — see
 * `getSectionAttendanceReport` — rather than by pulling a class-month of rows
 * back to count them here.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = withSchoolAuth(
  async (request, auth) => {
    try {
      const url = new URL(request.url);
      const sectionId = url.searchParams.get('sectionId') ?? '';
      const academicYearId = url.searchParams.get('academicYearId') ?? '';
      const month = Number(url.searchParams.get('month'));
      const year = Number(url.searchParams.get('year'));

      if (!isUuid(sectionId) || !isUuid(academicYearId)) {
        return apiFailure('invalid_query', 'Choose a section and an academic year.', 400);
      }
      if (!Number.isInteger(month) || month < 1 || month > 12) {
        return apiFailure('invalid_query', 'Choose a month between 1 and 12.', 400);
      }
      if (!Number.isInteger(year) || year < 2000 || year > 2100) {
        return apiFailure('invalid_query', 'Choose a year between 2000 and 2100.', 400);
      }

      const students = await getSectionAttendanceReport(auth.locationId, {
        sectionId,
        academicYearId,
        month,
        year,
      });

      // The class average weights every student equally, which is what a head
      // teacher means by "how is 5B doing" — not the share of all marks taken.
      const classAverage =
        students.length === 0
          ? 0
          : Math.round(
              (students.reduce((sum, row) => sum + row.percentage, 0) /
                students.length) *
                10,
            ) / 10;

      return apiSuccess({ students, classAverage, month, year });
    } catch (error) {
      return handleApiError(error);
    }
  },
  { permission: 'academics.read' },
);
