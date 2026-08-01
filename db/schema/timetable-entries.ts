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
    uniqueIndex('timetable_entries_location_section_slot_day_idx').on(
      table.locationId,
      table.sectionId,
      table.slotId,
      table.dayOfWeek,
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
