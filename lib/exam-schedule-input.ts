import 'server-only';

import { and, eq, inArray } from 'drizzle-orm';

import { grades, subjects } from '@/db/schema';
import { MAX_PAPER_DURATION_MINUTES } from '@/db/schema/exam-schedule-subjects';
import { SCHEDULE_NAME_MAX } from '@/db/schema/exam-schedules';
import type { PromotionMechanism } from '@/db/schema/grade-promotion-criteria';

import { academicYearBounds } from './academics-queries';
import { getAcademicYear } from './admissions-queries';
import { db } from './drizzle';
import type { ExamTermRow } from './exam-queries';
import { gradesTakenInTerm, resolveGradeCriteria } from './exam-queries';
import { toMark } from './grading';
import { isIsoDate, isUuid, readOptionalString, readString } from './validation';

/**
 * What a datesheet has to satisfy before it is written, in one place.
 *
 * Two routes author a schedule — `POST /exam-terms/[termId]/schedules` and
 * `PATCH /exam-schedules/[scheduleId]` — and every rule in SPRINT-14-SPEC §6
 * applies to both. Split across the two routes, the second copy is the one that
 * quietly loses a rule: an edit that could set a date outside the session, or
 * put marks on a descriptor paper, would be a hole in exactly the validation
 * the create path advertises.
 *
 * The parse is pure and the school-facing checks are one function below it, so
 * a route reads as: parse, check, write.
 */

export interface ScheduleSubjectInput {
  subjectId: string;
  examDate: string;
  startTime: string | null;
  durationMinutes: number | null;
  maxMarks: number | null;
  passingMarks: number | null;
  orderIndex: number;
}

export interface ScheduleInput {
  name: string;
  startDate: string;
  endDate: string | null;
  gradeIds: string[];
  subjects: ScheduleSubjectInput[];
}

interface RawSubject {
  subjectId?: unknown;
  examDate?: unknown;
  startTime?: unknown;
  durationMinutes?: unknown;
  maxMarks?: unknown;
  passingMarks?: unknown;
  orderIndex?: unknown;
}

export interface RawScheduleBody {
  name?: unknown;
  startDate?: unknown;
  endDate?: unknown;
  gradeIds?: unknown;
  subjects?: unknown;
}

/** A whole number, or null for blank. `false` when the value is not one. */
function readOptionalInteger(value: unknown): number | null | false {
  if (value === undefined || value === null || value === '') return null;
  const parsed = typeof value === 'number' ? value : Number(value);
  if (!Number.isInteger(parsed)) return false;
  return parsed;
}

/**
 * The body as a schedule, or a sentence saying what is wrong with it.
 *
 * A string return rather than a thrown error: every caller turns it straight
 * into a 400 whose message the clerk reads, and an exception here would be
 * caught by `handleApiError` and flattened into "Something went wrong".
 */
