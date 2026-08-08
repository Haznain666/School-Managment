import { sql } from 'drizzle-orm';
import {
  check,
  date,
  index,
  integer,
  numeric,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

import { exams } from './exams';
import { schoolUsers } from './school-users';
import { schools } from './schools';
import { subjects } from './subjects';

/**
 * The lifecycle one paper's marks go through.
 *
 *   draft      — the teacher is entering. Nobody else sees a number.
 *   submitted  — the teacher says they are finished. Still editable by them.
 *   published  — locked. This is what report cards and tabulation sheets read.
 *
 * `submitted` exists because "the teacher is done" and "the school has checked
 * it" are different claims made by different people, and a single boolean
 * would force whoever publishes to guess which papers are ready.
 */
export const RESULT_STATUSES = ['draft', 'submitted', 'published'] as const;
export type ResultStatus = (typeof RESULT_STATUSES)[number];

export const RESULT_STATUS_LABELS: Record<ResultStatus, string> = {
  draft: 'Draft',
  submitted: 'Submitted for review',
  published: 'Published',
};

/**
 * The same lifecycle for the re-sit, plus the state of not having one.
 *
 * Re-sits are tracked separately rather than as a second row: a re-sit is the
 * same paper sat again, and modelling it as another exam would double every
 * tabulation sheet and make "position in class" ambiguous. It also has to be
 * publishable on its own — a re-sit sat in week six must not force the whole
 * paper back into draft, and its marks must not appear the moment they are
 * typed simply because the original was already published.
 */
export const RESIT_STATUSES = ['none', 'draft', 'submitted', 'published'] as const;
export type ResitStatus = (typeof RESIT_STATUSES)[number];

export const RESIT_STATUS_LABELS: Record<ResitStatus, string> = {
  none: 'No re-sit',
  draft: 'Re-sit in progress',
  submitted: 'Re-sit submitted',
  published: 'Re-sit published',
};

/**
 * exam_subjects — one paper within an exam.
 *
 * `max_marks` and `passing_marks` are NUMERIC and frozen here rather than read
 * from a subject: a school that runs Mathematics out of 100 in the first term
 * and out of 75 in the second must keep both answers, and a percentage
 * recomputed later against the wrong denominator is a report card that
 * silently changes after it was handed out.
 *
 * `slot` is free text — "Morning", "9:00 AM", "Session II". Schools name their
 * sittings in ways no enumeration survives, and it is only ever printed.
 */
export const examSubjects = pgTable(
  'exam_subjects',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /** The school's own id — the tenant key. */
    locationId: text('location_id')
      .notNull()
      .references(() => schools.locationId, { onDelete: 'cascade' }),
    examId: uuid('exam_id')
      .notNull()
      .references(() => exams.id, { onDelete: 'cascade' }),
    subjectId: uuid('subject_id')
      .notNull()
      .references(() => subjects.id),
    maxMarks: numeric('max_marks', { precision: 6, scale: 2 }).notNull(),
    passingMarks: numeric('passing_marks', { precision: 6, scale: 2 }).notNull(),
    /** This paper's own date. Null = the exam's date. */
    examDate: date('exam_date'),
    /** The sitting, as the school words it. Printed on the admit card. */
    slot: text('slot'),
    /** Order on the datesheet, the tabulation sheet and the report card. */
    orderIndex: integer('order_index').notNull().default(0),
    resultsStatus: text('results_status')
      .notNull()
      .default('draft')
      .$type<ResultStatus>(),
    resitStatus: text('resit_status').notNull().default('none').$type<ResitStatus>(),
    /** Who signed off the marks. Null while nobody has. */
    publishedBy: uuid('published_by').references(() => schoolUsers.id, {
      onDelete: 'set null',
    }),
    publishedAt: timestamp('published_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('exam_subjects_location_id_idx').on(table.locationId),
    index('exam_subjects_exam_id_idx').on(table.examId),
    // One paper per subject per exam. A school that examines a subject twice in
    // a term schedules two exams, which is what its two datesheets say.
    uniqueIndex('exam_subjects_exam_id_subject_id_idx').on(table.examId, table.subjectId),
    check(
      'exam_subjects_results_status_check',
      sql`${table.resultsStatus} IN ('draft', 'submitted', 'published')`,
    ),
    check(
      'exam_subjects_resit_status_check',
      sql`${table.resitStatus} IN ('none', 'draft', 'submitted', 'published')`,
    ),
    check(
      'exam_subjects_marks_check',
      sql`${table.maxMarks} > 0 AND ${table.passingMarks} >= 0 AND ${table.passingMarks} <= ${table.maxMarks}`,
    ),
  ],
);

export type ExamSubject = typeof examSubjects.$inferSelect;
export type NewExamSubject = typeof examSubjects.$inferInsert;

export function isResultStatus(value: unknown): value is ResultStatus {
  return (
    typeof value === 'string' && (RESULT_STATUSES as readonly string[]).includes(value)
  );
}

export function isResitStatus(value: unknown): value is ResitStatus {
  return typeof value === 'string' && (RESIT_STATUSES as readonly string[]).includes(value);
}
