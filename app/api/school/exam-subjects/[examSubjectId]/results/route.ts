import { and, eq } from 'drizzle-orm';

import {
  ATTEMPT_ORIGINAL,
  ATTEMPT_RESIT,
  examResults,
  examSubjects,
  type ResitStatus,
  type ResultStatus,
} from '@/db/schema';
import { withSchoolAuth, type SchoolAuthContext } from '@/lib/api-auth';
import { apiFailure, apiSuccess, handleApiError, readJsonBody } from '@/lib/api-response';
import { batch, db, type Tx } from '@/lib/drizzle';
import {
  getExamPaper,
  getMarksSheet,
  teacherOwnsPaper,
  type ExamPaperContext,
} from '@/lib/exam-queries';
import { markToNumeric, toMark } from '@/lib/grading';
import { hasPermission } from '@/lib/permission-queries';
import { getSchoolUserByUid } from '@/lib/school-queries';
import { isUuid, readOptionalString } from '@/lib/validation';

/**
 * /api/school/exam-subjects/[examSubjectId]/results
 *
 * GET   the marks sheet — the whole section, marked or not
 * POST  save it, draft or otherwise
 * PATCH move it along: submit, publish, unpublish, open or close a re-sit
 *
 * ── Why the whole sheet at once ──────────────────────────────────────────
 * The same reason the register is marked in one request: a teacher reads down
 * a class list once. Forty separate saves would leave a half-marked paper if
 * the tab were closed part-way, and the unique key on
 * (location, paper, student, attempt) means saving twice corrects the same
 * rows rather than duplicating them.
 *
 * ── Why one route holds two permissions ──────────────────────────────────
 * `results.enter` is a teacher's; `results.publish` is not. Publishing is the
 * step the teacher cannot take, and unpublishing is the step they cannot undo
 * — that is the whole point of the split, and it is checked here rather than
 * by splitting the endpoint, so the state machine lives in one place.
 *
 * ── A teacher may only touch their own paper ─────────────────────────────
 * Derived from the timetable, exactly as attendance does it. Anyone else with
 * the permission is not narrowed: keying marks in for an absent colleague is a
 * coordinator's job.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type RouteContext = { params: Promise<{ examSubjectId: string }> };

async function teacherMayUsePaper(
  auth: SchoolAuthContext,
  examSubjectId: string,
): Promise<boolean> {
  if (auth.role !== 'teacher') return true;

  const teacher = await getSchoolUserByUid(auth.locationId, auth.uid);
  if (teacher === null) return false;

  return teacherOwnsPaper(auth.locationId, teacher.id, examSubjectId);
}

/** 1 or 2, defaulting to the original sitting. */
function readAttempt(value: unknown): number | null {
  if (value === undefined || value === null || value === '') return ATTEMPT_ORIGINAL;
  const attempt = typeof value === 'number' ? value : Number.parseInt(String(value), 10);
  return attempt === ATTEMPT_ORIGINAL || attempt === ATTEMPT_RESIT ? attempt : null;
}

/** The status column that governs the attempt being worked on. */
function statusFor(paper: ExamPaperContext, attempt: number): ResultStatus | ResitStatus {
  return attempt === ATTEMPT_RESIT ? paper.resitStatus : paper.resultsStatus;
}

export const GET = withSchoolAuth<RouteContext>(
  async (request, auth, context) => {
    try {
      const { examSubjectId } = await context.params;
      if (!isUuid(examSubjectId)) return apiFailure('not_found', 'Paper not found.', 404);

      const attempt = readAttempt(new URL(request.url).searchParams.get('attempt'));
      if (attempt === null) {
        return apiFailure('invalid_query', 'attempt must be 1 or 2.', 400);
      }

      if (!(await teacherMayUsePaper(auth, examSubjectId))) {
        return apiFailure('forbidden', 'You do not teach that paper.', 403);
      }

      const sheet = await getMarksSheet(auth.locationId, examSubjectId, attempt);
      if (sheet === null) return apiFailure('not_found', 'Paper not found.', 404);

      return apiSuccess(sheet);
    } catch (error) {
      return handleApiError(error);
    }
  },
  { permission: 'exams.read' },
);

interface MarkRecordBody {
  studentProfileId?: unknown;
  marksObtained?: unknown;
  isAbsent?: unknown;
  remarks?: unknown;
  subcategoryId?: unknown;
}

interface SaveMarksBody {
  attempt?: unknown;
  records?: unknown;
}

interface ParsedMark {
  studentProfileId: string;
  marksObtained: string | null;
  isAbsent: boolean;
  remarks: string | null;
  subcategoryId: string | null;
}