export function parseScheduleInput(body: RawScheduleBody): ScheduleInput | string {
  const name = readString(body.name);
  if (name === '' || name.length > SCHEDULE_NAME_MAX) {
    return `Give the schedule a name of ${SCHEDULE_NAME_MAX} characters or fewer.`;
  }

  if (!isIsoDate(body.startDate)) {
    return 'Enter the day the schedule starts, as YYYY-MM-DD.';
  }
  const startDate = body.startDate;

  const endRaw = body.endDate;
  const endDate =
    endRaw === undefined || endRaw === null || endRaw === ''
      ? null
      : isIsoDate(endRaw)
        ? endRaw
        : false;
  if (endDate === false) {
    return 'Enter the day the schedule ends as YYYY-MM-DD, or leave it blank.';
  }
  if (endDate !== null && endDate < startDate) {
    return 'The schedule must end on or after it starts.';
  }

  if (!Array.isArray(body.gradeIds) || body.gradeIds.length === 0) {
    return 'Choose at least one class to sit this schedule.';
  }
  const gradeIds: string[] = [];
  for (const value of body.gradeIds) {
    if (!isUuid(value)) return 'One of those classes was not recognised.';
    if (!gradeIds.includes(value)) gradeIds.push(value);
  }

  if (!Array.isArray(body.subjects)) {
    return 'Send the subject timetable, even if it is empty.';
  }
  if (body.subjects.length > 60) {
    return 'A schedule holds at most 60 papers.';
  }

  const parsedSubjects: ScheduleSubjectInput[] = [];
  const seen = new Set<string>();

  for (const [index, raw] of (body.subjects as RawSubject[]).entries()) {
    if (!isUuid(raw.subjectId)) return 'One of those subjects was not recognised.';
    if (seen.has(raw.subjectId)) {
      return 'A subject appears twice on this schedule. One sitting per subject per datesheet.';
    }
    seen.add(raw.subjectId);

    if (!isIsoDate(raw.examDate)) {
      return 'Every paper needs a date, as YYYY-MM-DD.';
    }
    if (raw.examDate < startDate || (endDate !== null && raw.examDate > endDate)) {
      return `A paper on ${raw.examDate} falls outside the schedule's own window.`;
    }

    const duration = readOptionalInteger(raw.durationMinutes);
    if (
      duration === false ||
      (duration !== null && (duration <= 0 || duration > MAX_PAPER_DURATION_MINUTES))
    ) {
      return `A paper lasts between 1 and ${MAX_PAPER_DURATION_MINUTES} minutes, or leave it blank.`;
    }

    const maxMarks = toMark(raw.maxMarks);
    const passingMarks = toMark(raw.passingMarks);

    /*
     * The two marks are set together or not at all — checked here and not only
     * in the mechanism-aware pass further down.
     *
     * That pass knows whether this schedule wants marks by looking at its
     * assigned grades, and a schedule with no grades yet has no mechanism to
     * look at, so neither of its branches fired and a paper with a maximum and
     * no pass mark reached the database. `0029`'s CHECK then failed to stop it
     * too — see `0030` — and the error finally surfaced inside `generate`, as a
     * not-null violation on a different table naming neither the paper nor the
     * reason.
     */
    if ((maxMarks === null) !== (passingMarks === null)) {
      return maxMarks === null
        ? 'A pass mark needs a maximum to sit inside.'
        : 'A paper with a maximum needs a pass mark as well.';
    }
    if (maxMarks !== null) {
      if (maxMarks <= 0) return 'A paper is out of more than zero.';
      if (passingMarks !== null && (passingMarks < 0 || passingMarks > maxMarks)) {
        return 'The pass mark has to sit between zero and the maximum.';
      }
    }

    const order = readOptionalInteger(raw.orderIndex);
    parsedSubjects.push({
      subjectId: raw.subjectId,
      examDate: raw.examDate,
      startTime: readOptionalString(raw.startTime),
      durationMinutes: duration,
      maxMarks,
      passingMarks,
      orderIndex: order === false || order === null ? index : order,
    });
  }

  return { name, startDate, endDate, gradeIds, subjects: parsedSubjects };
}

export interface ScheduleCheck {
  /** What the whole schedule is judged by. Its grades must agree on it. */
  mechanism: PromotionMechanism;
}

/**
 * The rules that need the school's own data, checked against it.
 *
 * ── One datesheet cannot be two mechanisms ───────────────────────────────
 * A schedule groups grades that sit the same papers on the same days, and the
 * papers either carry marks or they do not. Grades whose criteria disagree
 * cannot share a datesheet: generating from it would have to write a marks
 * paper and a descriptor paper from the same row. The refusal names both
 * grades, because the fix is on the criteria screen and not on this one.
 *
 * ── Rule 3 is checked here as well as by the index ───────────────────────
 * `exam_schedule_grades_term_grade_idx` is the real guarantee — two concurrent
 * requests both pass an application-level check. This exists so the ordinary,
 * single-request case gets "Class 4 already sits the Junior schedule" instead
 * of a constraint violation rendered as a 500.
 */
