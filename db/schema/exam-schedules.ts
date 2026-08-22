import { sql } from 'drizzle-orm';
import {
  check,
  date,
  index,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

import { examTerms } from './exam-terms';
import { schoolUsers } from './school-users';
import { schools } from './schools';

/**
 * exam_schedules — one datesheet inside a term.
 *
 * ── Why a term is not enough ─────────────────────────────────────────────
 * Sprint 9 modelled a term as a single window with exams hung off it, and that
 * held only while every class sat the same papers on the same days. It does
 * not: an infant class finishes its First Term in three mornings and the senior
 * school takes a fortnight, and both are "First Term". A school running both
 * has two datesheets and has always had two datesheets — the product simply had
 * nowhere to put the second one.
 *
 * A schedule is that second datesheet. It carries the dates, the subject
 * timetable (`exam_schedule_subjects`) and the grades that sit it
 * (`exam_schedule_grades`). The term above it keeps the identity a report card
 * is issued against, which is why `exam_terms.start_date` became nullable in
 * migration `0029`: the authoritative dates moved down here, and a term-level
 * window is now an optional envelope for a calendar view.
 *
 * ── Archive, never delete ────────────────────────────────────────────────
 * `archived_at` is what "Delete" does on every screen in this sprint. Papers
 * generated from a schedule may already carry marks by the time somebody
 * decides the schedule was a mistake, and a cascade would take a morning's
 * marking with it. The unique indexes are partial on `archived_at IS NULL` so
 * an archived "Schedule A" does not block the next one to bear the name.
 */
export const examSchedules = pgTable(
  'exam_schedules',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /** The school's own id — the tenant key. */
    locationId: text('location_id')
      .notNull()
      .references(() => schools.locationId, { onDelete: 'cascade' }),
    termId: uuid('term_id')
      .notNull()
      .references(() => examTerms.id, { onDelete: 'cascade' }),
    /** What the school calls this datesheet, e.g. "Junior schedule". */
    name: text('name').notNull(),
    startDate: date('start_date').notNull(),
    /** Optional. A one-day schedule says so by leaving this blank. */
    endDate: date('end_date'),
    archivedAt: timestamp('archived_at', { withTimezone: true }),
    /** Who archived it. Null when their account has since been removed. */
    archivedBy: uuid('archived_by').references(() => schoolUsers.id, {
      onDelete: 'set null',
    }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('exam_schedules_location_id_idx').on(table.locationId),
    index('exam_schedules_term_id_idx').on(table.termId),
    uniqueIndex('exam_schedules_term_name_idx')
      .on(table.termId, table.name)
      .where(sql`archived_at IS NULL`),
    check(
      'exam_schedules_dates_check',
      sql`${table.endDate} IS NULL OR ${table.endDate} >= ${table.startDate}`,
    ),
    check(
      'exam_schedules_name_length_check',
      sql`char_length(btrim(${table.name})) BETWEEN 1 AND 50`,
    ),
  ],
);

export type ExamSchedule = typeof examSchedules.$inferSelect;
export type NewExamSchedule = typeof examSchedules.$inferInsert;

/** The longest a term or a schedule may be named. Enforced by a CHECK. */
export const SCHEDULE_NAME_MAX = 50;
