import { and, countDistinct, eq, inArray, isNull, sql } from 'drizzle-orm';

import {
  examResults,
  examScheduleGrades,
  examScheduleSubjects,
  examSchedules,
  examSubjects,
  exams,
} from '@/db/schema';
import { withSchoolAuth } from '@/lib/api-auth';
import { apiFailure, apiSuccess, handleApiError, readJsonBody } from '@/lib/api-response';
import { batch, db, type Tx } from '@/lib/drizzle';
import { getExamSchedule, getExamTerm } from '@/lib/exam-queries';
import {
  checkScheduleAgainstSchool,
  parseScheduleInput,
  type RawScheduleBody,
} from '@/lib/exam-schedule-input';
import { markToNumeric } from '@/lib/grading';
import { getSchoolUserByUid } from '@/lib/school-queries';
import { isUuid } from '@/lib/validation';

/**
 * /api/school/exam-schedules/[scheduleId]
 *
 * GET    one datesheet
 * PATCH  rewrite it — name, window, classes and the whole subject timetable
 * DELETE archive it, with its class assignments and its generated exams
 *
 * ── The edit reconciles, it does not replace ─────────────────────────────
 * A paper generated from this schedule points back at its `exam_schedule_subjects`
 * row, and that link is what makes "move Maths to Thursday" one edit rather
 * than one per class. Archiving every row and inserting fresh ones would break
 * the link on every subject the school did not touch, and the next generate
 * would create a second Maths paper beside the one already carrying marks. So
 * a subject that stays keeps its row and is updated in place; only a subject
 * genuinely removed from the datesheet is archived.
 *
 * ── A class taken off a datesheet takes its exams with it ────────────────
 * Archiving only the `exam_schedule_grades` row leaves the exams and papers
 * this schedule generated for that class fully live: `schedule_id` still set,
 * `archived_at` still null, and `generate` — which walks the schedule's
 * *current* grades — will never look at them again. Worse, the class is now
 * free of `exam_schedule_grades_term_grade_idx`, so it can be put on a second
 * datesheet in the same term and generated a second time; and
 * `getSectionReportCards` selects by term and section with no schedule filter,
 * so every subject would appear twice, `available` would double and every
 * child's percentage would halve. The exams and their papers are therefore
 * archived in the same transaction as the grade row. Papers carrying marks are
 * archived, never deleted, and the response says how many of them there were —
 * the person who dropped the class is the only one who can decide whether that
 * was intended, and they will not find out any other way.
 *
 * ── DELETE archives the grade rows too ───────────────────────────────────
 * Same reason the term does it: `exam_schedule_grades_term_grade_idx` says a
 * class sits one datesheet per term, and a live grade row under an archived
 * schedule locks that class out of its replacement by an index nobody can see.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type RouteContext = { params: Promise<{ scheduleId: string }> };

/** The term a schedule belongs to, read through the tenant filter. */
async function termIdFor(
  locationId: string,
  scheduleId: string,
): Promise<{ termId: string; archived: boolean } | null> {
  const rows = await db
    .select({ termId: examSchedules.termId, archivedAt: examSchedules.archivedAt })
    .from(examSchedules)
    .where(
      and(eq(examSchedules.locationId, locationId), eq(examSchedules.id, scheduleId)),
    )
    .limit(1);

  const row = rows[0];
  return row === undefined ? null : { termId: row.termId, archived: row.archivedAt !== null };
}

export const GET = withSchoolAuth<RouteContext>(
  async (_request, auth, context) => {
    try {
      const { scheduleId } = await context.params;
      if (!isUuid(scheduleId)) return apiFailure('not_found', 'Schedule not found.', 404);

      const schedule = await getExamSchedule(auth.locationId, scheduleId);
      if (schedule === null) return apiFailure('not_found', 'Schedule not found.', 404);

      return apiSuccess({ schedule });
    } catch (error) {
      return handleApiError(error);
    }
  },
  { permission: 'exams.read' },
);

