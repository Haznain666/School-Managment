import { withSchoolAuth } from '@/lib/api-auth';
import { apiFailure, apiSuccess, handleApiError } from '@/lib/api-response';
import { resolveLeaveApplicant } from '@/lib/leave-applicant';
import { countLeaveFor } from '@/lib/leave-queries';
import { isIsoDate } from '@/lib/validation';

/**
 * GET /api/school/leave/count?startDate=…&endDate=…[&staffId=…]
 *
 * What a range costs, counted exactly as the write will count it. QA round 1,
 * F5: "Days used" on the self-service form stayed empty under a hint that said
 * it fills in from the dates — the product owner's original A6 complaint, back
 * on the new form. The browser could not fill it honestly on its own: the
 * person's staff calendar and their campus's holiday rule both live on the
 * server, so a count made in the browser would say five where the write stores
 * four.
 *
 * So both leave forms ask here as the dates change. The applicant is resolved
 * by the same function the POST uses — my own record by default, somebody
 * else's only under `leave.manage` at my campus — so this read cannot be used
 * to learn anything about a person the caller could not file for.
 *
 * A read, and it refuses nothing: the single-day holiday refusal comes back as
 * a sentence the form shows *before* the button is pressed, and the POST still
 * refuses it on its own.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = withSchoolAuth(
  async (request, auth) => {
    try {
      const url = new URL(request.url);
      const startDate = url.searchParams.get('startDate');
      const endDate = url.searchParams.get('endDate');

      if (!isIsoDate(startDate) || !isIsoDate(endDate)) {
        return apiFailure('invalid_query', 'Give a start and an end date.', 400);
      }

      const resolved = await resolveLeaveApplicant(auth, url.searchParams.get('staffId'));
      if (!resolved.ok) return apiFailure(resolved.code, resolved.message, resolved.status);

      const counting = await countLeaveFor(auth.locationId, resolved.applicant, startDate, endDate);

      return apiSuccess({
        days: counting.count.days,
        holidayDays: counting.count.holidayDays,
        skipped: counting.count.skipped,
        holidaySpan: counting.holidaySpan,
        holidayProblem: counting.holidayProblem,
        spanProblem: counting.spanProblem,
      });
    } catch (error) {
      return handleApiError(error);
    }
  },
  { permission: 'leave.request' },
);
