import { and, count, eq, inArray } from 'drizzle-orm';

import { examResults, exams } from '@/db/schema';
import { withSchoolAuth } from '@/lib/api-auth';
import { apiFailure, apiSuccess, handleApiError, readJsonBody } from '@/lib/api-response';
import { db } from '@/lib/drizzle';
import { getExamDetail } from '@/lib/exam-queries';
import { hasPermission } from '@/lib/permission-queries';
import { isIsoDate, isUuid, readOptionalString, readString } from '@/lib/validation';

/**
 * /api/school/exams/[examId]
 *
 * GET    one exam with its papers
 * PATCH  retitle it, move it, or publish the datesheet
 * DELETE remove one scheduled by mistake
 *
 * Publishing here announces *when* the exam is — it is what makes admit cards
 * issuable. Marks are published per paper, and report cards per term. Three
 * gates, three audiences; `db/schema/exams.ts` says why they are separate.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type RouteContext = { params: Promise<{ examId: string }> };

export const GET = withSchoolAuth<RouteContext>(
  async (_request, auth, context) => {
    try {
      const { examId } = await context.params;
      if (!isUuid(examId)) return apiFailure('not_found', 'Exam not found.', 404);

      const exam = await getExamDetail(auth.locationId, examId);
      if (exam === null) return apiFailure('not_found', 'Exam not found.', 404);

      return apiSuccess({ exam });
    } catch (error) {
      return handleApiError(error);
    }
  },
  { permission: 'exams.read' },
);

interface UpdateExamBody {
  title?: unknown;
  examDate?: unknown;
  instructions?: unknown;
  isPublished?: unknown;
}

export const PATCH = withSchoolAuth<RouteContext>(
  async (request, auth, context) => {
    try {
      const { examId } = await context.params;
      if (!isUuid(examId)) return apiFailure('not_found', 'Exam not found.', 404);

      const existing = await getExamDetail(auth.locationId, examId);
      if (existing === null) return apiFailure('not_found', 'Exam not found.', 404);

      const body = await readJsonBody<UpdateExamBody>(request);
      if (body === null) {
        return apiFailure('invalid_body', 'Expected a JSON body.', 400);
      }

      const updates: Partial<typeof exams.$inferInsert> = {};

      if (body.title !== undefined) {
        const title = readString(body.title);
        if (title === '' || title.length > 120) {
          return apiFailure('invalid_body', 'Enter a title of 120 characters or fewer.', 400);
        }
        updates.title = title;
      }

      if (body.examDate !== undefined) {
        if (!isIsoDate(body.examDate)) {
          return apiFailure('invalid_body', 'Choose a start date.', 400);
        }
        updates.examDate = body.examDate;
      }

      if (body.instructions !== undefined) {
        updates.instructions = readOptionalString(body.instructions);
      }

      if (body.isPublished !== undefined) {
        if (typeof body.isPublished !== 'boolean') {
          return apiFailure('invalid_body', 'isPublished must be true or false.', 400);
        }

        // Same split as the term route: editing is `exams.write`, announcing
        // is `exams.publish`.
        const mayPublish = await hasPermission(
          auth.locationId,
          auth.role,
          'exams.publish',
        );
        if (!mayPublish) {
          return apiFailure(
            'forbidden',
            'Your role may schedule an exam but not announce it.',
            403,
          );
        }

        if (body.isPublished && existing.papers.length === 0) {
          return apiFailure(
            'invalid_state',
            'Add at least one paper before announcing the datesheet — an admit card with no papers on it is worse than none.',
            409,
          );
        }

        updates.isPublished = body.isPublished;
        if (body.isPublished) updates.publishedAt = new Date();
      }

      if (Object.keys(updates).length === 0) {
        return apiFailure('invalid_body', 'No fields to update.', 400);
      }

      updates.updatedAt = new Date();

      await db
        .update(exams)
        .set(updates)
        .where(and(eq(exams.locationId, auth.locationId), eq(exams.id, examId)));

      return apiSuccess({ exam: await getExamDetail(auth.locationId, examId) });
    } catch (error) {
      return handleApiError(error);
    }
  },
  { permission: 'exams.write' },
);

/**
 * Deleting is for an exam scheduled by mistake, and only that.
 *
 * Once a single mark exists the exam is refused rather than cascaded away.
 * `exam_results` cascades from `exam_subjects`, which cascades from here, so
 * the delete *would* succeed and take a teacher's afternoon of marking with it
 * silently. Retiring the exam instead is not offered because an unpublished
 * exam with marks is not a thing a school keeps — it is a thing it corrects.
 */
export const DELETE = withSchoolAuth<RouteContext>(
  async (_request, auth, context) => {
    try {
      const { examId } = await context.params;
      if (!isUuid(examId)) return apiFailure('not_found', 'Exam not found.', 404);

      const exam = await getExamDetail(auth.locationId, examId);
      if (exam === null) return apiFailure('not_found', 'Exam not found.', 404);

      const paperIds = exam.papers.map((paper) => paper.id);

      if (paperIds.length > 0) {
        const marked = await db
          .select({ value: count() })
          .from(examResults)
          .where(
            and(
              eq(examResults.locationId, auth.locationId),
              inArray(examResults.examSubjectId, paperIds),
            ),
          );

        if ((marked[0]?.value ?? 0) > 0) {
          return apiFailure(
            'conflict',
            'Marks have already been entered against this exam. Remove those first, or leave the exam unpublished.',
            409,
          );
        }
      }

      await db
        .delete(exams)
        .where(and(eq(exams.locationId, auth.locationId), eq(exams.id, examId)));

      return apiSuccess({ examId });
    } catch (error) {
      return handleApiError(error);
    }
  },
  { permission: 'exams.write' },
);
