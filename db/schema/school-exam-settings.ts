import { boolean, pgTable, text, timestamp } from 'drizzle-orm/pg-core';

import { schools } from './schools';

/**
 * school_exam_settings — the two exam decisions that are institution-wide.
 *
 * One row per school, and **a missing row means the defaults below**. Nothing
 * creates this row at provisioning time and nothing may assume it exists: a
 * school that has never opened the exam settings screen behaves exactly as the
 * product did before this sprint, which is the test every default in here has
 * to pass. `getExamSettings` in `lib/exam-queries.ts` is the only reader and it
 * defaults rather than joining.
 *
 * ── color_coding_enabled ─────────────────────────────────────────────────
 * Whether a sub-category is painted or printed as plain text. Read at *render*
 * time and never copied onto a result row, which is what makes switching it off
 * retroactive across every sheet the school has ever issued — including the
 * ones already printed, the next time they are reprinted. A school that decides
 * its report cards look like a traffic light gets that back in one click, for
 * the whole archive.
 *
 * The one implementation of the decision is `components/exams/SubcategoryBadge.tsx`.
 * Two would mean the toggle is honoured on three screens out of five.
 *
 * ── teachers_can_view_legacy_results ─────────────────────────────────────
 * Whether a teacher may look at a child's results from *previous* academic
 * years. Defaults to **false**, the restrictive answer: last year's marks are
 * not this year's teacher's business by default, and a school that disagrees
 * says so deliberately. School Admin, Branch Admin and Principal are exempt —
 * a head who could not read last year's cards could not do the job.
 */
export const schoolExamSettings = pgTable('school_exam_settings', {
  /** The school's own id — the tenant key, and the primary key: one row each. */
  locationId: text('location_id')
    .primaryKey()
    .references(() => schools.locationId, { onDelete: 'cascade' }),
  colorCodingEnabled: boolean('color_coding_enabled').notNull().default(true),
  teachersCanViewLegacyResults: boolean('teachers_can_view_legacy_results')
    .notNull()
    .default(false),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export type SchoolExamSettings = typeof schoolExamSettings.$inferSelect;
export type NewSchoolExamSettings = typeof schoolExamSettings.$inferInsert;

/** What a school with no row gets. Must match the column defaults above. */
export const DEFAULT_EXAM_SETTINGS = {
  colorCodingEnabled: true,
  teachersCanViewLegacyResults: false,
} as const;
