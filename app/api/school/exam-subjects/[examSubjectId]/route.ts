import { and, count, eq, max } from 'drizzle-orm';

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
 *
 * ── And refused while any stored mark exceeds the new total ──────────────
 * `POST .../results` refuses a mark above `max_marks`. That invariant has two
 * directions and only one of them was guarded: QA lowered a 100-mark paper to
 * 50 after entering marks up to 90 and the report card printed
 * `Science 89/50 = 178%`, with grade, GPA and position all computed from it.
 *
 * The rule is now "a paper's total may not fall below a mark somebody has
 * already been given", and it is stated as that rather than as "no edits once
 * marks exist" on purpose: correcting a paper keyed in as out of 50 when it
 * was out of 100 is a real and common fix, and forbidding it would send
 * schools to delete a class's marking to change one number. Lowering below an
 * existing mark is the only case that cannot be true, so it is the only case
 * refused — and the error names the offending mark, because the way out is to
 * correct that mark first.
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

        // Both attempts are considered: a re-sit mark of 88 is just as real as
        // an original one, and lowering the total under it would falsify the
        // re-sit sheet instead of the first.
        const highest = await db
          .select({ value: max(examResults.marksObtained) })
          .from(examResults)
          .where(
            and(
              eq(examResults.locationId, auth.locationId),
              eq(examResults.examSubjectId, examSubjectId),
            ),
          );

        const highestMark = toMark(highest[0]?.value);

        if (highestMark !== null && maxMarks < highestMark) {
          return apiFailure(
            'conflict',
            `A student has already been given ${highestMark} for this paper, so it cannot be out of ${maxMarks}. Correct that mark first, or raise the total.`,
            409,
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
