import { randomUUID } from 'node:crypto';

import { and, eq, isNull } from 'drizzle-orm';

import { examScheduleGrades, examScheduleSubjects, examSchedules } from '@/db/schema';
import { withSchoolAuth } from '@/lib/api-auth';
import { apiFailure, apiSuccess, handleApiError, readJsonBody } from '@/lib/api-response';
import { batch, db } from '@/lib/drizzle';
import { getExamTerm, listExamSchedules } from '@/lib/exam-queries';
import {
  checkScheduleAgainstSchool,
  parseScheduleInput,
  type RawScheduleBody,
} from '@/lib/exam-schedule-input';
import { markToNumeric } from '@/lib/grading';
import { isUuid } from '@/lib/validation';

/**
 * /api/school/exam-terms/[termId]/schedules
 *
 * GET  the term's datesheets, with their classes and their papers
 * POST author another one
 *
 * A term holds as many datesheets as the school has groups of classes sitting
 * different papers on different days, which is the whole reason this table
 * exists — see `db/schema/exam-schedules.ts`.
 *
 * The schedule, its class assignments and its subject rows are written in one
 * transaction. A schedule that committed without its grades would be a
 * datesheet nobody sits, and one that committed without its grade rows *after*
 * the grades were checked is exactly the race the partial unique index exists
 * to lose.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type RouteContext = { params: Promise<{ termId: string }> };

export const GET = withSchoolAuth<RouteContext>(
  async (_request, auth, context) => {
    try {
      const { termId } = await context.params;
      if (!isUuid(termId)) return apiFailure('not_found', 'Term not found.', 404);

      const term = await getExamTerm(auth.locationId, termId);
      if (term === null) return apiFailure('not_found', 'Term not found.', 404);

      return apiSuccess({
        term,
        schedules: await listExamSchedules(auth.locationId, termId),
      });
    } catch (error) {
      return handleApiError(error);
    }
  },
  { permission: 'exams.read' },
);

export const POST = withSchoolAuth<RouteContext>(
  async (request, auth, context) => {
    try {
      const { termId } = await context.params;
      if (!isUuid(termId)) return apiFailure('not_found', 'Term not found.', 404);

      const term = await getExamTerm(auth.locationId, termId);
      if (term === null) return apiFailure('not_found', 'Term not found.', 404);
      if (term.isArchived) {
        return apiFailure('invalid_state', 'That term has been archived.', 409);
      }

      const body = await readJsonBody<RawScheduleBody>(request);
      if (body === null) {
        return apiFailure('invalid_body', 'Expected a JSON body.', 400);
      }

      const input = parseScheduleInput(body);
      if (typeof input === 'string') return apiFailure('invalid_body', input, 400);

      const checked = await checkScheduleAgainstSchool(auth.locationId, term, input);
      if (typeof checked === 'string') {
        return apiFailure('invalid_body', checked, 400);
      }

      const clash = await db
        .select({ id: examSchedules.id })
        .from(examSchedules)
        .where(
          and(
            eq(examSchedules.locationId, auth.locationId),
            eq(examSchedules.termId, termId),
            eq(examSchedules.name, input.name),
            isNull(examSchedules.archivedAt),
          ),
        )
        .limit(1);

      if (clash[0] !== undefined) {
        return apiFailure(
          'duplicate',
          `There is already a "${input.name}" schedule in this term.`,
          409,
        );
      }

      // Minted here rather than read back from RETURNING so the grade and
      // subject rows can be built in the same `batch` callback — see
      // `lib/enrollment.ts`, which does the same for the same reason.
      const scheduleId = randomUUID();

      await batch(db, (tx) => [
        tx.insert(examSchedules).values({
          id: scheduleId,
          // Tenant from the verified session, never from the body.
          locationId: auth.locationId,
          termId,
          name: input.name,
          startDate: input.startDate,
          endDate: input.endDate,
        }),
        tx.insert(examScheduleGrades).values(
          input.gradeIds.map((gradeId) => ({
            locationId: auth.locationId,
            scheduleId,
            // Denormalised so "one datesheet per class per term" is an index.
            termId,
            gradeId,
          })),
        ),
        ...(input.subjects.length === 0
          ? []
          : [
              tx.insert(examScheduleSubjects).values(
                input.subjects.map((paper) => ({
                  locationId: auth.locationId,
                  scheduleId,
                  subjectId: paper.subjectId,
                  examDate: paper.examDate,
                  startTime: paper.startTime,
                  durationMinutes: paper.durationMinutes,
                  maxMarks:
                    paper.maxMarks === null ? null : markToNumeric(paper.maxMarks),
                  passingMarks:
                    paper.passingMarks === null
                      ? null
                      : markToNumeric(paper.passingMarks),
                  orderIndex: paper.orderIndex,
                })),
              ),
            ]),
      ]);

      return apiSuccess({ scheduleId, mechanism: checked.mechanism }, 201);
    } catch (error) {
      return handleApiError(error);
    }
  },
  { permission: 'exams.write' },
);
