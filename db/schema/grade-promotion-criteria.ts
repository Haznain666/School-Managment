import { sql } from 'drizzle-orm';
import {
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

import { academicYears } from './academic-years';
import { grades } from './grades';
import { gradingSchemes } from './grading-schemes';
import { resultSubcategories } from './result-subcategories';
import { schools } from './schools';

/**
 * The two ways a school can judge a class, and they are alternatives.
 *
 *   marks_grades — the teacher enters marks. The sheet shows Subject, Marks %,
 *                  Grade and a comment. Promotion is decided by percentages.
 *   descriptors  — the teacher enters a sub-category and a comment, and **no
 *                  mark at all**. The sheet shows Subject, Sub-Category and the
 *                  comment. Promotion is decided by how many subjects fall in
 *                  the failing descriptor.
 *
 * There is no third mode and no mixture. A descriptor grade has no marks, no
 * percentages and no letter grades anywhere — not on screen, not on the printed
 * card — and a marks grade has no sub-category column at all. That was settled
 * explicitly with the product owner: two separate sheets.
 */
export const PROMOTION_MECHANISMS = ['marks_grades', 'descriptors'] as const;
export type PromotionMechanism = (typeof PROMOTION_MECHANISMS)[number];

export const PROMOTION_MECHANISM_LABELS: Record<PromotionMechanism, string> = {
  marks_grades: 'Marks and grades',
  descriptors: 'Performance descriptors',
};

export function isPromotionMechanism(value: unknown): value is PromotionMechanism {
  return (
    typeof value === 'string' &&
    (PROMOTION_MECHANISMS as readonly string[]).includes(value)
  );
}

/**
 * grade_promotion_criteria — which mechanism a class is judged by, and the bar.
 *
 * Keyed on (school, academic year, grade) because both halves change: a school
 * may run Grade 3 on descriptors this year and on marks next, and Grade 3 and
 * Grade 8 are almost never judged the same way in the same year.
 *
 * ── A grade with no row is not a broken grade ────────────────────────────
 * It falls back to `DEFAULT_CRITERIA` in `lib/promotion-criteria.ts`:
 * `marks_grades`, the school's default grading scheme, and no thresholds at
 * all. That is exactly how the product behaved before this table existed, so a
 * school that never opens the criteria screen sees no change whatsoever.
 *
 * ── A null criterion is not applied ──────────────────────────────────────
 * Not "treated as zero" — *not applied*. A grade whose row sets only
 * `min_overall_percentage` is judged on that and nothing else. A row with every
 * threshold null computes `promoted` for everybody, because this product has
 * never withheld a promotion by itself and this sprint must not start doing so
 * silently, on a screen a school filled in half of.
 *
 * The columns are grouped by the mechanism that reads them. The other
 * mechanism's columns are left null rather than being enforced null by a
 * CHECK — a school flipping Grade 3 to descriptors for a term and back should
 * not lose the percentages it spent an afternoon agreeing.
 */
export const gradePromotionCriteria = pgTable(
  'grade_promotion_criteria',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /** The school's own id — the tenant key. */
    locationId: text('location_id')
      .notNull()
      .references(() => schools.locationId, { onDelete: 'cascade' }),
    academicYearId: uuid('academic_year_id')
      .notNull()
      .references(() => academicYears.id),
    gradeId: uuid('grade_id')
      .notNull()
      .references(() => grades.id),
    mechanism: text('mechanism').notNull().$type<PromotionMechanism>(),

    // -- marks_grades ------------------------------------------------------
    /** Null = the school's default scheme, exactly as a term resolves one. */
    gradingSchemeId: uuid('grading_scheme_id').references(() => gradingSchemes.id, {
      onDelete: 'set null',
    }),
    /** Promoted when the overall percentage reaches this. Null = not a factor. */
    minOverallPercentage: numeric('min_overall_percentage', { precision: 5, scale: 2 }),
    /** Not promoted above this many failed subjects. Null = no limit. */
    maxFailedSubjects: integer('max_failed_subjects'),

    // -- descriptors -------------------------------------------------------
    /** The descriptor that counts as a fail, e.g. "Needs Improvement". */
    failingSubcategoryId: uuid('failing_subcategory_id').references(
      () => resultSubcategories.id,
      { onDelete: 'set null' },
    ),
    /** Not promoted above this many failing subjects. Null = not a factor. */
    maxFailingSubjects: integer('max_failing_subjects'),

    // -- both --------------------------------------------------------------
    /** Null = attendance is not a promotion factor at this school. */
    minAttendancePercentage: numeric('min_attendance_percentage', {
      precision: 5,
      scale: 2,
    }),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('grade_promotion_criteria_location_idx').on(table.locationId),
    // The upsert target: the criteria screen writes one row per grade per year.
    uniqueIndex('grade_promotion_criteria_year_grade_idx').on(
      table.locationId,
      table.academicYearId,
      table.gradeId,
    ),
    check(
      'grade_promotion_criteria_mechanism_check',
      sql`${table.mechanism} IN ('marks_grades', 'descriptors')`,
    ),
    check(
      'grade_promotion_criteria_pct_check',
      sql`(${table.minOverallPercentage} IS NULL OR (${table.minOverallPercentage} >= 0 AND ${table.minOverallPercentage} <= 100)) AND (${table.minAttendancePercentage} IS NULL OR (${table.minAttendancePercentage} >= 0 AND ${table.minAttendancePercentage} <= 100))`,
    ),
  ],
);

export type GradePromotionCriteria = typeof gradePromotionCriteria.$inferSelect;
export type NewGradePromotionCriteria = typeof gradePromotionCriteria.$inferInsert;
