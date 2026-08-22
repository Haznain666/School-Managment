import { randomUUID } from 'node:crypto';

import { and, countDistinct, eq, inArray, isNull } from 'drizzle-orm';

import { examResults, examSubjects, exams, sections } from '@/db/schema';
import { withSchoolAuth } from '@/lib/api-auth';
import { apiFailure, apiSuccess, handleApiError } from '@/lib/api-response';
import { batch, db, type Tx } from '@/lib/drizzle';
import { getExamSchedule, getExamTerm, resolveGradeCriteria } from '@/lib/exam-queries';
import { markToNumeric } from '@/lib/grading';
import { getSchoolUserByUid } from '@/lib/school-queries';
import { isUuid } from '@/lib/validation';

/**
 * /api/school/exam-schedules/[scheduleId]/generate
 *
 * POST turn one datesheet into every section's exam and every section's papers.
 *
 * This is the step that makes a schedule worth authoring: a school writes the
 * Junior datesheet once and eleven sections get their papers, dated and out of
 * the same maximum, instead of a clerk retyping the same eight rows eleven
 * times and getting one of them wrong.
 *
 * ── It is idempotent, and that is the whole design ───────────────────────
 * Schools press this again. They press it after adding a section in week two,
 * after moving the Maths paper, and after a teacher points out the pass mark
 * is wrong. So a re-run updates the papers that already came from this
 * schedule, creates only what is missing, and touches nothing else.
 *
 * ── It never deletes a paper carrying marks ──────────────────────────────
 * A subject dropped from the datesheet may already have a morning's marking
 * against it in one section. The paper is archived rather than removed, and
 * the response says how many carried marks — because the person who dropped
 * the subject is the only person who can decide whether that was intended, and
 * they will not find out any other way.
 *
 * ── Descriptor mode writes 1 and 0 ───────────────────────────────────────
 * `exam_subjects.max_marks` is NOT NULL with a `> 0` CHECK, which the marks
 * path depends on and which this sprint deliberately does not relax. A
 * descriptor paper is not out of anything, so it is stored as 1/0 and never
 * read: the descriptor sheet has no marks column and the report card reports
 * zero marks available for the grade. See `getSectionReportCards`.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type RouteContext = { params: Promise<{ scheduleId: string }> };

export const POST = withSchoolAuth<RouteContext>(
  async (_request, auth, context) => {
    try {
      const { scheduleId } = await context.params;
      if (!isUuid(scheduleId)) return apiFailure('not_found', 'Schedule not found.', 404);

      const schedule = await getExamSchedule(auth.locationId, scheduleId);
      if (schedule === null) return apiFailure('not_found', 'Schedule not found.', 404);

      const term = await getExamTerm(auth.locationId, schedule.termId);
      if (term === null) return apiFailure('not_found', 'Term not found.', 404);
      if (term.isArchived) {
        return apiFailure('invalid_state', 'That term has been archived.', 409);
      }
      if (schedule.subjects.length === 0) {
        return apiFailure(
          'invalid_state',
          'Add the papers to this schedule before generating exams from it.',
          409,
        );
      }

      const firstGradeId = schedule.gradeIds[0];
      if (firstGradeId === undefined) {
        return apiFailure(
          'invalid_state',
          'Assign at least one class to this schedule before generating exams from it.',
          409,
        );
      }

      // Every grade on a schedule shares its mechanism — the authoring routes
      // refuse a datesheet whose classes disagree — so the first one answers
      // for all of them.
      const criteria = await resolveGradeCriteria(
        auth.locationId,
        term.academicYearId,
        firstGradeId,
      );
      const isDescriptorMode = criteria.mechanism === 'descriptors';

      // Only the sections that actually exist for this year. A grade whose
      // sections were all closed generates nothing rather than failing.
      const sectionRows = await db
        .select({ id: sections.id, gradeId: sections.gradeId })
        .from(sections)
        .where(
          and(
            eq(sections.locationId, auth.locationId),
            inArray(sections.gradeId, schedule.gradeIds),
            eq(sections.academicYearId, term.academicYearId),
            eq(sections.isActive, true),
          ),
        );

      if (sectionRows.length === 0) {
        return apiFailure(
          'invalid_state',
          'None of those classes has an active section in this academic year.',
          409,
        );
      }

      const existingExams = await db
        .select({ id: exams.id, sectionId: exams.sectionId })
        .from(exams)
        .where(
          and(
            eq(exams.locationId, auth.locationId),
            eq(exams.scheduleId, scheduleId),
            isNull(exams.archivedAt),
          ),
        );

      const examBySection = new Map(
        existingExams.map((row) => [row.sectionId, row.id] as const),
      );

      const examIds = existingExams.map((row) => row.id);

      // Archived rows are read too: `exam_subjects_exam_id_subject_id_idx` is a
      // full unique index, so a subject dropped and then restored has to be
      // revived rather than inserted beside itself.
      const existingPapers =
        examIds.length === 0
          ? []
          : await db
              .select({
                id: examSubjects.id,
                examId: examSubjects.examId,
                subjectId: examSubjects.subjectId,
                scheduleSubjectId: examSubjects.scheduleSubjectId,
                archivedAt: examSubjects.archivedAt,
              })
              .from(examSubjects)
              .where(
                and(
                  eq(examSubjects.locationId, auth.locationId),
                  inArray(examSubjects.examId, examIds),
                ),
              );

      const markedPaperIds = new Set<string>();
      if (existingPapers.length > 0) {
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
                existingPapers.map((row) => row.id),
              ),
            ),
          )
          .groupBy(examResults.examSubjectId);

        for (const row of counted) {
          if (row.value > 0) markedPaperIds.add(row.examSubjectId);
        }
      }

      const creator = await getSchoolUserByUid(auth.locationId, auth.uid);
      const now = new Date();
      const title = `${term.name} — ${schedule.name}`;
      const wantedSubjects = new Set(schedule.subjects.map((paper) => paper.subjectId));

      const statements: Array<(tx: Tx) => PromiseLike<unknown>> = [];
      let examsCreated = 0;
      let papersCreated = 0;
      let papersUpdated = 0;
      let papersArchived = 0;
      let archivedWithMarks = 0;

      for (const section of sectionRows) {
        let examId = examBySection.get(section.id);

        if (examId === undefined) {
          examId = randomUUID();
          examsCreated += 1;
          const newExamId = examId;

          statements.push((tx) =>
            tx.insert(exams).values({
              id: newExamId,
              // Tenant from the verified session, never from a parameter.
              locationId: auth.locationId,
              termId: schedule.termId,
              gradeId: section.gradeId,
              sectionId: section.id,
              scheduleId,
              title,
              examDate: schedule.startDate,
              createdBy: creator?.id ?? null,
            }),
          );
        } else {
          const knownExamId = examId;
          statements.push((tx) =>
            tx
              .update(exams)
              .set({ title, examDate: schedule.startDate, updatedAt: now })
              .where(
                and(
                  eq(exams.locationId, auth.locationId),
                  eq(exams.id, knownExamId),
                ),
              ),
          );
        }

        const papersOfExam = existingPapers.filter((row) => row.examId === examId);
        const paperBySubject = new Map(
          papersOfExam.map((row) => [row.subjectId, row] as const),
        );

        for (const paper of schedule.subjects) {
          const values = {
            scheduleSubjectId: paper.id,
            examDate: paper.examDate,
            slot: paper.startTime,
            orderIndex: paper.orderIndex,
            maxMarks: markToNumeric(isDescriptorMode ? 1 : (paper.maxMarks ?? 1)),
            passingMarks: markToNumeric(isDescriptorMode ? 0 : (paper.passingMarks ?? 0)),
          };

          const existing = paperBySubject.get(paper.subjectId);

          if (existing === undefined) {
            papersCreated += 1;
            const owningExamId = examId;
            statements.push((tx) =>
              tx.insert(examSubjects).values({
                locationId: auth.locationId,
                examId: owningExamId,
                subjectId: paper.subjectId,
                ...values,
              }),
            );
          } else {
            papersUpdated += 1;
            const paperId = existing.id;
            statements.push((tx) =>
              tx
                .update(examSubjects)
                .set({ ...values, archivedAt: null, updatedAt: now })
                .where(
                  and(
                    eq(examSubjects.locationId, auth.locationId),
                    eq(examSubjects.id, paperId),
                  ),
                ),
            );
          }
        }

        // Papers this schedule made and this schedule no longer asks for.
        // Papers a clerk added by hand carry no `schedule_subject_id` and are
        // left alone: they were never this endpoint's to remove.
        for (const row of papersOfExam) {
          if (row.archivedAt !== null) continue;
          if (row.scheduleSubjectId === null) continue;
          if (wantedSubjects.has(row.subjectId)) continue;

          papersArchived += 1;
          if (markedPaperIds.has(row.id)) archivedWithMarks += 1;

          const paperId = row.id;
          statements.push((tx) =>
            tx
              .update(examSubjects)
              .set({ archivedAt: now, updatedAt: now })
              .where(
                and(
                  eq(examSubjects.locationId, auth.locationId),
                  eq(examSubjects.id, paperId),
                ),
              ),
          );
        }
      }

      await batch(db, (tx) => statements.map((statement) => statement(tx)));

      return apiSuccess({
        scheduleId,
        mechanism: criteria.mechanism,
        sections: sectionRows.length,
        examsCreated,
        papersCreated,
        papersUpdated,
        papersArchived,
        archivedWithMarks,
      });
    } catch (error) {
      return handleApiError(error);
    }
  },
  { permission: 'exams.write' },
);
