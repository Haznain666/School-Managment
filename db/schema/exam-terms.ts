import {
  boolean,
  date,
  index,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

import { academicYears } from './academic-years';
import { gradingSchemes } from './grading-schemes';
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
    startDate: date('start_date').notNull(),
    endDate: date('end_date').notNull(),
    /** Null = grade with the school's default scheme. */
    gradingSchemeId: uuid('grading_scheme_id').references(() => gradingSchemes.id, {
      onDelete: 'set null',
    }),
    isPublished: boolean('is_published').notNull().default(false),
    publishedAt: timestamp('published_at', { withTimezone: true }),
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
    uniqueIndex('exam_terms_location_year_name_idx').on(
      table.locationId,
      table.academicYearId,
      table.name,
    ),
  ],
);

export type ExamTerm = typeof examTerms.$inferSelect;
export type NewExamTerm = typeof examTerms.$inferInsert;
