import { sql } from 'drizzle-orm';
import { index, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';

import { examSchedules } from './exam-schedules';
import { examTerms } from './exam-terms';
import { grades } from './grades';
import { schools } from './schools';

/**
 * exam_schedule_grades — which classes sit which datesheet.
 *
 * ── Why `term_id` is here as well as on the schedule ─────────────────────
 * The rule is that a grade belongs to **at most one schedule per term**, and
 * that is a uniqueness constraint spanning the *term*, not the schedule. With
 * only `schedule_id` on the row, Postgres has nothing to key on and the rule
 * collapses into an application-level "check, then insert" — which two
 * concurrent requests both pass, leaving Grade 4 on two datesheets and a
 * generate step that writes two sets of papers for the same children.
 *
 * So the term is denormalised onto the row and carries the partial unique
 * index. The API still checks it first and answers with a sentence naming the
 * other schedule, because a constraint violation reaching a clerk is a 500.
 *
 * ── Archiving is not optional ────────────────────────────────────────────
 * Archiving a schedule must set `archived_at` on its grade rows in the same
 * transaction. Miss that and the grade stays locked out of every future
 * schedule in the term by an index nobody can see, and the message the clerk
 * gets names a schedule that no longer appears on their screen.
 */
export const examScheduleGrades = pgTable(
  'exam_schedule_grades',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /** The school's own id — the tenant key. */
    locationId: text('location_id')
      .notNull()
      .references(() => schools.locationId, { onDelete: 'cascade' }),
    scheduleId: uuid('schedule_id')
      .notNull()
      .references(() => examSchedules.id, { onDelete: 'cascade' }),
    /** Denormalised from the schedule so the one-schedule-per-term rule is an index. */
    termId: uuid('term_id')
      .notNull()
      .references(() => examTerms.id, { onDelete: 'cascade' }),
    gradeId: uuid('grade_id')
      .notNull()
      .references(() => grades.id),
    archivedAt: timestamp('archived_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('exam_schedule_grades_location_id_idx').on(table.locationId),
    index('exam_schedule_grades_schedule_idx').on(table.scheduleId),
    uniqueIndex('exam_schedule_grades_term_grade_idx')
      .on(table.termId, table.gradeId)
      .where(sql`archived_at IS NULL`),
  ],
);

export type ExamScheduleGrade = typeof examScheduleGrades.$inferSelect;
export type NewExamScheduleGrade = typeof examScheduleGrades.$inferInsert;