export const PATCH = withSchoolAuth<RouteContext>(
  async (request, auth, context) => {
    try {
      const { scheduleId } = await context.params;
      if (!isUuid(scheduleId)) return apiFailure('not_found', 'Schedule not found.', 404);

      const owner = await termIdFor(auth.locationId, scheduleId);
      if (owner === null) return apiFailure('not_found', 'Schedule not found.', 404);
      if (owner.archived) {
        return apiFailure('invalid_state', 'That schedule has been archived.', 409);
      }

      const term = await getExamTerm(auth.locationId, owner.termId);
      if (term === null) return apiFailure('not_found', 'Term not found.', 404);

      const body = await readJsonBody<RawScheduleBody>(request);
      if (body === null) {
        return apiFailure('invalid_body', 'Expected a JSON body.', 400);
      }

      const input = parseScheduleInput(body);
      if (typeof input === 'string') return apiFailure('invalid_body', input, 400);

      // Its own grades are not a conflict with itself.
      const checked = await checkScheduleAgainstSchool(
        auth.locationId,
        term,
        input,
        scheduleId,
      );
      if (typeof checked === 'string') {
        return apiFailure('invalid_body', checked, 400);
      }

      const clash = await db
        .select({ id: examSchedules.id })
        .from(examSchedules)
        .where(
          and(
            eq(examSchedules.locationId, auth.locationId),
            eq(examSchedules.termId, owner.termId),
            eq(examSchedules.name, input.name),
            isNull(examSchedules.archivedAt),
          ),
        )
        .limit(1);

      if (clash[0] !== undefined && clash[0].id !== scheduleId) {
        return apiFailure(
          'duplicate',
          `There is already a "${input.name}" schedule in this term.`,
          409,
        );
      }

      const [currentGrades, currentSubjects] = await Promise.all([
        db
          .select({ id: examScheduleGrades.id, gradeId: examScheduleGrades.gradeId })
          .from(examScheduleGrades)
          .where(
            and(
              eq(examScheduleGrades.locationId, auth.locationId),
              eq(examScheduleGrades.scheduleId, scheduleId),
              isNull(examScheduleGrades.archivedAt),
            ),
          ),
        db
          .select({
            id: examScheduleSubjects.id,
            subjectId: examScheduleSubjects.subjectId,
          })
          .from(examScheduleSubjects)
          .where(
            and(
              eq(examScheduleSubjects.locationId, auth.locationId),
              eq(examScheduleSubjects.scheduleId, scheduleId),
              isNull(examScheduleSubjects.archivedAt),
            ),
          ),
      ]);

      const now = new Date();
      const keptGrades = new Set(input.gradeIds);
      const droppedGradeRows = currentGrades.filter(
        (row) => !keptGrades.has(row.gradeId),
      );
      const droppedGrades = droppedGradeRows.map((row) => row.id);
      const addedGrades = input.gradeIds.filter(
        (gradeId) => !currentGrades.some((row) => row.gradeId === gradeId),
      );

      // What this schedule generated for the classes being dropped. Read
      // before the transaction opens so the statements below are pure writes;
      // nothing else can attach an exam to this schedule for a grade that is
      // leaving it, because only `generate` writes one and it needs the same
      // `exams.write` permission this request is holding.
      const orphanExamIds: string[] = [];
      let orphanPapers = 0;
      let orphanPapersWithMarks = 0;

      if (droppedGradeRows.length > 0) {
        const examRows = await db
          .select({ id: exams.id })
          .from(exams)
          .where(
            and(
              eq(exams.locationId, auth.locationId),
              eq(exams.scheduleId, scheduleId),
              inArray(
                exams.gradeId,
                droppedGradeRows.map((row) => row.gradeId),
              ),
              isNull(exams.archivedAt),
            ),
          );

        orphanExamIds.push(...examRows.map((row) => row.id));

        if (orphanExamIds.length > 0) {
          const paperRows = await db
            .select({ id: examSubjects.id })
            .from(examSubjects)
            .where(
              and(
                eq(examSubjects.locationId, auth.locationId),
                inArray(examSubjects.examId, orphanExamIds),
                isNull(examSubjects.archivedAt),
              ),
            );

          orphanPapers = paperRows.length;

          if (paperRows.length > 0) {
            const counted = await db
              .select({
                examSubjectId: examResults.examSubjectId,
                value: countDistinct(examResults.id),
              })
              .from(examResults)
              .where(
                and(
                  eq(examResults.locationId, auth.locationId),
                  inArray(
                    examResults.examSubjectId,
                    paperRows.map((row) => row.id),
                  ),
                ),
              )
              .groupBy(examResults.examSubjectId);

            orphanPapersWithMarks = counted.filter((row) => row.value > 0).length;
          }
        }
      }

      const existingSubject = new Map(
        currentSubjects.map((row) => [row.subjectId, row.id] as const),
      );
      const keptSubjects = new Set(input.subjects.map((paper) => paper.subjectId));
      const droppedSubjects = currentSubjects
        .filter((row) => !keptSubjects.has(row.subjectId))
        .map((row) => row.id);

      // Deferred until `batch()` opens the transaction: a builder made from
      // `db` runs outside it even when awaited inside one.
      const statements: Array<(tx: Tx) => PromiseLike<unknown>> = [
        (tx) =>
          tx
            .update(examSchedules)
            .set({
              name: input.name,
              startDate: input.startDate,
              endDate: input.endDate,
              updatedAt: now,
            })
            .where(
              and(
                eq(examSchedules.locationId, auth.locationId),
                eq(examSchedules.id, scheduleId),
              ),
            ),
      ];

      if (droppedGrades.length > 0) {
        statements.push((tx) =>
          tx
            .update(examScheduleGrades)
            .set({ archivedAt: now })
            .where(
              and(
                eq(examScheduleGrades.locationId, auth.locationId),
                inArray(examScheduleGrades.id, droppedGrades),
              ),
            ),
        );
      }

      // Same transaction as the grade row above, deliberately: a committed
      // grade removal with the exams left behind is the state that lets one
      // cohort be examined twice.
      if (orphanExamIds.length > 0) {
        statements.push((tx) =>
          tx
            .update(exams)
            .set({ archivedAt: now, updatedAt: now })
            .where(
              and(
                eq(exams.locationId, auth.locationId),
                inArray(exams.id, orphanExamIds),
              ),
            ),
        );
        statements.push((tx) =>
          tx
            .update(examSubjects)
            .set({ archivedAt: now, updatedAt: now })
            .where(
              and(
                eq(examSubjects.locationId, auth.locationId),
                inArray(examSubjects.examId, orphanExamIds),
                isNull(examSubjects.archivedAt),
              ),
            ),
        );
      }

      if (addedGrades.length > 0) {
        statements.push((tx) =>
          tx.insert(examScheduleGrades).values(
            addedGrades.map((gradeId) => ({
              locationId: auth.locationId,
              scheduleId,
              termId: owner.termId,
              gradeId,
            })),
          ),
        );
      }

      if (droppedSubjects.length > 0) {
        statements.push((tx) =>
          tx
            .update(examScheduleSubjects)
            .set({ archivedAt: now, updatedAt: now })
            .where(
              and(
                eq(examScheduleSubjects.locationId, auth.locationId),
                inArray(examScheduleSubjects.id, droppedSubjects),
              ),
            ),
        );
      }

      for (const paper of input.subjects) {
        const values = {
          examDate: paper.examDate,
          startTime: paper.startTime,
          durationMinutes: paper.durationMinutes,
          maxMarks: paper.maxMarks === null ? null : markToNumeric(paper.maxMarks),
          passingMarks:
            paper.passingMarks === null ? null : markToNumeric(paper.passingMarks),
          orderIndex: paper.orderIndex,
        };

        const existingId = existingSubject.get(paper.subjectId);

        if (existingId === undefined) {
          statements.push((tx) =>
            tx.insert(examScheduleSubjects).values({
              locationId: auth.locationId,
              scheduleId,
              subjectId: paper.subjectId,
              ...values,
            }),
          );
        } else {
          statements.push((tx) =>
            tx
              .update(examScheduleSubjects)
              .set({ ...values, updatedAt: now })
              .where(
                and(
                  eq(examScheduleSubjects.locationId, auth.locationId),
                  eq(examScheduleSubjects.id, existingId),
                ),
              ),
          );
        }
      }

      await batch(db, (tx) => statements.map((statement) => statement(tx)));

      return apiSuccess({
        schedule: await getExamSchedule(auth.locationId, scheduleId),
        mechanism: checked.mechanism,
        archived: {
          grades: droppedGrades.length,
          exams: orphanExamIds.length,
          papers: orphanPapers,
          papersWithMarks: orphanPapersWithMarks,
        },
      });
    } catch (error) {
      return handleApiError(error);
    }
  },
  { permission: 'exams.write' },
);

