import { apiFailure, apiSuccess, handleApiError } from '@/lib/api-response';
import { withSchoolAuth } from '@/lib/api-auth';
import { applyPromotionRun, getPromotionRun } from '@/lib/promotion-queries';
import { isUuid } from '@/lib/validation';

/**
 * POST /api/school/promotions/[runId]/apply — move the class up.
 *
 * ── All-or-nothing, unlike the import, and that is deliberate ────────────
 * A bulk import's rows are independent students from a file the operator can
 * correct and re-run, so one bad row must not stop the other 399. A promotion
 * is a single decision about one class: half a promoted grade is a school where
 * some children are in next year and some are not, and no screen in this
 * application would show you which. So everything that could refuse is checked
 * *before* the transaction opens, and if anything would refuse, nothing is
 * written at all.
 *
 * The refusals come back named, because "3 students could not be promoted" is
 * not something an operator can act on.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type RouteContext = { params: Promise<{ runId: string }> };

export const POST = withSchoolAuth<RouteContext>(
  async (_request, auth, context) => {
    try {
      const { runId } = await context.params;
      if (!isUuid(runId)) return apiFailure('not_found', 'Promotion not found.', 404);

      const run = await getPromotionRun(auth.locationId, runId);
      if (run === null) return apiFailure('not_found', 'Promotion not found.', 404);

      if (run.status === 'applied') {
        return apiFailure(
          'conflict',
          'This promotion has already been carried out — nobody was moved twice.',
          409,
        );
      }

      const result = await applyPromotionRun(run, auth.uid);

      /*
       * A cross-campus destination is not a promotion — Sprint 19b, item 15c.
       *
       * **422, not 409**, and the difference is the whole point. A 409 says
       * "these rows clash, fix them and re-run", which is what the refusals
       * below mean. This says "what you have described is a different
       * operation": moving a child between campuses is a *transfer*, with its
       * own screen, its own fee split and its own row in `student_transfers`.
       * Carrying it out here would move the child and leave nothing anywhere
       * recording that it happened.
       *
       * Both campuses are named because "cross-campus move" tells an operator
       * looking at forty rows nothing about which one they got wrong.
       */
      if (result.crossCampus.length > 0) {
        return apiFailure(
          'cross_campus_promotion',
          `Nothing was changed. A promotion stays inside one campus; moving a student between campuses is a transfer, which keeps its own record and splits the fees. ` +
            result.crossCampus
              .map((entry) => `${entry.name} — ${entry.from} → ${entry.to}`)
              .join('; '),
          422,
        );
      }

      if (result.refused.length > 0) {
        return apiFailure(
          'conflict',
          `Nothing was changed. ${result.refused.length} student${result.refused.length === 1 ? '' : 's'} could not be moved: ` +
            result.refused
              .map((entry) => `${entry.name} — ${entry.reason}`)
              .join('; '),
          409,
        );
      }

      return apiSuccess({ result });
    } catch (error) {
      return handleApiError(error);
    }
  },
  { permission: 'students.promote' },
);
