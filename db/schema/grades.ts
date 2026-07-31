import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

import { branches, type CurriculumLevel } from './branches';
import { schools } from './schools';

/**
 * grades — the ladder of classes a branch teaches.
 *
 * Rows are seeded from `lib/predefined-grades.ts` for the branch's curriculum
 * (Sprint 4, Decision 1): a school may rename what a grade is *called* through
 * `display_name`, but `name` and `sort_order` come from the platform list and
 * are not editable. That keeps "Class 5" comparable across schools while still
 * letting a school print "Grade V" on its own screens.
 *
 * Grades belong to a branch rather than a school because two campuses of the
 * same school can run different boards.
 */
export const grades = pgTable(
  'grades',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /** GHL Location ID — the tenant key. */
    locationId: text('location_id')
      .notNull()
      .references(() => schools.locationId, { onDelete: 'cascade' }),
    branchId: uuid('branch_id')
      .notNull()
      .references(() => branches.id, { onDelete: 'cascade' }),
    /** Canonical name from the predefined list, e.g. `Class 5`, `O Level 1`. */
    name: text('name').notNull(),
    /** School-chosen label shown instead of `name`. Null = use `name`. */
    displayName: text('display_name'),
    curriculumLevel: text('curriculum_level').notNull().$type<CurriculumLevel>(),
    /** Position in the ladder, from the predefined list. Unique per branch. */
    sortOrder: integer('sort_order').notNull(),
    isActive: boolean('is_active').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index('grades_location_id_idx').on(table.locationId),
    index('grades_branch_id_idx').on(table.branchId),
    // Seeding upserts on this: re-running it must not duplicate the ladder.
    uniqueIndex('grades_branch_id_sort_order_idx').on(table.branchId, table.sortOrder),
    check(
      'grades_curriculum_level_check',
      sql`${table.curriculumLevel} IN ('MATRIC', 'O_LEVELS', 'A_LEVELS', 'MIXED')`,
    ),
  ],
);

export type Grade = typeof grades.$inferSelect;
export type NewGrade = typeof grades.$inferInsert;

/** What a grade should be called on screen: the override, or the canonical name. */
export function gradeLabel(grade: { name: string; displayName: string | null }): string {
  return grade.displayName === null || grade.displayName === ''
    ? grade.name
    : grade.displayName;
}
