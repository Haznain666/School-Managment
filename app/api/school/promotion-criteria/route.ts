import { and, eq, sql } from 'drizzle-orm';

import { gradePromotionCriteria } from '@/db/schema';
import { isPromotionMechanism } from '@/db/schema/grade-promotion-criteria';
import { withSchoolAuth } from '@/lib/api-auth';
import { apiFailure, apiSuccess, handleApiError, readJsonBody } from '@/lib/api-response';
import { getAcademicYear } from '@/lib/admissions-queries';
import { db } from '@/lib/drizzle';
import {
  getGradingScheme,
  listGradeCriteria,
  listResultSubcategories,
} from '@/lib/exam-queries';
import { criteriaProblem, type CriteriaRow } from '@/lib/promotion-criteria';
import { isUuid } from '@/lib/validation';

/**
 * /api/school/promotion-criteria
 *
 * GET the year's grades with the criteria each is judged by
 * PUT upsert one grade's row
 *
 * ── PUT and not PATCH, for once ──────────────────────────────────────────
 * This codebase uses PATCH everywhere because a partial update of a record is
 * the ordinary case. A criteria row is not a record a school edits a field of;
 * it is one screen's worth of mutually dependent answers — the mechanism
 * decides which of the other fields mean anything, and a PATCH that set
 * `maxFailingSubjects` while leaving a stale `minOverallPercentage` behind
 * would produce a row nobody typed. The whole row is sent, or none of it.
 *
 * A grade with no row is not misconfigured. It falls back to `DEFAULT_CRITERIA`
 * — marks and grades with no thresholds — which is exactly how the product
 * behaved before this table existed, so a school that never opens the criteria
 * screen sees no change at all.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = withSchoolAuth(
  async (request, auth) => {
    try {
      const academicYearId = new URL(request.url).searchParams.get('academicYearId') ?? '';
      if (!isUuid(academicYearId)) {
        return apiFailure('invalid_query', 'Choose an academic year.', 400);
      }

      const year = await getAcademicYear(auth.locationId, academicYearId);
      if (year === null) {
        return apiFailure('not_found', 'That academic year was not found.', 404);
      }

      const [criteria, subcategories] = await Promise.all([
        listGradeCriteria(auth.locationId, academicYearId),
        listResultSubcategories(auth.locationId),
      ]);

      return apiSuccess({ criteria, subcategories });
    } catch (error) {
      return handleApiError(error);
    }
  },
  { permission: 'exams.read' },
);

interface UpsertBody {
  academicYearId?: unknown;
  gradeId?: unknown;
  mechanism?: unknown;
  gradingSchemeId?: unknown;
  minOverallPercentage?: unknown;
  maxFailedSubjects?: unknown;
  failingSubcategoryId?: unknown;
  maxFailingSubjects?: unknown;
  minAttendancePercentage?: unknown;
}

/** A number, or null for blank. `false` when the value is neither. */
function readOptionalNumber(value: unknown): number | null | false {
  if (value === undefined || value === null || value === '') return null;
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : false;
}

/** An id, or null for blank. `false` when it is not an id. */
function readOptionalId(value: unknown): string | null | false {
  if (value === undefined || value === null || value === '') return null;
  return isUuid(value) ? value : false;
}