export const DELETE = withSchoolAuth<RouteContext>(
  async (_request, auth, context) => {
    try {
      const { scheduleId } = await context.params;
      if (!isUuid(scheduleId)) return apiFailure('not_found', 'Schedule not found.', 404);

      const owner = await termIdFor(auth.locationId, scheduleId);
      if (owner === null) return apiFailure('not_found', 'Schedule not found.', 404);
      if (owner.archived) {
        return apiSuccess({ scheduleId, alreadyArchived: true });
      }

      const actor = await getSchoolUserByUid(auth.locationId, auth.uid);
      const now = new Date();

      const examRows = await db
        .select({ id: exams.id })
        .from(exams)
        .where(
          and(
            eq(exams.locationId, auth.locationId),
            eq(exams.scheduleId, scheduleId),
            isNull(exams.archivedAt),
          ),
        );

      const examIds = examRows.map((row) => row.id);

      await batch(db, (tx) => [
        tx
          .update(examSchedules)
          .set({ archivedAt: now, archivedBy: actor?.id ?? null, updatedAt: now })
          .where(
            and(
              eq(examSchedules.locationId, auth.locationId),
              eq(examSchedules.id, scheduleId),
            ),
          ),
        tx
          .update(examScheduleGrades)
          .set({ archivedAt: now })
          .where(
            and(
              eq(examScheduleGrades.locationId, auth.locationId),
              eq(examScheduleGrades.scheduleId, scheduleId),
              isNull(examScheduleGrades.archivedAt),
            ),
          ),
        tx
          .update(examScheduleSubjects)
          .set({ archivedAt: now, updatedAt: now })
          .where(
            and(
              eq(examScheduleSubjects.locationId, auth.locationId),
              eq(examScheduleSubjects.scheduleId, scheduleId),
              isNull(examScheduleSubjects.archivedAt),
            ),
          ),
        examIds.length === 0
          ? tx.select({ none: sql<number>`0` }).from(examSchedules).limit(0)
          : tx
              .update(exams)
              .set({ archivedAt: now, updatedAt: now })
              .where(
                and(
                  eq(exams.locationId, auth.locationId),
                  inArray(exams.id, examIds),
                ),
              ),
        examIds.length === 0
          ? tx.select({ none: sql<number>`0` }).from(examSchedules).limit(0)
          : tx
              .update(examSubjects)
              .set({ archivedAt: now, updatedAt: now })
              .where(
                and(
                  eq(examSubjects.locationId, auth.locationId),
                  inArray(examSubjects.examId, examIds),
                  isNull(examSubjects.archivedAt),
                ),
              ),
      ]);

      return apiSuccess({ scheduleId, archived: { exams: examIds.length } });
    } catch (error) {
      return handleApiError(error);
    }
  },
  { permission: 'exams.write' },
);
