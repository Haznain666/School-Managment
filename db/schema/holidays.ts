import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  date,
  index,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

import { branches } from './branches';
import { schoolUsers } from './school-users';
import { schools } from './schools';

export const HOLIDAY_TYPES = ['public', 'religious', 'school'] as const;
export type HolidayType = (typeof HOLIDAY_TYPES)[number];

export const HOLIDAY_TYPE_LABELS: Record<HolidayType, string> = {
  public: 'Public holiday',
  religious: 'Religious holiday',
  school: 'School holiday',
};

export const HOLIDAY_SOURCES = ['manual', 'seed'] as const;
export type HolidaySource = (typeof HOLIDAY_SOURCES)[number];

/**
 * holidays — one row per holiday, not per day.
 *
 * ── A range, and why that matters ────────────────────────────────────────
 * Eid-ul-Fitr is **one holiday of three days**, and a school that moves it
 * because the moon was sighted a day late moves *one row*. The obvious cheaper
 * design — a row per closed day — makes that three edits, two of which a person
 * will forget, and produces a calendar that says the school is shut on the 1st
 * and open on the 2nd of the same Eid.
 *
 * The calendar expands the range on read: `expandHolidays` in
 * `lib/holiday-calendar.ts` is the only thing that turns a row into dates, so
 * every screen answers the same way.
 *
 * ── Weekends are never rows ──────────────────────────────────────────────
 * Sunday is always off and Saturday is decided by the duty roster
 * (`saturday_duty_policies` and `staff.saturday_ordinals`). Writing them here
 * would be 104 rows a year per school saying the same thing, and the first time
 * one of them disagreed with the rule — a school that changed its Saturday
 * policy in March — nothing would say which was right.
 *
 * ── Tentative is a fact about the world, not a draft state ───────────────
 * Every Islamic holiday is written `is_tentative = true`, without exception.
 * The dates are derived from the tabular (arithmetical) Islamic calendar, which
 * is an approximation: the real dates are decided by moon sighting and land
 * within a day or two of it. That is not a defect to hide behind a confident
 * date — it is the reason HR and a Branch Administrator can move them, and why
 * every screen badges them. Editing a date clears the flag, because a human has
 * now said what the date is.
 *
 * ── One row can belong to one campus, or to all of them ──────────────────
 * `branch_id` null means every campus, which is what a national holiday is. A
 * campus-specific closure — a founder's day at one site, a road closed for a
 * rally — carries the campus. Two partial unique indexes are needed rather than
 * one, because Postgres treats every NULL as distinct and a plain unique index
 * over a nullable column would let the seed run twice; that is the pattern
 * `payroll_runs` already uses.
 */
export const holidays = pgTable(
  'holidays',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /** The tenant key — see STATE.md §1. */
    locationId: text('location_id')
      .notNull()
      .references(() => schools.locationId, { onDelete: 'cascade' }),
    /**
     * The campus this closes, or null for the whole school.
     *
     * `set null` on delete rather than cascade: deleting a campus must not
     * silently delete the days the school was shut. The holiday becomes
     * school-wide, which is a visible and correctable outcome.
     */
    branchId: uuid('branch_id').references(() => branches.id, {
      onDelete: 'set null',
    }),
    name: text('name').notNull(),
    startsOn: date('starts_on').notNull(),
    /** Equal to `starts_on` for a one-day holiday. Never before it. */
    endsOn: date('ends_on').notNull(),
    holidayType: text('holiday_type').notNull().$type<HolidayType>(),
    /**
     * True for every lunar-dated holiday until a person confirms it.
     *
     * See the docblock above. The screens read this to badge the row
     * *"Tentative — confirm the date"*, and the edit route clears it.
     */
    isTentative: boolean('is_tentative').notNull().default(false),
    /**
     * `seed` for a row the year's catalogue wrote, `manual` for one a person
     * added. Kept so the seed can tell what it has already written and skip it
     * rather than overwrite a date a school has since corrected.
     */
    source: text('source').notNull().default('manual').$type<HolidaySource>(),
    notes: text('notes'),
    createdBy: uuid('created_by').references(() => schoolUsers.id, {
      onDelete: 'set null',
    }),
    updatedBy: uuid('updated_by').references(() => schoolUsers.id, {
      onDelete: 'set null',
    }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('holidays_location_starts_on_idx').on(table.locationId, table.startsOn),
    index('holidays_location_branch_idx').on(table.locationId, table.branchId),
    /*
     * Two indexes for one rule, because of NULL.
     *
     * Postgres treats every NULL as distinct, so a single unique index over
     * `(location_id, branch_id, starts_on, name)` would permit any number of
     * identical school-wide rows — and the seed, which is meant to be safe to
     * re-run, would write Independence Day again every time somebody pressed
     * the button.
     */
    uniqueIndex('holidays_school_wide_idx')
      .on(table.locationId, table.startsOn, table.name)
      .where(sql`${table.branchId} IS NULL`),
    uniqueIndex('holidays_branch_idx')
      .on(table.locationId, table.branchId, table.startsOn, table.name)
      .where(sql`${table.branchId} IS NOT NULL`),
    check('holidays_range_check', sql`${table.endsOn} >= ${table.startsOn}`),
    check(
      'holidays_type_check',
      sql`${table.holidayType} IN ('public', 'religious', 'school')`,
    ),
    check('holidays_source_check', sql`${table.source} IN ('manual', 'seed')`),
  ],
);

export type Holiday = typeof holidays.$inferSelect;
export type NewHoliday = typeof holidays.$inferInsert;

export function isHolidayType(value: unknown): value is HolidayType {
  return typeof value === 'string' && (HOLIDAY_TYPES as readonly string[]).includes(value);
}
