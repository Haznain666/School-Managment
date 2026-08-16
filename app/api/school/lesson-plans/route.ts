import { isLessonPlanStatus, MAX_LESSON_PLAN_BODY, MAX_LESSON_PLAN_TITLE } from '@/db/schema';
import { teacherTeachesSection } from '@/lib/academics-queries';
import { withSchoolAuth } from '@/lib/api-auth';
import { apiFailure, apiSuccess, handleApiError, readJsonBody } from '@/lib/api-response';
import { getActiveAcademicYear } from '@/lib/admissions-queries';
import {
  isMonday,
  listOwnPlans,
  listSharedPlans,
  savePlan,
  weekStartingOf,
} from '@/lib/lesson-plan-queries';
import { getSchoolUserByUid } from '@/lib/school-queries';
import { isIsoDate, isUuid, readOptionalString, readString } from '@/lib/validation';
import { USER_ROLES } from '@/types/school-auth';

/**
 * /api/school/lesson-plans
 *
 * GET  my plans — or, with `?scope=school`, every shared plan at the school
 * POST create or correct one of my own
 *
 * ── Why `allowedRoles` and not a permission ──────────────────────────────
 * A teacher writing their own weekly plan is not an administrative act, and a
 * new permission key would be a toggle no school has a reason to move. What
 * gates this instead is ownership: every write carries the teacher id derived
 * from the verified session, so there is no id in the request that could name
 * somebody else.
 *
 * `?scope=school` is the one read that crosses teachers, and it requires
 * `academics.read` — "see subjects, the timetable and the register", which is
 * exactly the sentence that should also cover "see the plans that go with
 * them". Teachers hold it, so a teacher can also read a colleague's *shared*
 * plan, which is what sharing means.
 *
 * ── The section is checked against the timetable ─────────────────────────
 * A teacher may only file a plan for a section they are timetabled into, using
 * `teacherTeachesSection` — the same predicate the attendance route uses. One
 * rule, one implementation, so the two cannot disagree about whose class it is.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** The window a list covers when the caller names none: this week ± 8 weeks. */
function defaultWindow(): { from: string; to: string } {
  const monday = weekStartingOf(new Date().toISOString().slice(0, 10));
  const shift = (weeks: number): string => {
    const at = new Date(`${monday}T00:00:00Z`);
    at.setUTCDate(at.getUTCDate() + weeks * 7);
    return at.toISOString().slice(0, 10);
  };
  return { from: shift(-8), to: shift(8) };
}

export const GET = withSchoolAuth(
  async (request, auth) => {
    try {
      const url = new URL(request.url);
      const fallback = defaultWindow();
      const from = url.searchParams.get('from');
      const to = url.searchParams.get('to');

      const window = {
        from: isIsoDate(from) ? from : fallback.from,
        to: isIsoDate(to) ? to : fallback.to,
      };

      if (url.searchParams.get('scope') === 'school') {
        // The one read that crosses teachers. Shared rows only — see
        // `listSharedPlans`, which takes no teacher parameter at all.
        const sectionId = url.searchParams.get('sectionId');
        return apiSuccess({
          plans: await listSharedPlans(auth.locationId, window, {
            sectionId: isUuid(sectionId) ? sectionId : undefined,
          }),
        });
      }

      const me = await getSchoolUserByUid(auth.locationId, auth.uid);
      if (me === null) {
        return apiFailure('not_found', 'No account at this school.', 404);
      }

      return apiSuccess({ plans: await listOwnPlans(auth.locationId, me.id, window) });
    } catch (error) {
      return handleApiError(error);
    }
  },
  { permission: 'academics.read' },
);

interface PlanBody {
  sectionId?: unknown;
  subjectId?: unknown;
  weekStarting?: unknown;
  title?: unknown;
  body?: unknown;
  homework?: unknown;
  status?: unknown;
}

export const POST = withSchoolAuth(
  async (request, auth) => {
    try {
      const body = await readJsonBody<PlanBody>(request);
      if (body === null) return apiFailure('invalid_body', 'Expected a JSON body.', 400);

      if (!isUuid(body.sectionId) || !isUuid(body.subjectId)) {
        return apiFailure('invalid_body', 'Choose a class and a subject.', 400);
      }
      if (!isIsoDate(body.weekStarting) || !isMonday(body.weekStarting)) {
        return apiFailure(
          'invalid_body',
          'A plan covers a week, so its date must be a Monday.',
          400,
        );
      }

      const title = readString(body.title);
      if (title === '' || title.length > MAX_LESSON_PLAN_TITLE) {
        return apiFailure(
          'invalid_body',
          `Give the week a title of ${MAX_LESSON_PLAN_TITLE} characters or fewer.`,
          400,
        );
      }

      const text = readString(body.body);
      if (text.length > MAX_LESSON_PLAN_BODY) {
        return apiFailure(
          'invalid_body',
          `A plan is at most ${MAX_LESSON_PLAN_BODY} characters.`,
          400,
        );
      }

      const status = isLessonPlanStatus(body.status) ? body.status : 'draft';

      const me = await getSchoolUserByUid(auth.locationId, auth.uid);
      if (me === null) {
        return apiFailure('not_found', 'No account at this school.', 404);
      }

      const activeYear = await getActiveAcademicYear(auth.locationId);
      if (activeYear === null) {
        return apiFailure(
          'no_active_year',
          'Your school has not opened an academic year yet.',
          409,
        );
      }

      // Administrators are not narrowed — a coordinator keying a plan in for a
      // teacher who is away is the same exception the attendance route makes.
      if (
        auth.role === 'teacher' &&
        !(await teacherTeachesSection(
          auth.locationId,
          me.id,
          body.sectionId,
          activeYear.id,
        ))
      ) {
        return apiFailure('forbidden', 'You do not teach that class.', 403);
      }

      const id = await savePlan(auth.locationId, me.id, {
        sectionId: body.sectionId,
        subjectId: body.subjectId,
        weekStarting: body.weekStarting,
        title,
        body: text,
        homework: readOptionalString(body.homework),
        status,
      });

      return apiSuccess({ id }, 201);
    } catch (error) {
      return handleApiError(error);
    }
  },
  { allowedRoles: USER_ROLES.filter((role) => role !== 'student' && role !== 'parent') },
);
