import { withSchoolAuth } from '@/lib/api-auth';
import { apiFailure, apiSuccess, handleApiError, readJsonBody } from '@/lib/api-response';
import { copySectionsIntoYear, getAcademicYear } from '@/lib/admissions-queries';
import { effectiveBranchIds, resolveBranchScope } from '@/lib/branch-scope';
import { isUuid, readString } from '@/lib/validation';

/**
 * POST /api/school/sections/copy — build next year's classes from this year's.
 *
 * Sprint 19b, item 15b. The promotion screen's *Goes to* column reads sections
 * of the receiving year, and a school that has not created them yet sees an
 * empty dropdown with nothing to explain it. This is the button beside that
 * explanation, and it is the task the operator had actually sat down to do.
 *
 * ── Both years are re-read from the tenant ──────────────────────────────
 * Not because a foreign key would let a stranger's year through — it would not
 * — but because a *deleted* year would come back as a foreign key violation
 * caught by `handleApiError` and reported as a 500. Reading them first turns
 * that into a sentence.
 *
 * ── Scoped, and it refuses rather than silently narrowing ───────────────
 * The clone writes into `grades` the caller may reach, resolved through
 * `resolveBranchScope` rather than `claims.branchId`. Somebody holding two
 * campuses copies both unless `?branch=` says otherwise, which is the same rule
 * every listing in the product follows since 19a.
 *
 * The two years are deliberately *not* required to be adjacent, or even in
 * order. A school setting up 2028-29 in advance is doing something reasonable,
 * and a rule about order here would be a rule this route cannot justify.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface CopySectionsBody {
  fromAcademicYearId?: unknown;
  toAcademicYearId?: unknown;
  /** Which campus to copy, when the caller can reach several. */
  branchId?: unknown;
}

export const POST = withSchoolAuth(
  async (request, auth) => {
    try {
      const body = await readJsonBody<CopySectionsBody>(request);
      if (body === null) {
        return apiFailure('invalid_body', 'Expected a JSON body.', 400);
      }

      const fromAcademicYearId = readString(body.fromAcademicYearId);
      const toAcademicYearId = readString(body.toAcademicYearId);

      if (!isUuid(fromAcademicYearId) || !isUuid(toAcademicYearId)) {
        return apiFailure('invalid_body', 'Choose the year to copy from and the year to copy into.', 400);
      }
      if (fromAcademicYearId === toAcademicYearId) {
        return apiFailure(
          'invalid_body',
          'A year cannot be copied into itself — its sections are already there.',
          400,
        );
      }

      const [from, to] = await Promise.all([
        getAcademicYear(auth.locationId, fromAcademicYearId),
        getAcademicYear(auth.locationId, toAcademicYearId),
      ]);

      if (from === null || to === null) {
        return apiFailure('not_found', 'That academic year no longer exists.', 404);
      }

      const requested = readString(body.branchId);
      const scope = await resolveBranchScope(
        auth.locationId,
        auth,
        requested === '' ? null : requested,
      );

      const result = await copySectionsIntoYear(auth.locationId, {
        fromAcademicYearId,
        toAcademicYearId,
        branchIds: effectiveBranchIds(scope),
      });

      if (result.created === 0 && result.skipped === 0) {
        return apiFailure(
          'nothing_to_copy',
          `${from.name} has no active sections to copy. Create the classes on Grades & sections first.`,
          409,
        );
      }

      return apiSuccess({ ...result, fromName: from.name, toName: to.name }, 201);
    } catch (error) {
      return handleApiError(error);
    }
  },
  { permission: 'admissions.write' },
);