export const PUT = withSchoolAuth(
  async (request, auth) => {
    try {
      const body = await readJsonBody<UpsertBody>(request);
      if (body === null) {
        return apiFailure('invalid_body', 'Expected a JSON body.', 400);
      }

      if (!isUuid(body.academicYearId)) {
        return apiFailure('invalid_body', 'Choose an academic year.', 400);
      }
      if (!isUuid(body.gradeId)) {
        return apiFailure('invalid_body', 'Choose a class.', 400);
      }
      if (!isPromotionMechanism(body.mechanism)) {
        return apiFailure(
          'invalid_body',
          'Choose whether this class is judged on marks and grades or on performance descriptors.',
          400,
        );
      }

      const numbers = {
        minOverallPercentage: readOptionalNumber(body.minOverallPercentage),
        maxFailedSubjects: readOptionalNumber(body.maxFailedSubjects),
        maxFailingSubjects: readOptionalNumber(body.maxFailingSubjects),
        minAttendancePercentage: readOptionalNumber(body.minAttendancePercentage),
      };
      if (Object.values(numbers).includes(false)) {
        return apiFailure('invalid_body', 'One of those thresholds is not a number.', 400);
      }

      const gradingSchemeId = readOptionalId(body.gradingSchemeId);
      const failingSubcategoryId = readOptionalId(body.failingSubcategoryId);
      if (gradingSchemeId === false || failingSubcategoryId === false) {
        return apiFailure('invalid_body', 'One of those choices was not recognised.', 400);
      }

      const criteria: CriteriaRow = {
        mechanism: body.mechanism,
        gradingSchemeId,
        minOverallPercentage: numbers.minOverallPercentage as number | null,
        maxFailedSubjects: numbers.maxFailedSubjects as number | null,
        failingSubcategoryId,
        maxFailingSubjects: numbers.maxFailingSubjects as number | null,
        minAttendancePercentage: numbers.minAttendancePercentage as number | null,
      };

      // The same function the editor previews with, so the screen and the
      // server cannot disagree about what a valid row is.
      const problem = criteriaProblem(criteria);
      if (problem !== null) return apiFailure('invalid_body', problem, 400);

      // Every id in a body is re-read through a tenant-filtered query: neither
      // foreign key is scoped by tenant, so Postgres would accept another
      // school's scheme or descriptor.
      const [year, grades, scheme, subcategories] = await Promise.all([
        getAcademicYear(auth.locationId, body.academicYearId),
        listGradeCriteria(auth.locationId, body.academicYearId),
        gradingSchemeId === null
          ? Promise.resolve(null)
          : getGradingScheme(auth.locationId, gradingSchemeId),
        listResultSubcategories(auth.locationId, { includeArchived: true }),
      ]);

      if (year === null) {
        return apiFailure('not_found', 'That academic year was not found.', 404);
      }
      if (!grades.some((row) => row.gradeId === body.gradeId)) {
        return apiFailure('not_found', 'That class was not found.', 404);
      }
      if (gradingSchemeId !== null && scheme === null) {
        return apiFailure('not_found', 'That grading scheme was not found.', 404);
      }
      if (
        failingSubcategoryId !== null &&
        !subcategories.some((row) => row.id === failingSubcategoryId)
      ) {
        return apiFailure('not_found', 'That sub-category was not found.', 404);
      }

      const now = new Date();

      await db
        .insert(gradePromotionCriteria)
        .values({
          // Tenant from the verified session, never from the body.
          locationId: auth.locationId,
          academicYearId: body.academicYearId,
          gradeId: body.gradeId,
          mechanism: criteria.mechanism,
          gradingSchemeId: criteria.gradingSchemeId,
          minOverallPercentage:
            criteria.minOverallPercentage === null
              ? null
              : criteria.minOverallPercentage.toFixed(2),
          maxFailedSubjects: criteria.maxFailedSubjects,
          failingSubcategoryId: criteria.failingSubcategoryId,
          maxFailingSubjects: criteria.maxFailingSubjects,
          minAttendancePercentage:
            criteria.minAttendancePercentage === null
              ? null
              : criteria.minAttendancePercentage.toFixed(2),
          updatedAt: now,
        })
        .onConflictDoUpdate({
          target: [
            gradePromotionCriteria.locationId,
            gradePromotionCriteria.academicYearId,
            gradePromotionCriteria.gradeId,
          ],
          set: {
            mechanism: sql`excluded.mechanism`,
            gradingSchemeId: sql`excluded.grading_scheme_id`,
            minOverallPercentage: sql`excluded.min_overall_percentage`,
            maxFailedSubjects: sql`excluded.max_failed_subjects`,
            failingSubcategoryId: sql`excluded.failing_subcategory_id`,
            maxFailingSubjects: sql`excluded.max_failing_subjects`,
            minAttendancePercentage: sql`excluded.min_attendance_percentage`,
            updatedAt: sql`excluded.updated_at`,
          },
        });

      const saved = await db
        .select({ id: gradePromotionCriteria.id })
        .from(gradePromotionCriteria)
        .where(
          and(
            eq(gradePromotionCriteria.locationId, auth.locationId),
            eq(gradePromotionCriteria.academicYearId, body.academicYearId),
            eq(gradePromotionCriteria.gradeId, body.gradeId),
          ),
        )
        .limit(1);

      return apiSuccess({ criteriaId: saved[0]?.id ?? null, criteria });
    } catch (error) {
      return handleApiError(error);
    }
  },
  { permission: 'exams.write' },
);
