import { withSchoolAuth } from '@/lib/api-auth';
import { apiFailure, apiSuccess, handleApiError } from '@/lib/api-response';
import { listTeacherBusySlots } from '@/lib/academics-queries';
import { isUuid } from '@/lib/validation';

/**
 * /api/school/timetable/teacher-busy — where one teacher already is.
 *
 * ── Why the builder needs a second read ──────────────────────────────────
 * `GET /api/school/timetable/entries` answers for one **section**, which is
 * exactly the wrong scope for the question this sprint's defect is about: the
 * overlap that put a teacher in two rooms at once was between two *different*
 * sections on two *different* bell schedules, and neither grid could see the
 * other.
 *
 * So the clash test the route runs on the write is given to the builder as
 * data, keyed on the teacher rather than the class. It is read when a cell is
 * opened and re-read when the teacher in the dialog changes, which is the only
 * moment its answer can change.
 *
 * **This is a courtesy, not the rule.** `POST /api/school/timetable/entries`
 * re-runs the same `slotsOverlap` against the live rows, so a stale tab cannot
 * write an overlap by holding an old answer — the same posture the structure
 * check beside it takes.
 *
 * `academics.read`: it discloses where a colleague is teaching, which is what
 * every timetable screen in the product already shows.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = withSchoolAuth(
  async (request, auth) => {
    try {
      const url = new URL(request.url);
      const teacherId = url.searchParams.get('teacherId') ?? '';
      const academicYearId = url.searchParams.get('academicYearId') ?? '';

      if (!isUuid(teacherId) || !isUuid(academicYearId)) {
        return apiFailure('invalid_query', 'Choose a teacher and an academic year.', 400);
      }

      // Tenant from the verified session; the two ids narrow it and never widen
      // it, so a teacher id from another school resolves to nothing.
      return apiSuccess({
        busy: await listTeacherBusySlots(auth.locationId, teacherId, academicYearId),
      });
    } catch (error) {
      return handleApiError(error);
    }
  },
  { permission: 'academics.read' },
);
