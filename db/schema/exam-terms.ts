import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  date,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

import { academicYears } from './academic-years';
import { gradingSchemes } from './grading-schemes';
import { schoolUsers } from './school-users';
import { schools } from './schools';

/**
 * exam_terms — the assessment window a school reports on, e.g. "First Term".
 *
 * A term is the unit a report card is issued for. Everything below it — the
 * exams, the papers, the marks — is filed against one, because a parent is
 * handed one sheet per term and not one per paper.
 *
 * `is_published` is the term-level gate on the *result*: an exam's marks can be
 * published paper by paper while teachers work through them, but no report card
 * exists until the term itself is published. That separation is what lets a
 * school correct a single subject in week three without having already put a
 * half-finished report card in front of a parent.
 *
 * `grading_scheme_id` is nullable and resolves to the school's default scheme
 * when unset. It sits here rather than on `exams` because a term is graded to
 * one standard: two papers in the same term awarding different letters for the
 * same percentage is a bug a school would spend an afternoon arguing about.
 *
 * ── The dates became optional in Sprint 14, and that is not a relaxation ──
 * The authoritative window now lives on `exam_schedules`, because it differs
 * per grade: the infant school sits its First Term in three mornings while the
 * senior school takes a fortnight, and one pair of columns cannot hold both.
 * A term-level window is still offered as an envelope for calendar views, and
 * where it is blank the UI shows the earliest start and latest end across the
 * term's schedules. Every existing term keeps the dates it was created with.
 *
 * `sequence_order` is the order a school reads its terms in, which is not the
 * order their dates imply once the dates can be absent. It is rewritten as a
 * whole list by the reorder endpoint rather than edited a row at a time.
 *
 * `archived_at` is what "Delete" does. A term is what report cards were issued
 * against, so removing the row would orphan every card ever printed from it.
 * The unique index on the name is partial on the unarchived rows, so a school
 * that archives "First Term" can create another one.
 */
export const examTerms = pgTable(
  'exam_terms',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /** The school's own id — the tenant key. */
    locationId: text('location_id')
      .notNull()
      .references(() => schools.locationId, { onDelete: 'cascade' }),
    academicYearId: uuid('academic_year_id')
      .notNull()
      .references(() => academicYears.id),
    name: text('name').notNull(),
    /** Optional envelope. Null = derived from the term's schedules. */
    startDate: date('start_date'),
    endDate: date('end_date'),
    /** The order the school reads its terms in. Unique within a year. */
    sequenceOrder: integer('sequence_order').notNull().default(0),
    /** Null = grade with the school's default scheme. */
    gradingSchemeId: uuid('grading_scheme_id').references(() => gradingSchemes.id, {
      onDelete: 'set null',
    }),
    isPublished: boolean('is_published').notNull().default(false),
    publishedAt: timestamp('published_at', { withTimezone: true }),
    archivedAt: timestamp('archived_at', { withTimezone: true }),
    /** Who archived it. Null when their account has since been removed. */
    archivedBy: uuid('archived_by').references(() => schoolUsers.id, {
      onDelete: 'set null',
    }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('exam_terms_location_id_idx').on(table.locationId),
    index('exam_terms_location_id_academic_year_idx').on(
      table.locationId,
      table.academicYearId,
    ),
    // Two "First Term"s in one year would make every report card ambiguous.
    // Partial, so archiving one frees the name for its replacement.
    uniqueIndex('exam_terms_location_year_name_idx')
      .on(table.locationId, table.academicYearId, table.name)
      .where(sql`archived_at IS NULL`),
    check(
      'exam_terms_name_length_check',
      sql`char_length(btrim(${table.name})) BETWEEN 1 AND 50`,
    ),
  ],
);

export type ExamTerm = typeof examTerms.$inferSelect;
export type NewExamTerm = typeof examTerms.$inferInsert;

/** The longest a term may be named. Enforced by a CHECK. */
export const TERM_NAME_MAX = 50;
