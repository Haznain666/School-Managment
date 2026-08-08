import { and, eq } from 'drizzle-orm';

import { examSubjects } from '@/db/schema';
import { withSchoolAuth } from '@/lib/api-auth';
import { apiFailure, apiSuccess, handleApiError, readJsonBody } from '@/lib/api-response';
import { getSubject } from '@/lib/academics-queries';
import { db } from '@/lib/drizzle';
import { getExamDetail, listExamPapers } from '@/lib/exam-queries';
import { markToNumeric, toMark } from '@/lib/grading';
import { isIsoDate, isUuid, readOptionalString } from '@/lib/validation';

/**
 * /api/school/exams/[examId]/subjects
 *
 * GET  the papers on this exam's datesheet
 * POST add one
 *
 * `max_marks` and `passing_marks` are frozen onto the paper rather than read
 * from the subject: a school that runs Mathematics out of 100 in one term and
 * 75 in the next must keep both answers, or an old report card silently
 * recomputes itself against the wrong denominator.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type RouteContext = { params: Promise<{ examId: string }> };

export const GET = withSchoolAuth<RouteContext>(
  async (_request, auth, context) => {
    try {
      const { examId } = await context.params;
      if (!isUuid(examId)) return apiFailure('not_found', 'Exam not found.', 404);

      return apiSuccess({ papers: await listExamPapers(auth.locationId, examId) });
    } catch (error) {
      return handleApiError(error);
    }
  },
  { permission: 'exams.read' },
);

interface AddPaperBody {
  subjectId?: unknown;
  maxMarks?: unknown;
  passingMarks?: unknown;
  examDate?: unknown;
  slot?: unknown;
  orderIndex?: unknown;
}

export const POST = withSchoolAuth<RouteContext>(
  async (request, auth, context) => {
    try {
      const { examId } = await context.params;
      if (!isUuid(examId)) return apiFailure('not_found', 'Exam not found.', 404);

      const exam = await getExamDetail(auth.locationId, examId);
      if (exam === null) return apiFailure('not_found', 'Exam not found.', 404);

      const body = await readJsonBody<AddPaperBody>(request);
      if (body === null) {
        return apiFailure('invalid_body', 'Expected a JSON body.', 400);
      }

      if (!isUuid(body.subjectId)) {
        return apiFailure('invalid_body', 'Choose a subject.', 400);
      }

      const maxMarks = toMark(body.maxMarks);
      const passingMarks = toMark(body.passingMarks);

      if (maxMarks === null || maxMarks <= 0 || maxMarks > 9999) {
        return apiFailure('invalid_body', 'Total marks must be more than zero.', 400);
      }
      if (passingMarks === null || passingMarks < 0 || passingMarks > maxMarks) {
        return apiFailure(
          'invalid_body',
          'Passing marks must be between zero and the total.',
          400,
        );
      }

      const examDate =
        body.examDate === undefined || body.examDate === null || body.examDate === ''
          ? null
          : body.examDate;
      if (examDate !== null && !isIsoDate(examDate)) {
        return apiFailure('invalid_body', 'Enter a valid date for this paper.', 400);
      }

      // The subject came out of the body and its foreign key is not scoped by
      // tenant, so it is re-read through a tenant-filtered query.
      const subject = await getSubject(auth.locationId, body.subjectId);
      if (subject === null) {
        return apiFailure('not_found', 'That subject was not found.', 404);
      }

      const clash = await db
        .select({ id: examSubjects.id })
        .from(examSubjects)
        .where(
          and(
            eq(examSubjects.locationId, auth.locationId),
            eq(examSubjects.examId, examId),
            eq(examSubjects.subjectId, body.subjectId),
          ),
        )
        .limit(1);

      if (clash[0] !== undefined) {
        return apiFailure(
          'duplicate',
          `${subject.name} is already on this exam's datesheet.`,
          409,
        );
      }

      const orderIndex =
        typeof body.orderIndex === 'number' && Number.isInteger(body.orderIndex)
          ? body.orderIndex
          : exam.papers.length;

      const created = await db
        .insert(examSubjects)
        .values({
          locationId: auth.locationId,
          examId,
          subjectId: body.subjectId,
          maxMarks: markToNumeric(maxMarks),
          passingMarks: markToNumeric(passingMarks),
          examDate,
          slot: readOptionalString(body.slot),
          orderIndex,
        })
        .returning({ id: examSubjects.id });

      return apiSuccess({ examSubjectId: created[0]?.id ?? null }, 201);
    } catch (error) {
      return handleApiError(error);
    }
  },
  { permission: 'exams.write' },
);
