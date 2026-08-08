import { exams } from '@/db/schema';
import { withSchoolAuth } from '@/lib/api-auth';
import { apiFailure, apiSuccess, handleApiError, readJsonBody } from '@/lib/api-response';
import { getSectionById } from '@/lib/admissions-queries';
import { db } from '@/lib/drizzle';
import { getExamTerm, listExams } from '@/lib/exam-queries';
import { getSchoolUserByUid } from '@/lib/school-queries';
import { isIsoDate, isUuid, readOptionalString, readString } from '@/lib/validation';

/**
 * /api/school/exams
 *
 * GET  the exams of a term, a section or a grade
 * POST schedule one
 *
 * An exam belongs to one section. `db/schema/exams.ts` explains why: every
 * artefact this module prints is a class document, and a grade-wide exam would
 * leave "position in class" with nothing to rank inside.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = withSchoolAuth(
  async (request, auth) => {
    try {
      const url = new URL(request.url);
      const read = (key: string): string | undefined => {
        const value = url.searchParams.get(key);
        return value === null || value === '' ? undefined : value;
      };

      return apiSuccess({
        exams: await listExams(auth.locationId, {
          termId: read('termId'),
          sectionId: read('sectionId'),
          gradeId: read('gradeId'),
        }),
      });
    } catch (error) {
      return handleApiError(error);
    }
  },
  { permission: 'exams.read' },
);

interface CreateExamBody {
  termId?: unknown;
  sectionId?: unknown;
  title?: unknown;
  examDate?: unknown;
  instructions?: unknown;
}

export const POST = withSchoolAuth(
  async (request, auth) => {
    try {
      const body = await readJsonBody<CreateExamBody>(request);
      if (body === null) {
        return apiFailure('invalid_body', 'Expected a JSON body.', 400);
      }

      const title = readString(body.title);
      if (title === '' || title.length > 120) {
        return apiFailure('invalid_body', 'Enter a title of 120 characters or fewer.', 400);
      }
      if (!isUuid(body.termId) || !isUuid(body.sectionId)) {
        return apiFailure('invalid_body', 'Choose a term and a section.', 400);
      }
      if (!isIsoDate(body.examDate)) {
        return apiFailure('invalid_body', 'Choose a start date.', 400);
      }

      // Both ids arrived in the body, so both are re-read through
      // tenant-filtered queries before anything is written.
      const [term, section] = await Promise.all([
        getExamTerm(auth.locationId, body.termId),
        getSectionById(auth.locationId, body.sectionId),
      ]);

      if (term === null) return apiFailure('not_found', 'Term not found.', 404);
      if (section === null) return apiFailure('not_found', 'Section not found.', 404);

      // A section belongs to one academic year and so does a term. Scheduling
      // last year's class into this year's term would produce an exam with an
      // empty roster and no obvious reason why.
      if (section.academicYearId !== term.academicYearId) {
        return apiFailure(
          'invalid_body',
          'That section is not in the same academic year as the term.',
          400,
        );
      }

      // The grade is denormalised onto the exam because every list filters by
      // it; it is taken from the section rather than the body so the two can
      // never disagree.
      const creator = await getSchoolUserByUid(auth.locationId, auth.uid);

      const created = await db
        .insert(exams)
        .values({
          locationId: auth.locationId,
          termId: body.termId,
          gradeId: section.gradeId,
          sectionId: body.sectionId,
          title,
          examDate: body.examDate,
          instructions: readOptionalString(body.instructions),
          createdBy: creator?.id ?? null,
        })
        .returning({ id: exams.id });

      return apiSuccess({ examId: created[0]?.id ?? null }, 201);
    } catch (error) {
      return handleApiError(error);
    }
  },
  { permission: 'exams.write' },
);