export const POST = withSchoolAuth<RouteContext>(
  async (request, auth, context) => {
    try {
      const { examSubjectId } = await context.params;
      if (!isUuid(examSubjectId)) return apiFailure('not_found', 'Paper not found.', 404);

      const body = await readJsonBody<SaveMarksBody>(request);
      if (body === null) {
        return apiFailure('invalid_body', 'Expected a JSON body.', 400);
      }

      const attempt = readAttempt(body.attempt);
      if (attempt === null) {
        return apiFailure('invalid_body', 'attempt must be 1 or 2.', 400);
      }

      if (!(await teacherMayUsePaper(auth, examSubjectId))) {
        return apiFailure('forbidden', 'You do not teach that paper.', 403);
      }

      const paper = await getExamPaper(auth.locationId, examSubjectId);
      if (paper === null) return apiFailure('not_found', 'Paper not found.', 404);

      const status = statusFor(paper, attempt);

      if (status === 'published') {
        return apiFailure(
          'invalid_state',
          'These marks are published. They can only be corrected after somebody with permission unpublishes them.',
          409,
        );
      }
      if (attempt === ATTEMPT_RESIT && status === 'none') {
        return apiFailure(
          'invalid_state',
          'No re-sit has been opened for this paper.',
          409,
        );
      }

      if (!Array.isArray(body.records) || body.records.length === 0) {
        return apiFailure('invalid_body', 'There is nothing to save.', 400);
      }
      if (body.records.length > 300) {
        return apiFailure('invalid_body', 'Save at most 300 students at a time.', 400);
      }

      // The sheet the client posted is checked against the section's real
      // roster. A student id from another class would otherwise be marked here,
      // against this paper.
      const sheet = await getMarksSheet(auth.locationId, examSubjectId, attempt);
      const roster = new Set(
        (sheet?.students ?? []).map((student) => student.studentProfileId),
      );

      // Which sheet this is, from the grade's criteria and not from the shape
      // of the payload. The two mechanisms are alternatives, and a client that
      // posted both would otherwise decide for the school which one applied.
      const isDescriptorMode = sheet?.mechanism === 'descriptors';
      const offered = new Set((sheet?.subcategories ?? []).map((row) => row.id));

      const parsed: ParsedMark[] = [];

      for (const raw of body.records as MarkRecordBody[]) {
        const studentProfileId = raw.studentProfileId;
        if (!isUuid(studentProfileId) || !roster.has(studentProfileId)) {
          return apiFailure(
            'invalid_body',
            'One of those students is not enrolled in this section.',
            400,
          );
        }

        const isAbsent = raw.isAbsent === true;
        const marks = toMark(raw.marksObtained);
        const remarks = readOptionalString(raw.remarks);
        const subcategoryId =
          raw.subcategoryId === undefined ||
          raw.subcategoryId === null ||
          raw.subcategoryId === ''
            ? null
            : raw.subcategoryId;

        if (isDescriptorMode) {
          if (marks !== null) {
            return apiFailure(
              'invalid_body',
              'This class is judged on performance descriptors, which carry no marks.',
              400,
            );
          }
          if (subcategoryId !== null && !offered.has(subcategoryId as string)) {
            return apiFailure('invalid_body', 'That sub-category was not found.', 400);
          }
          if (!isAbsent && subcategoryId === null && remarks === null) {
            // Nothing said about this child yet. Skipped rather than written
            // blank, for the same reason an empty marks box is.
            continue;
          }

          parsed.push({
            studentProfileId,
            marksObtained: null,
            isAbsent,
            remarks,
            // A child who was not there earned no descriptor.
            subcategoryId: isAbsent ? null : (subcategoryId as string | null),
          });
          continue;
        }

        if (subcategoryId !== null) {
          return apiFailure(
            'invalid_body',
            'This class is marked, and a marks sheet has no sub-category column.',
            400,
          );
        }

        if (isAbsent) {
          // Absence and a mark are contradictory, and the CHECK constraint
          // would report it as a 500. A child who did not sit the paper has no
          // mark — see db/schema/exam-results.ts.
          parsed.push({
            studentProfileId,
            marksObtained: null,
            isAbsent: true,
            remarks,
            subcategoryId: null,
          });
          continue;
        }

        if (marks === null) {
          // Not marked yet. Skipped rather than stored as zero: a blank box on
          // a half-finished sheet is not a score of nothing.
          continue;
        }

        if (marks < 0 || marks > paper.maxMarks) {
          return apiFailure(
            'invalid_body',
            `Marks must be between 0 and ${paper.maxMarks}.`,
            400,
          );
        }

        parsed.push({
          studentProfileId,
          marksObtained: markToNumeric(marks),
          isAbsent: false,
          remarks,
          subcategoryId: null,
        });
      }

      if (parsed.length === 0) {
        return apiSuccess({ saved: 0, attempt });
      }

      // Who entered it, from the verified session rather than the body — a
      // disputed mark has to be answerable.
      const enteredBy = await getSchoolUserByUid(auth.locationId, auth.uid);

      // Deferred until `batch()` opens the transaction: a Drizzle builder is
      // bound to the session that created it, so these must be built on `tx`.
      const statements = parsed.map((record) => (tx: Tx) =>
        tx
          .insert(examResults)
          .values({
            locationId: auth.locationId,
            examSubjectId,
            studentProfileId: record.studentProfileId,
            attempt,
            marksObtained: record.marksObtained,
            isAbsent: record.isAbsent,
            remarks: record.remarks,
            subcategoryId: record.subcategoryId,
            enteredBy: enteredBy?.id ?? null,
          })
          .onConflictDoUpdate({
            target: [
              examResults.locationId,
              examResults.examSubjectId,
              examResults.studentProfileId,
              examResults.attempt,
            ],
            set: {
              marksObtained: record.marksObtained,
              isAbsent: record.isAbsent,
              remarks: record.remarks,
              subcategoryId: record.subcategoryId,
              enteredBy: enteredBy?.id ?? null,
              updatedAt: new Date(),
            },
          }),
      );

      await batch(db, (tx) => statements.map((statement) => statement(tx)));

      return apiSuccess({ saved: parsed.length, attempt });
    } catch (error) {
      return handleApiError(error);
    }
  },
  { permission: 'results.enter' },
);

