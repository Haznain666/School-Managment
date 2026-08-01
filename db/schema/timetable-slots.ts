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

import { schools } from './schools';

/**
 * timetable_slots — the school's bell schedule.
 *
 * One row per period, shared by every section: a school rings one bell, so the
 * rows of the weekly grid are defined here once rather than per class. That is
 * also what makes two sections comparable — "period 3" means the same minutes
 * everywhere.
 *
 * Times are `HH:MM` text rather than `time` columns because nothing here is a
 * moment in time: a period is a label on a wall clock, it never crosses a
 * timezone, and storing it as text keeps it out of any UTC conversion.
 *
 * `is_break` marks the slots nothing is taught in — assembly, the interval,
 * prayer. They occupy a row in the grid so the day reads correctly, but the
 * timetable API refuses to place a lesson in one.
 */
export const timetableSlots = pgTable(
  'timetable_slots',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /** GHL Location ID — the tenant key. */
    locationId: text('location_id')
      .notNull()
      .references(() => schools.locationId, { onDelete: 'cascade' }),
    /** e.g. `Period 1`, `Break`, `Assembly`. */
    name: text('name').notNull(),
    /** Wall-clock start, `HH:MM` in 24-hour form. */
    startTime: text('start_time').notNull(),
    /** Wall-clock end, `HH:MM` in 24-hour form. */
    endTime: text('end_time').notNull(),
    isBreak: boolean('is_break').notNull().default(false),
    /** Position down the day. Unique per school — it orders the grid. */
    orderIndex: integer('order_index').notNull(),
    isActive: boolean('is_active').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index('timetable_slots_location_id_idx').on(table.locationId),
    // Two slots claiming the same position would make the grid order arbitrary.
    uniqueIndex('timetable_slots_location_id_order_index_idx').on(
      table.locationId,
      table.orderIndex,
    ),
  ],
);

export type TimetableSlot = typeof timetableSlots.$inferSelect;
export type NewTimetableSlot = typeof timetableSlots.$inferInsert;

const TIME_PATTERN = /^([01][0-9]|2[0-3]):[0-5][0-9]$/;

/** True for a 24-hour `HH:MM` string. Guards input before it reaches the DB. */
export function isTimeOfDay(value: unknown): value is string {
  return typeof value === 'string' && TIME_PATTERN.test(value);
}

/** Minutes since midnight, for comparing two `HH:MM` values. */
export function minutesFromTime(time: string): number {
  const hours = Number(time.slice(0, 2));
  const minutes = Number(time.slice(3, 5));
  return hours * 60 + minutes;
}

/**
 * Why a start/end pair is not usable, or null when it is.
 * Shared by the API and the form so both refuse the same things.
 */
export function slotTimeProblem(startTime: string, endTime: string): string | null {
  if (!isTimeOfDay(startTime) || !isTimeOfDay(endTime)) {
    return 'Enter both times as HH:MM, for example 08:30.';
  }
  if (minutesFromTime(endTime) <= minutesFromTime(startTime)) {
    return 'The period must end after it starts.';
  }
  return null;
}

/** `08:30` rendered for a human as `8:30 AM`. */
export function formatTimeOfDay(time: string): string {
  if (!isTimeOfDay(time)) return time;

  const hours = Number(time.slice(0, 2));
  const minutes = time.slice(3, 5);
  const suffix = hours < 12 ? 'AM' : 'PM';
  const display = hours % 12 === 0 ? 12 : hours % 12;

  return `${display}:${minutes} ${suffix}`;
}
