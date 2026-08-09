import { and, desc, eq } from 'drizzle-orm';

import { grades, promotionDecisions, promotionRuns } from '@/db/schema';
import { apiFailure, apiSuccess, handleApiError, readJsonBody } from '@/lib/api-response';
import { withSchoolAuth } from '@/lib/api-auth';
import { db } from '@/lib/drizzle';
import {
  listPromotionCandidates,
  suggestNextGrade,
} from '@/lib/promotion-queries';
import { listSections } from '@/lib/admissions-queries';
import { isUuid } from '@/lib/validation';

/**
 * /api/school/promotions
 *
 * GET  the school's promotion runs
 * POST open a draft run for one grade, with a decision per student
 *
 * ── The draft is built server-side, not assembled by the browser ─────────
 * Opening a run reads the grade's active enrolments and writes one decision
 * row per student, defaulted. The alternative — the browser posting a list of
 * students it believes are in the grade — would let a stale screen promote a
 * roster that has since changed, and a child enrolled that morning would
 * silently be left behind in last year.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = withSchoolAuth(
  async (_request, auth) => {
    try {
      const runs = await db
        .select({
          id: promotionRuns.id,
          gradeId: promotionRuns.gradeId,
          gradeName: grades.name,
          fromAcademicYearId: promotionRuns.fromAcademicYearId,
          toAcademicYearId: promotionRuns.toAcademicYearId,
          status: promotionRuns.status,
          promotedCount: promotionRuns.promotedCount,
          retainedCount: promotionRuns.retainedCount,
          graduatedCount: promotionRuns.graduatedCount,
          appliedAt: promotionRuns.appliedAt,
          createdAt: promotionRuns.createdAt,
        })
        .from(promotionRuns)
        .innerJoin(grades, eq(grades.id, promotionRuns.gradeId))
        .where(eq(promotionRuns.locationId, auth.locationId))
        .orderBy(desc(promotionRuns.createdAt))
        .limit(30);

      return apiSuccess({ runs });
    } catch (error) {
      return handleApiError(error);
    }
  },
  { permission: 'students.promote' },
);

interface CreateRunBody {
  gradeId?: unknown;
  fromAcademicYearId?: unknown;
  toAcademicYearId?: unknown;
}

export const POST = withSchoolAuth(
  async (request, auth) => {
    try {
      const body = await readJsonBody<CreateRunBody>(request);
      if (body === null) {
        return apiFailure('invalid_body', 'Expected a JSON body.', 400);
      }

      const gradeId = typeof body.gradeId === 'string' ? body.gradeId : '';
      const fromYear =
        typeof body.fromAcademicYearId === 'string' ? body.fromAcademicYearId : '';
      const toYear = typeof body.toAcademicYearId === 'string' ? body.toAcademicYearId : '';

      if (!isUuid(gradeId) || !isUuid(fromYear) || !isUuid(toYear)) {
        return apiFailure('invalid_body', 'Choose a class and both years.', 400);
      }

      if (fromYear === toYear) {
        return apiFailure(
          'invalid_body',
          'A promotion has to move students into a different year.',
          400,
        );
      }

      // Every id is re-read through a tenant-filtered query: none of these
      // foreign keys is scoped by tenant, so Postgres would accept another
      // school's grade perfectly happily.
      const gradeRows = await db
        .select({ id: grades.id, branchId: grades.branchId, name: grades.name })
        .from(grades)
        .where(and(eq(grades.locationId, auth.locationId), eq(grades.id, gradeId)))
        .limit(1);

      const grade = gradeRows[0];
      if (grade === undefined) {
        return apiFailure('invalid_body', 'That class does not exist.', 400);
      }

      if (auth.branchId !== null && grade.branchId !== auth.branchId) {
        return apiFailure('invalid_body', 'That class does not exist.', 400);
      }

      const candidates = await listPromotionCandidates(
        auth.locationId,
        gradeId,
        fromYear,
        toYear,
      );

      if (candidates.length === 0) {
        return apiFailure(
          'invalid_body',
          'Nobody is actively enrolled in that class for that year.',
          400,
        );
      }

      // The default decision, and the one place the sort order is consulted:
      // a grade with nothing above it is a leaving year, so its students
      // default to graduating rather than to a promotion with nowhere to go.
      const nextGrade = await suggestNextGrade(auth.locationId, gradeId);
      const defaultDecision = nextGrade === null ? 'graduate' : 'promote';

      const nextSections =
        nextGrade === null
          ? []
          : await listSections(auth.locationId, {
              gradeId: nextGrade.id,
              academicYearId: toYear,
            });

      // One section in the receiving grade is the overwhelmingly common case,
      // so it is pre-selected. Several means the operator is splitting a class
      // and must say who goes where.
      const onlySection = nextSections.length === 1 ? nextSections[0]!.id : null;

      const runId = crypto.randomUUID();

      await db.transaction(async (tx) => {
        await tx.insert(promotionRuns).values({
          id: runId,
          locationId: auth.locationId,
          gradeId,
          fromAcademicYearId: fromYear,
          toAcademicYearId: toYear,
        });

        await tx.insert(promotionDecisions).values(
          candidates.map((candidate) => ({
            locationId: auth.locationId,
            runId,
            studentProfileId: candidate.studentProfileId,
            fromEnrollmentId: candidate.enrollmentId,
            decision: defaultDecision as 'promote' | 'graduate',
            toSectionId: defaultDecision === 'promote' ? onlySection : null,
            // Named on the row rather than only counted, so the reviewer sees
            // why a child cannot be moved without leaving the screen.
            note: candidate.alreadyRolled
              ? 'Already enrolled in the receiving year.'
              : null,
          })),
        );
      });

      return apiSuccess(
        {
          runId,
          gradeName: grade.name,
          nextGrade,
          students: candidates.length,
          defaultDecision,
        },
        201,
      );
    } catch (error) {
      return handleApiError(error);
    }
  },
  { permission: 'students.promote' },
);
