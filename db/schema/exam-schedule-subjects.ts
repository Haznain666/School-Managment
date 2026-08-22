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

import { examSchedules } from './exam-schedules';
import { schools } from './schools';
import { subjects } from './subjects';

/**
 * exam_schedule_subjects — the datesheet itself, one row per paper.
 *
 * This is what a school pins to the noticeboard: subject, day, time, how long,
 * and what it is out of. It is authored once against the schedule and copied
 * onto every section's `exam_subjects` row by the generate step, which is what
 * makes "move the Maths paper to Thursday" one edit rather than one per class.
 *
 * ── Where max marks live, and why here ───────────────────────────────────
 * A schedule groups the grades that sit the *same* paper on the *same* day, so
 * they share the maximum. A school needing Mathematics out of 50 for Grade 4
 * and out of 100 for Grade 5 puts them in two schedules — which is also what
 * its two datesheets say, so nothing is being forced.
 *
 * Both marks columns are nullable, and that is the descriptor mechanism: a
 * grade judged on performance descriptors has no marks at all, and a NOT NULL
 * here would make the only valid descriptor datesheet unwritable. The CHECK
 * keeps the pair honest — either both are absent, or the maximum is positive
 * and the pass mark sits inside it.
 *
 * `start_time` is free text for the same reason `exam_subjects.slot` is:
 * schools write "9:00 AM", "Morning" and "Session II", no enumeration survives
 * contact with that, and the value is only ever printed.
 */
export const examScheduleSubjects = pgTable(
  'exam_schedule_subjects',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /** The school's own id — the tenant key. */
    locationId: text('location_id')
      .notNull()
      .references(() => schools.locationId, { onDelete: 'cascade' }),
    scheduleId: uuid('schedule_id')
      .notNull()
      .references(() => examSchedules.id, { onDelete: 'cascade' }),
    subjectId: uuid('subject_id')
      .notNull()
      .references(() => subjects.id),
    examDate: date('exam_date').notNull(),
    /** As the school words it, e.g. "09:00". Printed, never parsed. */
    startTime: text('start_time'),
    durationMinutes: integer('duration_minutes'),
    /** Null in descriptor mode — a descriptor paper is not out of anything. */
    maxMarks: numeric('max_marks', { precision: 6, scale: 2 }),
    passingMarks: numeric('passing_marks', { precision: 6, scale: 2 }),
    /** Order on the datesheet, the tabulation sheet and the report card. */
    orderIndex: integer('order_index').notNull().default(0),
    archivedAt: timestamp('archived_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('exam_schedule_subjects_location_id_idx').on(table.locationId),
    index('exam_schedule_subjects_schedule_idx').on(table.scheduleId),
    // One sitting per subject per datesheet. A school examining a subject twice
    // in a term writes two schedules, which is what its two datesheets say.
    uniqueIndex('exam_schedule_subjects_schedule_subject_idx')
      .on(table.scheduleId, table.subjectId)
      .where(sql`archived_at IS NULL`),
    check(
      'exam_schedule_subjects_duration_check',
      sql`${table.durationMinutes} IS NULL OR (${table.durationMinutes} > 0 AND ${table.durationMinutes} <= 600)`,
    ),
    /*
     * Both marks columns are set together or neither is — and `num_nonnulls`
     * is what makes that true rather than merely readable.
     *
     * The obvious spelling of this rule is
     *
     *   (max IS NULL AND passing IS NULL) OR (max > 0 AND passing >= 0 AND …)
     *
     * and it enforced nothing at all in the half-configured case. With
     * `max = 100, passing = NULL` the first branch is FALSE and the second is
     * `TRUE AND NULL AND NULL` = NULL, so the whole expression is NULL — and a
     * Postgres CHECK only rejects a row when it evaluates to FALSE. The
     * constraint read like a pairing rule and permitted exactly the state it
     * was written to forbid; migration `0030` replaces it.
     *
     * That state is not survivable further down: `exam_subjects.passing_marks`
     * is NOT NULL, so `generate` died on it later, naming neither the paper nor
     * the reason. Counting the non-nulls keeps the comparison out of the
     * three-valued path entirely.
     */
    check(
      'exam_schedule_subjects_marks_check',
      sql`num_nonnulls(${table.maxMarks}, ${table.passingMarks}) = 0 OR (num_nonnulls(${table.maxMarks}, ${table.passingMarks}) = 2 AND ${table.maxMarks} > 0 AND ${table.passingMarks} >= 0 AND ${table.passingMarks} <= ${table.maxMarks})`,
    ),
  ],
);

export type ExamScheduleSubject = typeof examScheduleSubjects.$inferSelect;
export type NewExamScheduleSubject = typeof examScheduleSubjects.$inferInsert;

/** The longest paper a school may schedule, in minutes. Enforced by a CHECK. */
export const MAX_PAPER_DURATION_MINUTES = 600;
