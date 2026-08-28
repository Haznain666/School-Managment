import { withSchoolAuth } from '@/lib/api-auth';
import { apiFailure, apiSuccess, handleApiError, readJsonBody } from '@/lib/api-response';
import { applySchemeToStudents, ConcessionSchemeError } from '@/lib/concession-schemes';
import { isUuid } from '@/lib/validation';

/**
 * POST /api/school/fees/concession-schemes/[schemeId]/apply
 *
 * Grants one scheme to many students, and re-prices what they still owe.
 *
 * ── Why a cap, and why this one ──────────────────────────────────────────
 * Each student granted costs one transaction plus one `repriceOpenChallans`,
 * which itself walks their open vouchers. Two hundred is a whole grade's worth
 * of siblings and comfortably inside a request; a school applying a discount to
 * its entire roll is doing something else and should be doing it a grade at a
 * time, where they can read what happened.
 *
 * ── Skipping is the expected path, not the error path ────────────────────
 * The natural way to use the picker is to run it again after admitting three
 * more children, so an overlapping selection is normal. Students who already
 * hold this scheme are left alone and counted, and the response says so —
 * "granted to 3, 14 already had it" rather than implying seventeen new
 * discounts stacking on the old ones.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type RouteContext = { params: Promise<{ schemeId: string }> };

/** Students per request. See the docblock. */
const MAX_STUDENTS = 200;

export const POST = withSchoolAuth<RouteContext>(
  async (request, auth, context) => {
    try {
      const { schemeId } = await context.params;
      if (!isUuid(schemeId)) return apiFailure('not_found', 'Scheme not found.', 404);

      const body = await readJsonBody<{ studentProfileIds?: unknown }>(request);
      if (body === null) {
        return apiFailure('invalid_body', 'Expected a JSON body.', 400);
      }

      const studentProfileIds = Array.isArray(body.studentProfileIds)
        ? [...new Set(body.studentProfileIds.filter(isUuid))]
        : [];

      if (studentProfileIds.length === 0) {
        return apiFailure('invalid_body', 'Choose at least one student.', 400);
      }

      if (studentProfileIds.length > MAX_STUDENTS) {
        return apiFailure(
          'too_many',
          `Apply a scheme to at most ${MAX_STUDENTS} students at a time.`,
          400,
        );
      }

      const result = await applySchemeToStudents({
        locationId: auth.locationId,
        schemeId,
        studentProfileIds,
        actorUid: auth.uid,
      });

      return apiSuccess(result, 201);
    } catch (error) {
      if (error instanceof ConcessionSchemeError) {
        return apiFailure(error.code, error.message, error.status);
      }
      return handleApiError(error);
    }
  },
  { permission: 'fees.write' },
);