export async function checkScheduleAgainstSchool(
  locationId: string,
  term: ExamTermRow,
  input: ScheduleInput,
  exceptScheduleId?: string,
): Promise<ScheduleCheck | string> {
  const year = await getAcademicYear(locationId, term.academicYearId);
  if (year === null) return 'That term has no academic year.';

  const bounds = academicYearBounds(year);
  for (const date of [input.startDate, input.endDate]) {
    if (date === null) continue;
    if (date < bounds.start || date > bounds.end) {
      return `The ${year.name} session runs ${bounds.start} to ${bounds.end}. A schedule outside it would examine children in a year they are not enrolled for.`;
    }
  }

  /*
   * The papers are bounded by the session too, not only by the schedule.
   *
   * `parseScheduleInput` bounds a paper by the schedule's own window, but the
   * end date is optional by design — so on a schedule with no end date a paper
   * had no upper bound whatsoever and `2099-01-01` was accepted onto a 2026-27
   * datesheet. The session is the outer limit in every case, and it is only
   * known here, where the year has been loaded.
   */
  for (const paper of input.subjects) {
    if (paper.examDate < bounds.start || paper.examDate > bounds.end) {
      return `A paper on ${paper.examDate} falls outside the ${year.name} session, which runs ${bounds.start} to ${bounds.end}.`;
    }
  }

  // Every id in a body is re-read through a tenant-filtered query: the foreign
  // keys alone would accept another school's grade or subject.
  const gradeRows = await db
    .select({ id: grades.id, name: grades.name, displayName: grades.displayName })
    .from(grades)
    .where(and(eq(grades.locationId, locationId), inArray(grades.id, input.gradeIds)));

  if (gradeRows.length !== input.gradeIds.length) {
    return 'One of those classes was not found.';
  }

  if (input.subjects.length > 0) {
    const subjectIds = input.subjects.map((row) => row.subjectId);
    const subjectRows = await db
      .select({ id: subjects.id })
      .from(subjects)
      .where(and(eq(subjects.locationId, locationId), inArray(subjects.id, subjectIds)));

    if (subjectRows.length !== new Set(subjectIds).size) {
      return 'One of those subjects was not found.';
    }
  }

  const taken = await gradesTakenInTerm(locationId, term.id, exceptScheduleId);
  for (const row of gradeRows) {
    const clash = taken.get(row.id);
    if (clash !== undefined) {
      const label = row.displayName ?? row.name;
      return `${label} already sits the "${clash.scheduleName}" schedule this term. A class sits one datesheet per term.`;
    }
  }

  const mechanisms = await Promise.all(
    gradeRows.map(async (row) => ({
      label: row.displayName ?? row.name,
      mechanism: (await resolveGradeCriteria(locationId, term.academicYearId, row.id))
        .mechanism,
    })),
  );

  const first = mechanisms[0];
  if (first === undefined) return 'Choose at least one class to sit this schedule.';

  const disagreeing = mechanisms.find((row) => row.mechanism !== first.mechanism);
  if (disagreeing !== undefined) {
    return `${first.label} is judged on ${first.mechanism === 'descriptors' ? 'performance descriptors' : 'marks and grades'} and ${disagreeing.label} is not. Classes judged differently need separate schedules.`;
  }

  const wantsMarks = first.mechanism === 'marks_grades';
  for (const paper of input.subjects) {
    if (wantsMarks && (paper.maxMarks === null || paper.passingMarks === null)) {
      return 'These classes are marked, so every paper needs a maximum and a pass mark.';
    }
    if (!wantsMarks && (paper.maxMarks !== null || paper.passingMarks !== null)) {
      return 'These classes are judged on performance descriptors, which carry no marks. Clear the maximum and pass mark.';
    }
  }

  return { mechanism: first.mechanism };
}
