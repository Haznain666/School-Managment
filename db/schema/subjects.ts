import {
  boolean,
  index,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

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
 * A fixed set rather than a free colour picker: these are chosen to stay
 * distinguishable from one another and to keep white text legible on top, which
 * an arbitrary hex value does not guarantee.
 */
export const SUBJECT_COLORS = [
  '#2563eb',
  '#0891b2',
  '#059669',
  '#65a30d',
  '#d97706',
  '#dc2626',
  '#db2777',
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
