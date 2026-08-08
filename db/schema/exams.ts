import {
  boolean,
  date,
  index,
  pgTable,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';

import { examTerms } from './exam-terms';
import { grades } from './grades';
import { schoolUsers } from './school-users';
import { schools } from './schools';
import { sections } from './sections';

/**
 * exams — one term's examination for one section.
 *
 * ── Why the section is required ──────────────────────────────────────────
 * A grade-wide exam would be the tidier model on paper, but every artefact
 * this sprint ships is per section: the tabulation sheet is a class grid,
 * "position in class" is a rank inside one, and a report card prints a
 * position. Making the section optional would leave every one of those with a
 * null case to invent an answer for. A school running the same paper across
 * three sections creates three exams, which is also what its three tabulation
 * sheets say it did.
 *
 * `grade_id` is stored as well as being reachable through the section. It is
 * what the exam list filters on, and denormalising one uuid is cheaper than a
 * join on every page that offers a grade picker.
 *
 * ── is_published is the datesheet, not the results ───────────────────────
 * Publishing an exam announces *when* it is: it is what makes admit cards
 * issuable and what a student portal would show. Results are published per
 * paper on `exam_subjects`, and the report card is gated by the term. Three
 * gates, three different audiences, and collapsing them would mean a school
 * could not tell students the timetable without also showing them marks that
 * do not exist yet.
 */
export const exams = pgTable(
  'exams',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /** The school's own id — the tenant key. */
    locationId: text('location_id')
      .notNull()
      .references(() => schools.locationId, { onDelete: 'cascade' }),
    termId: uuid('term_id')
      .notNull()
      .references(() => examTerms.id, { onDelete: 'cascade' }),
    gradeId: uuid('grade_id')
      .notNull()
      .references(() => grades.id),
    sectionId: uuid('section_id')
      .notNull()
      .references(() => sections.id),
    title: text('title').notNull(),
    /** The day the exam starts. Individual papers may carry their own date. */
    examDate: date('exam_date').notNull(),
    /** Printed on the admit card, e.g. "Bring your own geometry set." */
    instructions: text('instructions'),
    isPublished: boolean('is_published').notNull().default(false),
    publishedAt: timestamp('published_at', { withTimezone: true }),
    /** Who scheduled it. Null when their account has since been removed. */
    createdBy: uuid('created_by').references(() => schoolUsers.id, {
      onDelete: 'set null',
    }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('exams_location_id_idx').on(table.locationId),
    index('exams_location_id_term_idx').on(table.locationId, table.termId),
    index('exams_location_id_section_idx').on(table.locationId, table.sectionId),
    index('exams_location_id_grade_idx').on(table.locationId, table.gradeId),
  ],
);

export type Exam = typeof exams.$inferSelect;
export type NewExam = typeof exams.$inferInsert;
