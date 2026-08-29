import {
  boolean,
  index,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

import { branches } from './branches';
import { schools } from './schools';

/**
 * subjects — what a school teaches.
 *
 * Subjects belong to the school rather than to a grade or a year: "Mathematics"
 * is the same head whether it is taught in Class 1 or Class 10, and a timetable
 * that had to re-declare it per grade would fragment the one name a report card
 * needs to group by.
 *
 * `color` is not decoration. A weekly grid of thirty-five cells is unreadable as
 * plain text, and the colour is what lets a teacher find their own period at a
 * glance — so it is stored with the subject rather than picked per screen.
 *
 * Subjects are retired with `is_active = false`, never deleted: timetable
 * entries and (later) marks reference them, and a deleted row would take the
 * meaning of last year's schedule with it.
 */
export const subjects = pgTable(
  'subjects',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /** GHL Location ID — the tenant key. */
    locationId: text('location_id')
      .notNull()
      .references(() => schools.locationId, { onDelete: 'cascade' }),
    /**
     * The campus that owns this subject, or null when the whole school shares
     * it — Sprint 19a, decision D1.
     *
     * Every existing row is null and null is what a write naming no campus
     * produces, so nothing changes for any school on the day this deploys.
     * Read it through `lib/branch-scope.ts`, never with a bare `eq`: that hides
     * every shared row, which at most schools is all of them.
     *
     * `ON DELETE SET NULL`, never cascade. Closing a campus must not delete the
     * school's subject list; a row whose campus is gone becomes shared, which
     * is the safe direction.
     */
    branchId: uuid('branch_id').references(() => branches.id, {
      onDelete: 'set null',
    }),
    name: text('name').notNull(),
    /** Short code shown in the timetable grid, e.g. `MATH`. Null = use `name`. */
    code: text('code'),
    /** `#rrggbb`, from `SUBJECT_COLORS`. Null = the neutral chip. */
    color: text('color'),
    isActive: boolean('is_active').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index('subjects_location_id_idx').on(table.locationId),
    index('subjects_location_branch_idx').on(table.locationId, table.branchId),
    // Two subjects called "Physics" in one school would make every timetable
    // ambiguous. The name is unique per school, not globally.
    uniqueIndex('subjects_location_id_name_idx').on(table.locationId, table.name),
  ],
);

export type Subject = typeof subjects.$inferSelect;
export type NewSubject = typeof subjects.$inferInsert;

/**
 * The palette offered when creating a subject.
 *
 * Eight presets, chosen to stay distinguishable from one another in a grid of
 * thirty-five cells and to carry legible lettering. A subject may also take any
 * `#rrggbb` a school picks — this column always accepted one, and the form now
 * offers it — but the presets are what one click gets, and they are the ones
 * this product is prepared to vouch for.
 *
 * ⚠ Every entry here must clear `MIN_CONTRAST_RATIO` against the lettering
 * `readableForeground` will pick for it. `npm run check-sprint-periods`
 * asserts it, and that assertion caught the pink: `#db2777` reached only
 * 4.39:1 against either candidate — it had been in the palette since Sprint 6
 * and no build, type-check or screenshot had ever objected. It is now
 * `#be185d` (5.77:1). Subjects already saved with the old value keep it;
 * nothing rewrites stored colours, and the grid computes legible lettering for
 * whatever it finds.
 */
export const SUBJECT_COLORS = [
  '#2563eb',
  '#0891b2',
  '#059669',
  '#65a30d',
  '#d97706',
  '#dc2626',
  '#be185d',
  '#7c3aed',
] as const;

const HEX_COLOR_PATTERN = /^#[0-9a-f]{6}$/i;

/** True for a `#rrggbb` string. Guards the colour before it reaches the DB. */
export function isHexColor(value: unknown): value is string {
  return typeof value === 'string' && HEX_COLOR_PATTERN.test(value);
}

/** What to print in a narrow timetable cell: the code when set, else the name. */
export function subjectShortLabel(subject: {
  name: string;
  code: string | null;
}): string {
  return subject.code === null || subject.code === '' ? subject.name : subject.code;
}
