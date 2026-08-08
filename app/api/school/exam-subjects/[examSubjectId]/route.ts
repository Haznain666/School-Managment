import { and, count, eq } from 'drizzle-orm';

import { examResults, examSubjects } from '@/db/schema';
import { withSchoolAuth } from '@/lib/api-auth';
import { apiFailure, apiSuccess, handleApiError, readJsonBody } from '@/lib/api-response';
import { db } from '@/lib/drizzle';
import { getExamPaper } from '@/lib/exam-queries';
import { markToNumeric, toMark } from '@/lib/grading';
import { isIsoDate, isUuid, readOptionalString } from '@/lib/validation';

/**
 * /api/school/exam-subjects/[examSubjectId]
 *
 * PATCH  correct a paper's marks out of, its date or its sitting
 * DELETE take it off the datesheet
 *
 * The totals are refused once the paper is published. Everything downstream —
 * every percentage, every grade, every position — is computed against them, so
 * changing them afterwards would silently rewrite a report card a parent has
 * already been handed. Unpublish first; that is a deliberate two-step.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type RouteContext = { params: Promise<{ examSubjectId: string }> };

interface UpdatePaperBody {
  maxMarks?: unknown;
  passingMarks?: unknown;
  examDate?: unknown;
  slot?: unknown;
  orderIndex?: unknown;
}

export const PATCH = withSchoolAuth<RouteContext>(
  async (request, auth, context) => {
    try {
      const { examSubjectId } = await context.params;
      if (!isUuid(examSubjectId)) return apiFailure('not_found', 'Paper not found.', 404);

      const paper = await getExamPaper(auth.locationId, examSubjectId);
      if (paper === null) return apiFailure('not_found', 'Paper not found.', 404);

      const body = await readJsonBody<UpdatePaperBody>(request);
      if (body === null) {
        return apiFailure('invalid_body', 'Expected a JSON body.', 400);
      }

      const updates: Partial<typeof examSubjects.$inferInsert> = {};

      const wantsTotals = body.maxMarks !== undefined || body.passingMarks !== undefined;

      if (wantsTotals) {
        if (paper.resultsStatus === 'published') {
          return apiFailure(
            'invalid_state',
            'These marks are published. Unpublish them before changing what the paper is out of.',
            409,
          );
        }

        const maxMarks = toMark(body.maxMarks) ?? paper.maxMarks;
        const passingMarks = toMark(body.passingMarks) ?? paper.passingMarks;

        if (maxMarks <= 0 || maxMarks > 9999) {
          return apiFailure('invalid_body', 'Total marks must be more than zero.', 400);
        }
        if (passingMarks < 0 || passingMarks > maxMarks) {
          return apiFailure(
            'invalid_body',
            'Passing marks must be between zero and the total.',
            400,
          );
        }

        updates.maxMarks = markToNumeric(maxMarks);
        updates.passingMarks = markToNumeric(passingMarks);
      }

      if (body.examDate !== undefined) {
        if (body.examDate === null || body.examDate === '') {
          updates.examDate = null;
        } else if (!isIsoDate(body.examDate)) {
          return apiFailure('invalid_body', 'Enter a valid date for this paper.', 400);
        } else {
          updates.examDate = body.examDate;
        }
      }

      if (body.slot !== undefined) updates.slot = readOptionalString(body.slot);

      if (typeof body.orderIndex === 'number' && Number.isInteger(body.orderIndex)) {
        updates.orderIndex = body.orderIndex;
      }

      if (Object.keys(updates).length === 0) {
        return apiFailure('invalid_body', 'No fields to update.', 400);
      }

      updates.updatedAt = new Date();

      await db
        .update(examSubjects)
        .set(updates)
        .where(
          and(
            eq(examSubjects.locationId, auth.locationId),
            eq(examSubjects.id, examSubjectId),
          ),
        );

      return apiSuccess({ paper: await getExamPaper(auth.locationId, examSubjectId) });
    } catch (error) {
      return handleApiError(error);
    }
  },
  { permission: 'exams.write' },
);

export const DELETE = withSchoolAuth<RouteContext>(
  async (_request, auth, context) => {
    try {
      const { examSubjectId } = await context.params;
      if (!isUuid(examSubjectId)) return apiFailure('not_found', 'Paper not found.', 404);

      const paper = await getExamPaper(auth.locationId, examSubjectId);
      if (paper === null) return apiFailure('not_found', 'Paper not found.', 404);

      // `exam_results` cascades from here, so the delete would succeed and take
      // a teacher's marking with it without saying so.
      const marked = await db
        .select({ value: count() })
        .from(examResults)
        .where(
          and(
            eq(examResults.locationId, auth.locationId),
            eq(examResults.examSubjectId, examSubjectId),
          ),
        );

      if ((marked[0]?.value ?? 0) > 0) {
        return apiFailure(
          'conflict',
          'Marks have been entered for this paper. Clear them before removing it from the datesheet.',
          409,
        );
      }

      await db
        .delete(examSubjects)
        .where(
          and(
            eq(examSubjects.locationId, auth.locationId),
            eq(examSubjects.id, examSubjectId),
          ),
        );

      return apiSuccess({ examSubjectId });
    } catch (error) {
      return handleApiError(error);
    }
  },
  { permission: 'exams.write' },
);
