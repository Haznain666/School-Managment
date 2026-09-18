import { sql } from 'drizzle-orm';
import {
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
import { schoolUsers } from './school-users';
import { schools } from './schools';
import { sections } from './sections';
import { timetableEntries } from './timetable-entries';
import { timetableSlots } from './timetable-slots';

/**
 * timetable_substitutions — somebody covering one period, on one date.
 *
 * Sprint 33c, C4. Migration `0049`.
 *
 * ── A substitution is for one day, and must never become the timetable ───
 * This is the single most important thing about this table and it is why it is
 * a table at all rather than an edit. A teacher covering Tuesday's Maths is
 * **not** the teacher of Tuesday's Maths. Writing cover into `timetable_entries`
 * would put them there every Tuesday until somebody noticed, would change who
 * the parents' portal names as their child's teacher, would change who chat
 * says they may write to, and — since `0049` — would open a new version of the
 * cell, recording a permanent change nobody asked for. So `cover_date` is NOT
 * NULL, nothing here is read by any grid, and `POST …/substitutions` never
 * touches `timetable_entries`.
 *
 * ── Both the entry and the cell, and why both ────────────────────────────
 * `entry_id` is the lesson the cover was arranged **from**, kept for
 * provenance and set null if that row ever goes. The (section, slot, day)
 * triple is what the cover is actually **about**, and it is NOT NULL: a
 * standing lesson can be superseded or cleared between arranging the cover and
 * the morning it is needed, and cover that evaporated because the row it
 * pointed at was replaced is a class nobody turns up to.
 *
 * ── `original_teacher_id` is recorded, not re-derived ────────────────────
 * Asking the grid months later who "the" teacher was would answer with whoever
 * takes the period *now* — exactly the class of defect `0049`'s two dates exist
 * to close. It is nullable only because a cell may have had no live lesson at
 * all when the cover was arranged, which is the free-period case.
 *
 * ── One cover per cell per date ──────────────────────────────────────────
 * The unique index. Two arrangements for one period on one day are two
 * teachers told to take one class, and the one who does not turn up is the one
 * who was told first.
 */
export const timetableSubstitutions = pgTable(
  'timetable_substitutions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /** GHL Location ID — the tenant key. */
    locationId: text('location_id')
      .notNull()
      .references(() => schools.locationId, { onDelete: 'cascade' }),
    academicYearId: uuid('academic_year_id')
      .notNull()
      .references(() => academicYears.id),
    /** The standing lesson this was arranged from. Null once that row is gone. */
    entryId: uuid('entry_id').references(() => timetableEntries.id, {
      onDelete: 'set null',
    }),
    sectionId: uuid('section_id')
      .notNull()
      .references(() => sections.id),
    slotId: uuid('slot_id')
      .notNull()
      .references(() => timetableSlots.id),
    /** 0 = Monday … 4 = Friday, matching `cover_date`. */
    dayOfWeek: integer('day_of_week').notNull(),
    /** The one date this cover applies to. */
    coverDate: date('cover_date').notNull(),
    /** Who the period belonged to that day. Null when the cell was free. */
    originalTeacherId: uuid('original_teacher_id').references(() => schoolUsers.id),
    coverTeacherId: uuid('cover_teacher_id')
      .notNull()
      .references(() => schoolUsers.id),
    /** Who arranged it. Kept when their account is deactivated, hence set null. */
    arrangedBy: uuid('arranged_by').references(() => schoolUsers.id, {
      onDelete: 'set null',
    }),
    note: text('note'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('timetable_substitutions_location_id_idx').on(table.locationId),
    index('timetable_substitutions_location_date_idx').on(
      table.locationId,
      table.coverDate,
    ),
    index('timetable_substitutions_cover_teacher_date_idx').on(
      table.locationId,
      table.coverTeacherId,
      table.coverDate,
    ),
    uniqueIndex('timetable_substitutions_cell_date_idx').on(
      table.locationId,
      table.sectionId,
      table.slotId,
      table.coverDate,
    ),
    check(
      'timetable_substitutions_day_of_week_check',
      sql`${table.dayOfWeek} BETWEEN 0 AND 4`,
    ),
    // Somebody cannot cover for themselves. Null on the left is the free-period
    // case and is admitted — a CHECK is false, not true, on a null comparison,
    // so the null has to be spelled out or every free-period row is refused.
    check(
      'timetable_substitutions_distinct_check',
      sql`${table.originalTeacherId} IS NULL OR ${table.originalTeacherId} <> ${table.coverTeacherId}`,
    ),
  ],
);

export type TimetableSubstitution = typeof timetableSubstitutions.$inferSelect;
export type NewTimetableSubstitution = typeof timetableSubstitutions.$inferInsert;