const ACTIONS = ['submit', 'publish', 'unpublish', 'open-resit', 'close-resit'] as const;
type Action = (typeof ACTIONS)[number];

function isAction(value: unknown): value is Action {
  return typeof value === 'string' && (ACTIONS as readonly string[]).includes(value);
}

interface TransitionBody {
  action?: unknown;
  attempt?: unknown;
}

export const PATCH = withSchoolAuth<RouteContext>(
  async (request, auth, context) => {
    try {
      const { examSubjectId } = await context.params;
      if (!isUuid(examSubjectId)) return apiFailure('not_found', 'Paper not found.', 404);

      const body = await readJsonBody<TransitionBody>(request);
      if (body === null || !isAction(body.action)) {
        return apiFailure(
          'invalid_body',
          'action must be submit, publish, unpublish, open-resit or close-resit.',
          400,
        );
      }

      const attempt = readAttempt(body.attempt);
      if (attempt === null) {
        return apiFailure('invalid_body', 'attempt must be 1 or 2.', 400);
      }

      if (!(await teacherMayUsePaper(auth, examSubjectId))) {
        return apiFailure('forbidden', 'You do not teach that paper.', 403);
      }

      const paper = await getExamPaper(auth.locationId, examSubjectId);
      if (paper === null) return apiFailure('not_found', 'Paper not found.', 404);

      // The route itself is gated on `exams.read`, and each transition asks for
      // what it actually needs. Gating the whole route on `results.enter` would
      // have locked out the principal — who publishes but does not enter — at
      // the door, which is the wrong half of the split to enforce here.
      const required = body.action === 'submit' ? 'results.enter' : 'results.publish';
      const permitted = await hasPermission(auth.locationId, auth.role, required);

      if (!permitted) {
        return apiFailure(
          'forbidden',
          body.action === 'submit'
            ? 'Your role does not enter marks.'
            : 'You may enter and submit marks. Publishing them is somebody else’s step.',
          403,
        );
      }

      const updates: Partial<typeof examSubjects.$inferInsert> = {
        updatedAt: new Date(),
      };
      const status = statusFor(paper, attempt);

      switch (body.action) {
        case 'submit': {
          if (status === 'published') {
            return apiFailure('invalid_state', 'These marks are already published.', 409);
          }
          if (status === 'none') {
            return apiFailure('invalid_state', 'No re-sit has been opened.', 409);
          }
          if (attempt === ATTEMPT_RESIT) updates.resitStatus = 'submitted';
          else updates.resultsStatus = 'submitted';
          break;
        }

        case 'publish': {
          if (status === 'none') {
            return apiFailure('invalid_state', 'No re-sit has been opened.', 409);
          }
          if (status === 'published') {
            return apiFailure('invalid_state', 'These marks are already published.', 409);
          }
          const publisher = await getSchoolUserByUid(auth.locationId, auth.uid);
          if (attempt === ATTEMPT_RESIT) updates.resitStatus = 'published';
          else {
            updates.resultsStatus = 'published';
            updates.publishedBy = publisher?.id ?? null;
            updates.publishedAt = new Date();
          }
          break;
        }

        case 'unpublish': {
          if (status !== 'published') {
            return apiFailure('invalid_state', 'These marks are not published.', 409);
          }
          // Back to `submitted`, not to `draft`: the marks are still finished
          // work, and dropping them to draft would tell the teacher to enter a
          // paper they have already entered.
          if (attempt === ATTEMPT_RESIT) updates.resitStatus = 'submitted';
          else updates.resultsStatus = 'submitted';
          break;
        }

        case 'open-resit': {
          // Only after the original is published, because that is the moment
          // the school knows who has to sit again.
          if (paper.resultsStatus !== 'published') {
            return apiFailure(
              'invalid_state',
              'Publish the original marks first — until then nobody knows who is re-sitting.',
              409,
            );
          }
          if (paper.resitStatus !== 'none') {
            return apiFailure('invalid_state', 'A re-sit is already open.', 409);
          }
          updates.resitStatus = 'draft';
          break;
        }

        case 'close-resit': {
          if (paper.resitStatus === 'none') {
            return apiFailure('invalid_state', 'There is no re-sit to close.', 409);
          }
          // Deliberately does not delete the attempt-2 rows. A re-sit closed by
          // mistake would otherwise take a morning's marking with it, and the
          // marks stop counting the moment the status is no longer `published`.
          updates.resitStatus = 'none';
          break;
        }
      }

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
  { permission: 'exams.read' },
);
