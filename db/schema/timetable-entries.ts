import { sql } from 'drizzle-orm';
import {
  boolean,
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
import { subjects } from './subjects';
import { timetableSlots } from './timetable-slots';

/**
 * timetable_entries — one lesson: a section, a period, a day.
 *
 * The unique key is what makes the grid a grid: a section can hold exactly one
 * lesson in a given slot on a given day, so saving a cell is an upsert on
 * (location, section, slot, day) rather than a delete-then-insert that could
 * leave the cell empty if the second half failed.
 *
 * Entries are per academic year because a timetable does not survive one: next
 * year's Class 5 A is a different section with a different schedule, and last
 * year's must stay readable.
 *
 * `day_of_week` is 0–4, Monday to Friday — the Pakistani school week. Saturday
 * and Sunday are excluded by the check constraint rather than merely unused, so
 * a bad client cannot write a lesson nothing will ever display.
 *
 * ── Sprint 33c: a teacher change stops rewriting last Tuesday ────────────
 * Until `0049` a lesson had no dates on it at all, so changing `teacher_id`
 * changed *who taught the class in March* as well as who takes it tomorrow.
 * The product owner's instruction was "do not change legacy data", and
 * decision 9 says there is to be **no history view** — so the answer is not a
 * screen, it is that the past simply stops being edited.
 *
 * `effective_from` / `effective_to` make a row a *version* of a cell. A teacher
 * change **closes** the standing row and **opens** a new one; nothing is
 * updated in place and nothing is deleted. `lib/timetable-history.ts` holds the
 * one predicate every read filters on, and the migration header records the
 * boundary convention: the superseded row is closed **yesterday**
 * (`CURRENT_DATE - 1`) and the new one opens **today**, so exactly one version
 * of a cell is live on any date.
 *
 * ⚠ **The unique index had to become partial.** It was
 * `UNIQUE (location_id, section_id, slot_id, day_of_week)` over the whole
 * table; superseding writes a *second* row for the same cell, so the very
 * first supersede would have been a `23505`. It is now restricted to the live
 * rows — `WHERE effective_to IS NULL AND is_active` — which is exactly the set
 * the grid draws from, so the grid is still one lesson per cell and history is
 * unconstrained.
 */
export const timetableEntries = pgTable(
  'timetable_entries',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /** GHL Location ID — the tenant key. */
    locationId: text('location_id')
      .notNull()
      .references(() => schools.locationId, { onDelete: 'cascade' }),
    academicYearId: uuid('academic_year_id')
      .notNull()
      .references(() => academicYears.id),
    sectionId: uuid('section_id')
      .notNull()
      .references(() => sections.id),
    subjectId: uuid('subject_id')
      .notNull()
      .references(() => subjects.id),
    /** The `school_users` row of the teacher taking this period. */
    teacherId: uuid('teacher_id')
      .notNull()
      .references(() => schoolUsers.id),
    slotId: uuid('slot_id')
      .notNull()
      .references(() => timetableSlots.id),
    /** 0 = Monday … 4 = Friday. */
    dayOfWeek: integer('day_of_week').notNull(),
    /** Room or lab name. Null = wherever the section normally sits. */
    room: text('room'),
    /**
     * The first date this version of the cell is in force.
     *
     * `DEFAULT CURRENT_DATE`, so every row that existed before `0049` reads as
     * live from the day the migration ran and every current read returns
     * exactly what it returned the day before.
     */
    effectiveFrom: date('effective_from')
      .notNull()
      .default(sql`CURRENT_DATE`),
    /**
     * The last date this version was in force, or null while it still is.
     *
     * Set to the day **before** a change takes effect, never to the day of it:
     * two rows sharing a boundary date would both be live on that date and the
     * grid would draw the cell twice.
     */
    effectiveTo: date('effective_to'),
    isActive: boolean('is_active').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index('timetable_entries_location_section_teacher_idx').on(
      table.locationId,
      table.sectionId,
      table.teacherId,
    ),
    /*
     * One *live* lesson per cell, not one row per cell.
     *
     * The predicate is the whole of Sprint 33c's supersede: without it the
     * second version of a cell collides with the first and the change is a
     * `23505` on a form that has never failed. It must match the predicate
     * `liveTimetableEntries` filters reads on, or a row would be drawn that
     * the index never constrained.
     */
    uniqueIndex('timetable_entries_location_section_slot_day_idx')
      .on(table.locationId, table.sectionId, table.slotId, table.dayOfWeek)
      .where(sql`${table.effectiveTo} IS NULL AND ${table.isActive}`),
    // The history read: every version of one cell, newest first. Nothing draws
    // a grid from it — decision 9 — but a support question about who taught a
    // class in March is answered from here rather than from a backup.
    index('timetable_entries_history_idx').on(
      table.locationId,
      table.sectionId,
      table.slotId,
      table.dayOfWeek,
      table.effectiveFrom,
    ),
    check(
      'timetable_entries_day_of_week_check',
      sql`${table.dayOfWeek} BETWEEN 0 AND 4`,
    ),
  ],
);

export type TimetableEntry = typeof timetableEntries.$inferSelect;
export type NewTimetableEntry = typeof timetableEntries.$inferInsert;

/** The teaching week, indexed by `day_of_week`. */
export const WEEKDAY_NAMES = [
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
] as const;

/** Column headings for the weekly grid. */
export const WEEKDAY_SHORT_NAMES = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'] as const;

/** True for a day index the timetable can actually hold. */
export function isSchoolDay(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 4;
}

/**
 * `day_of_week` for a calendar date, or null at the weekend.
 * `Date.getDay()` counts from Sunday; the timetable counts from Monday.
 */
export function schoolDayOfWeek(date: Date): number | null {
  const day = date.getDay();
  return day === 0 || day === 6 ? null : day - 1;
}
