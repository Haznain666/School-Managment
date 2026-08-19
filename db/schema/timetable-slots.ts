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

import { periodStructures } from './period-structures';
import { schools } from './schools';

/**
 * timetable_slots — one period inside one bell schedule.
 *
 * One row per period. Every slot belongs to a `period_structures` row, and the
 * grades assigned to that structure are the ones laid out against it — so
 * "period 3" means the same minutes for every section of every grade on the
 * same schedule, and the infants are not made to carry the seniors' eighth
 * period as an empty row they can never fill.
 *
 * That column is the whole of what changed when structures arrived. A school
 * that has never opened the structures screen has exactly one, holding every
 * slot it already had, and nothing about this table reads differently to it.
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
    /** The bell schedule this period belongs to. */
    periodStructureId: uuid('period_structure_id')
      .notNull()
      .references(() => periodStructures.id, { onDelete: 'cascade' }),
    /** e.g. `Period 1`, `Break`, `Assembly`. */
    name: text('name').notNull(),
    /** Wall-clock start, `HH:MM` in 24-hour form. */
    startTime: text('start_time').notNull(),
    /** Wall-clock end, `HH:MM` in 24-hour form. */
    endTime: text('end_time').notNull(),
    isBreak: boolean('is_break').notNull().default(false),
    /** Position down the day. Unique per structure — it orders the grid. */
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
    index('timetable_slots_period_structure_id_idx').on(table.periodStructureId),
    /*
     * Two slots claiming the same position would make the grid order arbitrary.
     *
     * Scoped to the structure rather than the school, which is the point of the
     * feature: "position 3" in the junior day and "position 3" in the senior
     * day are different periods at different times, and under the old
     * school-wide index the second school schedule a school entered was refused
     * as a duplicate of the first.
     */
    uniqueIndex('timetable_slots_structure_order_index_idx').on(
      table.periodStructureId,
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
