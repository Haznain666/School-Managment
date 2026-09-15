import { staffKpiRatings } from '@/db/schema';
import { withSchoolAuth } from '@/lib/api-auth';
import { apiFailure, apiSuccess, handleApiError, readJsonBody } from '@/lib/api-response';
import { db } from '@/lib/drizzle';
import { getKpi, kpisFor, listKpis, listYears, loadKpiContext, rateRefusal, yearForMonth } from '@/lib/kpi-access';
import { buildPersonSheet } from '@/lib/kpi-board';
import {
  MAX_RATING_COMMENT_LENGTH,
  isMonthKey,
  monthKeyOf,
  monthStart,
  scoreProblem,
} from '@/lib/kpis';
import { isUuid } from '@/lib/validation';
import { ADMIN_PORTAL_ROLES } from '@/types/school-auth';

/**
 * POST /api/school/kpis/ratings — Sprint 32. Enter or change one rating.
 *
 * ── The resolver runs again here, on the write ───────────────────────────
 * The rating screen only offers people the caller may rate, and that is a
 * courtesy. This route re-reads the teacher's one principal, the coordinator's
 * assigned teachers and rule 7's settings, and refuses anyone else — the way
 * `POST /api/school/timetable/entries` re-resolves a section's period
 * structure. A tab left open across a transfer must not write a rating the new
 * principal never agreed to own.
 *
 * ── A change is a new row ────────────────────────────────────────────────
 * Always `INSERT`. The table refuses `UPDATE` with a trigger, and the latest
 * row per rater is their current answer (`currentRatings`).
 *
 * ── The response is the sheet ────────────────────────────────────────────
 * The whole person sheet comes back, computed by the same `buildPersonSheet`
 * the page uses, so the counting score, the overall and the history move the
 * instant the save lands — on a hard-loaded page, which is the only kind a
 * principal rating a month of staff actually has.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface RatingBody {
  kpiId?: unknown;
  ratedUserId?: unknown;
  month?: unknown;
  score?: unknown;
  comment?: unknown;
}

export const POST = withSchoolAuth(
  async (request, auth) => {
    try {
      const body = await readJsonBody<RatingBody>(request);
      if (body === null) return apiFailure('invalid_body', 'Expected a JSON body.', 400);

      if (!isUuid(body.kpiId) || !isUuid(body.ratedUserId)) {
        return apiFailure('invalid_body', 'Choose a KPI and a person.', 400);
      }
      if (!isMonthKey(body.month)) {
        return apiFailure('invalid_body', 'Choose the month this rating is for.', 400);
      }

      const problem = scoreProblem(body.score);
      if (problem !== null) return apiFailure('invalid_body', problem, 400);
      const score = body.score as number;

      const comment =
        typeof body.comment === 'string' && body.comment.trim() !== '' ? body.comment.trim() : null;
      if (comment !== null && comment.length > MAX_RATING_COMMENT_LENGTH) {
        return apiFailure(
          'invalid_body',
          `Keep the comment to ${String(MAX_RATING_COMMENT_LENGTH)} characters.`,
          400,
        );
      }

      if (body.month > monthKeyOf(new Date())) {
        return apiFailure('invalid_body', 'That month has not started yet, so it cannot be rated.', 400);
      }

      const ctx = await loadKpiContext(auth.locationId, auth);

      const kpi = await getKpi(auth.locationId, body.kpiId);
      if (kpi === null) return apiFailure('not_found', 'That KPI has been deleted.', 404);

      const target = ctx.byId.get(body.ratedUserId);
      if (target === undefined) {
        return apiFailure('not_found', 'That person is not an active member of staff.', 404);
      }

      const refusal = rateRefusal(ctx, target, kpi.targetRole);
      if (refusal !== null) return apiFailure('forbidden', refusal, 403);

      // A campus's own KPI applies to that campus's people only.
      const applies = kpisFor(await listKpis(auth.locationId, null), target).some(
        (row) => row.id === kpi.id,
      );
      if (!applies) {
        return apiFailure('invalid_body', `That KPI does not apply to ${target.name}.`, 400);
      }

      const year = yearForMonth(await listYears(auth.locationId), body.month);
      if (year === null) {
        return apiFailure(
          'invalid_body',
          'That month is not inside any academic year. Add the year under Admissions → Academic Years first.',
          400,
        );
      }

      if (ctx.caller.userId === null) {
        return apiFailure('forbidden', 'Sign in with your own school account to enter a rating.', 403);
      }

      await db.insert(staffKpiRatings).values({
        locationId: auth.locationId,
        kpiId: kpi.id,
        ratedUserId: target.userId,
        academicYearId: year.id,
        periodMonth: kpi.period === 'monthly' ? monthStart(body.month) : null,
        score,
        comment,
        raterUserId: ctx.caller.userId,
        raterRole: ctx.caller.role,
        raterName: ctx.caller.name,
      });

      return apiSuccess({ sheet: await buildPersonSheet(ctx, target, body.month) }, 201);
    } catch (error) {
      return handleApiError(error);
    }
  },
  { allowedRoles: ADMIN_PORTAL_ROLES, module: 'staff_kpis' },
);
