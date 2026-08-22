import {
  boolean,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

import { academicYears } from './academic-years';
import { grades } from './grades';
import { schools } from './schools';
import { staff } from './staff';

/**
 * sections — one teaching group inside a grade, for one academic year.
 *
 * Sections are per-year rather than permanent because their shape changes:
 * a school that ran Class 5 A and B last year may need A, B and C this year,
 * and last year's enrolments must keep pointing at last year's sections.
 *
 * `capacity` is advisory — the enrolment API warns when a section is full but
 * does not refuse, because a real school does over-admit and would otherwise
 * be locked out of recording it.
 *
 * `class_teacher_id` (Sprint 14) is the one member of staff who owns this
 * class. It is what decides who may override a promotion status for a child in
 * it — an authority that comes from the assignment and not from a role key, so
 * `results.promotion` is deliberately not granted to `teacher`. Only staff
 * carrying `staff.is_class_teacher` are offered here, and the column is
 * `ON DELETE SET NULL` because a class that loses its teacher is a class
 * waiting for one, not a class that should vanish.
 */
export const sections = pgTable(
  'sections',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /** GHL Location ID — the tenant key. */
    locationId: text('location_id')
      .notNull()
      .references(() => schools.locationId, { onDelete: 'cascade' }),
    gradeId: uuid('grade_id')
      .notNull()
      .references(() => grades.id, { onDelete: 'cascade' }),
    academicYearId: uuid('academic_year_id')
      .notNull()
      .references(() => academicYears.id, { onDelete: 'cascade' }),
    /** e.g. `A`, `B`, `Blue`. */
    name: text('name').notNull(),
    /** Maximum students. Null = unlimited. */
    capacity: integer('capacity'),
    /** The home-room teacher. Null while the class has not been given one. */
    classTeacherId: uuid('class_teacher_id').references(() => staff.id, {
      onDelete: 'set null',
    }),
    isActive: boolean('is_active').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index('sections_location_id_idx').on(table.locationId),
    index('sections_grade_id_academic_year_id_idx').on(
      table.gradeId,
      table.academicYearId,
    ),
    index('sections_class_teacher_id_idx').on(table.classTeacherId),
    uniqueIndex('sections_grade_id_academic_year_id_name_idx').on(
      table.gradeId,
      table.academicYearId,
      table.name,
    ),
  ],
);

export type Section = typeof sections.$inferSelect;
export type NewSection = typeof sections.$inferInsert;
