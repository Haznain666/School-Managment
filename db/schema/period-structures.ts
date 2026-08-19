import { sql } from 'drizzle-orm';
import {
  boolean,
  index,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

import { grades } from './grades';
import { schools } from './schools';

/**
 * period_structures — a named bell schedule.
 *
 * ── Why this table exists, and what it replaces ──────────────────────────
 * `timetable_slots` used to be one flat list per school, and its own comment
 * said why: "a school rings one bell". That is true of a school with one set
 * of children in it. It stops being true the moment the same school teaches
 * Pre-Nursery and Class 10 on one campus — the infants go home at noon and sit
 * three sixty-minute periods, the seniors sit eight forty-minute ones and take
 * their interval an hour later. Under one flat list the junior grid carried
 * five rows that could never be filled, and every one of them was an invitation
 * to click.
 *
 * So a school now has as many bell schedules as it needs, each with a name an
 * administrator chose ("Junior school", "Senior school", "Ramadan timings"),
 * and the grades that run on it are assigned to it.
 *
 * ── Grades, not sections ─────────────────────────────────────────────────
 * The assignment is per grade because that is how a school actually decides it:
 * nobody rings a different bell for Class 5 A and Class 5 B. Sections inherit
 * from their grade, which also means a new section is timetabled correctly the
 * day it is created, without anyone remembering to configure it.
 *
 * ── The default, which is what makes the migration safe ──────────────────
 * Exactly one structure per school carries `is_default`. A grade nobody has
 * assigned runs on it, so every school begins with one structure holding its
 * existing periods, every grade pointing at it implicitly, and every timetable
 * grid unchanged. A school that never opens this screen never learns the
 * feature exists — which is the correct outcome for a school with one bell.
 *
 * Structures are retired with `is_active = false`, never deleted, for the same
 * reason subjects are: timetable entries reference the slots inside them.
 */
export const periodStructures = pgTable(
  'period_structures',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /** GHL Location ID — the tenant key. */
    locationId: text('location_id')
      .notNull()
      .references(() => schools.locationId, { onDelete: 'cascade' }),
    /** What the school calls it, e.g. `Junior school`, `Senior school`. */
    name: text('name').notNull(),
    /** Shown under the name on the management screen. Optional. */
    description: text('description'),
    /**
     * The structure an unassigned grade falls back to.
     *
     * Enforced one-per-school by a partial unique index rather than by the
     * application: two defaults would make "which bell does Class 3 ring"
     * depend on row order.
     */
    isDefault: boolean('is_default').notNull().default(false),
    isActive: boolean('is_active').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index('period_structures_location_id_idx').on(table.locationId),
    // Two structures called "Junior school" would make every assignment
    // ambiguous on screen, exactly as two subjects called "Physics" would.
    uniqueIndex('period_structures_location_id_name_idx').on(
      table.locationId,
      table.name,
    ),
    // One default per school, enforced by the database. Partial, so the many
    // non-default structures a school may hold do not collide with each other.
    uniqueIndex('period_structures_one_default_per_location_idx')
      .on(table.locationId)
      .where(sql`${table.isDefault}`),
  ],
);

export type PeriodStructure = typeof periodStructures.$inferSelect;
export type NewPeriodStructure = typeof periodStructures.$inferInsert;

/**
 * period_structure_grades — which grades run on which bell schedule.
 *
 * A join table rather than a column on `grades` because the screen that edits
 * it is the structure's, not the grade's: an administrator opens "Junior
 * school" and ticks the grades that belong to it. The unique index on
 * `grade_id` is what keeps that honest — a grade assigned to two structures
 * would have two contradictory timetable grids, so the assignment moves rather
 * than accumulates.
 *
 * Both sides cascade. A retired structure keeps its rows (retirement is not
 * deletion); a genuinely deleted one takes its assignments with it, and those
 * grades fall back to the default, which is the only sensible thing left.
 */
export const periodStructureGrades = pgTable(
  'period_structure_grades',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /** GHL Location ID — the tenant key. */
    locationId: text('location_id')
      .notNull()
      .references(() => schools.locationId, { onDelete: 'cascade' }),
    periodStructureId: uuid('period_structure_id')
      .notNull()
      .references(() => periodStructures.id, { onDelete: 'cascade' }),
    gradeId: uuid('grade_id')
      .notNull()
      .references(() => grades.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index('period_structure_grades_location_id_idx').on(table.locationId),
    index('period_structure_grades_structure_id_idx').on(table.periodStructureId),
    // One structure per grade. This is the invariant the whole feature rests
    // on, and it is enforced here rather than remembered in a route.
    uniqueIndex('period_structure_grades_grade_id_idx').on(table.gradeId),
  ],
);

export type PeriodStructureGrade = typeof periodStructureGrades.$inferSelect;
export type NewPeriodStructureGrade = typeof periodStructureGrades.$inferInsert;
