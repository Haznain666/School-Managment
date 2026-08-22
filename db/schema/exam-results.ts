import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  index,
  integer,
  numeric,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

import { examSubjects } from './exam-subjects';
import { resultSubcategories } from './result-subcategories';
import { schoolUsers } from './school-users';
import { schools } from './schools';
import { studentProfiles } from './student-profiles';

/** The original sitting. */
export const ATTEMPT_ORIGINAL = 1;
/** The re-sit. There is deliberately no third. */
export const ATTEMPT_RESIT = 2;

/**
 * exam_results — one student's mark for one paper.
 *
 * ── Absence is not a zero ────────────────────────────────────────────────
 * `is_absent` is a column and `marks_obtained` is nullable, because "did not
 * sit the paper" and "sat it and scored nothing" are different facts about a
 * child and a school is asked about both. Zero is a real mark here, so it
 * cannot double as the absent marker the way it could in a money column.
 *
 * What the aggregates then do with an absence is a policy, and it is written
 * down in `lib/exam-queries.ts` rather than inferred: the paper still counts
 * towards the total marks available, the child contributes nothing to the
 * marks obtained, and they take **no position in class** — a school does not
 * rank a child who missed a paper against children who sat all of them. The
 * report card prints the absence rather than hiding it inside a percentage.
 *
 * ── One row per attempt, never an overwrite ──────────────────────────────
 * A re-sit is `attempt = 2` against the same paper. The original mark stays,
 * because "failed and then passed on the re-sit" is a fact a school has to be
 * able to produce a year later, and an UPDATE would erase it. The unique key
 * on (location, paper, student, attempt) is what makes marks entry a safe
 * upsert: saving the sheet again corrects the same rows.
 *
 * Attempts are capped at 2 by a CHECK. A school that examines a student a third
 * time is running a different exam, and should schedule one — otherwise
 * "position in class" quietly starts depending on how many goes each child had.
 *
 * `entered_by` is kept for the same reason `attendance_records.marked_by` is: a
 * disputed mark has to be answerable.
 *
 * ── subcategory_id, and the CHECK that had to be relaxed ─────────────────
 * In descriptor mode the result *is* the sub-category: there is no mark, and
 * `remarks` carries the subject-wise comment beside it. There is deliberately
 * no second comment column — `remarks` already existed and already meant this.
 *
 * The original CHECK read "absent with no mark, or present with a mark", which
 * made the only valid descriptor row unwritable: the child was present and
 * there is no mark to give. It is now "a mark, if present, is not negative, and
 * an absence never carries one" — which keeps the fact that mattered and drops
 * the one that stopped holding the moment marks became optional.
 */
export const examResults = pgTable(
  'exam_results',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /** The school's own id — the tenant key. */
    locationId: text('location_id')
      .notNull()
      .references(() => schools.locationId, { onDelete: 'cascade' }),
    examSubjectId: uuid('exam_subject_id')
      .notNull()
      .references(() => examSubjects.id, { onDelete: 'cascade' }),
    studentProfileId: uuid('student_profile_id')
      .notNull()
      .references(() => studentProfiles.id, { onDelete: 'cascade' }),
    /** 1 = the original sitting, 2 = the re-sit. */
    attempt: integer('attempt').notNull().default(ATTEMPT_ORIGINAL),
    /** Null when absent. Never zero to mean "did not sit". */
    marksObtained: numeric('marks_obtained', { precision: 6, scale: 2 }),
    isAbsent: boolean('is_absent').notNull().default(false),
    /** Descriptor mode: the performance descriptor this paper earned. */
    subcategoryId: uuid('subcategory_id').references(() => resultSubcategories.id, {
      onDelete: 'set null',
    }),
    /** The subject-wise comment, in both mechanisms. */
    remarks: text('remarks'),
    /** Who entered it. Null when their account has since been removed. */
    enteredBy: uuid('entered_by').references(() => schoolUsers.id, {
      onDelete: 'set null',
    }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('exam_results_location_id_idx').on(table.locationId),
    index('exam_results_exam_subject_id_idx').on(table.examSubjectId),
    index('exam_results_location_id_student_idx').on(
      table.locationId,
      table.studentProfileId,
    ),
    uniqueIndex('exam_results_paper_student_attempt_idx').on(
      table.locationId,
      table.examSubjectId,
      table.studentProfileId,
      table.attempt,
    ),
    check('exam_results_attempt_check', sql`${table.attempt} IN (1, 2)`),
    check(
      'exam_results_marks_check',
      sql`(${table.marksObtained} IS NULL OR ${table.marksObtained} >= 0) AND NOT (${table.isAbsent} AND ${table.marksObtained} IS NOT NULL)`,
    ),
  ],
);

export type ExamResult = typeof examResults.$inferSelect;
export type NewExamResult = typeof examResults.$inferInsert;
