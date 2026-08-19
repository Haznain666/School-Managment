import { withSchoolAuth } from '@/lib/api-auth';
import { apiFailure, apiSuccess, handleApiError } from '@/lib/api-response';
import { getActiveAcademicYear } from '@/lib/admissions-queries';
import {
  getTeacherCalendar,
  isCalendarView,
  isDateOnly,
  rangeFor,
} from '@/lib/teacher-calendar';
import { hasPermission } from '@/lib/permission-queries';
import { getSchoolUserByUid } from '@/lib/school-queries';
import { isUuid } from '@/lib/validation';

/**
 * GET /api/school/teachers/[teacherId]/calendar?view=week&date=2026-08-20
 *
 * One teacher's diary for a day, a week or a month.
 *
 * ── Why this is an API route and not a server page ───────────────────────
 * A calendar is *paged through*. Nobody opens one and stops; they step forward
 * a week, back a week, switch to the month. Each of those as a server
 * navigation costs the ~1s edge-to-origin hop STATE.md §5aq measured, and the
 * whole page re-renders to change one grid. Fetched here, a step is one request
 * for one payload and the surrounding page never moves.
 *
 * The year is the school's active one and is not a parameter. A calendar is a
 * question about now; a historical year would need a year selector, a different
 * empty state and an answer to "what does 'today' mean in a year that ended",
 * and none of that is what somebody asking "is Sumera free on Thursday?" wants.
 *
 * ── Who may see what ─────────────────────────────────────────────────────
 * `academics.read` gates the route, which is the same permission the timetable
 * routes already carry — and they already return every teacher's name against
 * every period, so a colleague's *lessons* are not a disclosure. Teachers hold
 * it, so a teacher can open a colleague's grid, exactly as they can today.
 *
 * Their **leave** is not covered by that argument. It is an HR record, so it is
 * returned only to somebody holding `hr.read`, or to the teacher looking at
 * their own calendar. That check is here rather than in the query, because it
 * is a question about the caller.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type RouteContext = { params: Promise<{ teacherId: string }> };

export const GET = withSchoolAuth<RouteContext>(
  async (request, auth, context) => {
    try {
      const { teacherId } = await context.params;
      if (!isUuid(teacherId)) {
        return apiFailure('not_found', 'That teacher is not at this school.', 404);
      }

      const url = new URL(request.url);
      const viewParam = url.searchParams.get('view');
      const dateParam = url.searchParams.get('date');

      const view = isCalendarView(viewParam) ? viewParam : 'week';

      // An unparseable date falls back to today rather than 400ing. The only
      // way to send one is to hand-edit the query string, and a calendar that
      // errors instead of showing this week is worse than one that ignores it.
      const date = isDateOnly(dateParam)
        ? dateParam
        : new Date().toISOString().slice(0, 10);

      const activeYear = await getActiveAcademicYear(auth.locationId);
      if (activeYear === null) {
        // Not an error. A school between academic years is correctly
        // configured, and the screen needs an empty calendar to say so with.
        return apiSuccess({
          view,
          date,
          range: rangeFor(view, date),
          calendar: null,
          reason: 'This school has no active academic year, so there is no timetable to lay out.',
        });
      }

      const [self, mayReadLeave] = await Promise.all([
        getSchoolUserByUid(auth.locationId, auth.uid),
        hasPermission(auth.locationId, auth.role, 'hr.read'),
      ]);

      const range = rangeFor(view, date);
      const calendar = await getTeacherCalendar(
        auth.locationId,
        teacherId,
        activeYear.id,
        range,
        { includeLeave: mayReadLeave || self?.id === teacherId },
      );

      if (calendar === null) {
        return apiFailure('not_found', 'That teacher is not at this school.', 404);
      }

      return apiSuccess({
        view,
        date,
        range,
        calendar,
        academicYearName: activeYear.name,
        reason: null,
      });
    } catch (error) {
      return handleApiError(error);
    }
  },
  { permission: 'academics.read' },
);
