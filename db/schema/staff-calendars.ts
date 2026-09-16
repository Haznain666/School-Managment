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

import type { UserRole } from '@/types/school-auth';

import { branches } from './branches';
import { holidays } from './holidays';
import { schoolUsers } from './school-users';
import { schools } from './schools';

/**
 * The two staff calendars — Sprint 33b, migration `0047`.
 *
 * ── Why two, and why they are not two copies of the holiday list ────────
 * The requirement is that teaching and non-teaching staff do not share a year:
 * the school is shut to teachers through June and July and the office is not.
 * The obvious design — a holiday row per calendar — makes every gazetted
 * holiday two rows, and the day a school corrects the Eid date on one of them
 * it has a calendar that says the school is open and a calendar that says it is
 * closed, with nothing to say which is right.
 *
 * So `holidays` stays the single list of days the school is shut, exactly as
 * `lib/pakistan-holidays.ts` and the existing seed write it, and a **calendar
 * is a filter over it**. Gazetted holidays appear on both calendars because
 * nothing excludes them. An override is HR saying *this one does not apply to
 * these people*, or *for these people it is on different dates*.
 *
 * "June–July off for teaching staff only" is therefore a school holiday in
 * `holidays` plus one override binding it to the teaching calendar — one row
 * each, and the date is still in one place.
 */

/** The two calendars every school has. A person is on exactly one. */
export const STAFF_CALENDAR_CATEGORIES = ['teaching', 'non_teaching'] as const;
export type StaffCalendarCategory = (typeof STAFF_CALENDAR_CATEGORIES)[number];

export const STAFF_CALENDAR_CATEGORY_LABELS: Record<StaffCalendarCategory, string> = {
  teaching: 'Teaching staff',
  non_teaching: 'Non-teaching staff',
};

/**
 * Which calendar a role is on.
 *
 * ── Why the heads are teaching ──────────────────────────────────────────
 * A Principal, Vice Principal, Section Head and Coordinator keep the academic
 * year: they are in when the classes are. The office — accounts, HR, marketing
 * — is in through the summer, and so is the Branch Admin who runs it. The
 * School Administrator is the school's owner and keeps the office's year,
 * because a school group's head office does not close for the holidays.
 *
 * A school that disagrees does not edit this: it writes an override naming the
 * roles it applies to, which is what `applies_to_roles` is for.
 */
export function calendarCategoryForRole(role: UserRole): StaffCalendarCategory {
  switch (role) {
    case 'principal':
    case 'vice_principal':
    case 'section_head':
    case 'coordinator':
    case 'teacher':
      return 'teaching';
    default:
      return 'non_teaching';
  }
}

/**
 * staff_calendars — one row per campus per category.
 *
 * `branch_id` null means the whole school, which is what a single-campus school
 * has and what every school starts with. Two partial unique indexes rather than
 * one, for the reason `holidays` states at length: Postgres treats every NULL
 * as distinct, so a plain unique index over a nullable column would let the
 * same calendar be created twice.
 */
export const staffCalendars = pgTable(
  'staff_calendars',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /** GHL Location ID — the tenant key. */
    locationId: text('location_id')
      .notNull()
      .references(() => schools.locationId, { onDelete: 'cascade' }),
    /** The campus this calendar is for, or null for the whole school. */
    branchId: uuid('branch_id').references(() => branches.id, { onDelete: 'cascade' }),
    category: text('category').notNull().$type<StaffCalendarCategory>(),
    /** What the school calls it. Defaults to the category's own label. */
    name: text('name').notNull(),
    createdBy: uuid('created_by').references(() => schoolUsers.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('staff_calendars_location_id_idx').on(table.locationId),
    uniqueIndex('staff_calendars_school_wide_idx')
      .on(table.locationId, table.category)
      .where(sql`${table.branchId} IS NULL`),
    uniqueIndex('staff_calendars_branch_idx')
      .on(table.locationId, table.branchId, table.category)
      .where(sql`${table.branchId} IS NOT NULL`),
    check(
      'staff_calendars_category_check',
      sql`${table.category} IN ('teaching', 'non_teaching')`,
    ),
  ],
);

/**
 * staff_calendar_overrides — a gazetted holiday HR has moved or cancelled.
 *
 * ── It always points at a holiday ───────────────────────────────────────
 * Every override names a row in `holidays`, including the ones that *add* days:
 * the screen writes the holiday first and binds it here. That is what lets
 * *Notify* be `POST /api/school/holidays/[holidayId]/notify` — the path that
 * already builds an announcement with `audience: { kind: 'roles', roles }` and
 * sends it through `sendAnnouncement`, resolving the audience, the branch
 * scope and every email preference on the way.
 *
 * A second delivery path for staff holidays would be a second place for those
 * rules to be applied, and the first time the two disagreed somebody who had
 * opted out would get mail. There is one path.
 *
 * ── `applies_to_roles` narrows within the calendar ──────────────────────
 * The calendar says teaching or non-teaching; this says which of those roles.
 * Empty means every role on that calendar, which is the ordinary case and the
 * default. A closure for teachers but not for coordinators is the case it is
 * for, and it is also exactly what the notify call sends as its audience.
 */
export const staffCalendarOverrides = pgTable(
  'staff_calendar_overrides',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /** GHL Location ID — the tenant key. */
    locationId: text('location_id')
      .notNull()
      .references(() => schools.locationId, { onDelete: 'cascade' }),
    calendarId: uuid('calendar_id')
      .notNull()
      .references(() => staffCalendars.id, { onDelete: 'cascade' }),
    holidayId: uuid('holiday_id')
      .notNull()
      .references(() => holidays.id, { onDelete: 'cascade' }),
    /** `USER_ROLES` values. Empty = every role on this calendar. */
    appliesToRoles: text('applies_to_roles')
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    /** True when this holiday does **not** close the school for these people. */
    isCancelled: boolean('is_cancelled').notNull().default(false),
    /** The dates it runs on for these people instead. Both null = unmoved. */
    movedStartsOn: date('moved_starts_on'),
    movedEndsOn: date('moved_ends_on'),
    /** Whether the school asked for the people it applies to to be told. */
    notify: boolean('notify').notNull().default(false),
    /** When the announcement actually went out. Null until it has. */
    notifiedAt: timestamp('notified_at', { withTimezone: true }),
    createdBy: uuid('created_by').references(() => schoolUsers.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('staff_calendar_overrides_location_calendar_idx').on(
      table.locationId,
      table.calendarId,
    ),
    // One answer per holiday per calendar. Two rows moving the same Eid to two
    // different weeks is a calendar nobody can read.
    uniqueIndex('staff_calendar_overrides_calendar_holiday_idx').on(
      table.calendarId,
      table.holidayId,
    ),
    check(
      'staff_calendar_overrides_moved_check',
      sql`(${table.movedStartsOn} IS NULL) = (${table.movedEndsOn} IS NULL)
          AND (${table.movedEndsOn} IS NULL OR ${table.movedEndsOn} >= ${table.movedStartsOn})`,
    ),
    // Cancelled and moved are opposite answers to the same question.
    check(
      'staff_calendar_overrides_effect_check',
      sql`NOT (${table.isCancelled} AND ${table.movedStartsOn} IS NOT NULL)`,
    ),
  ],
);

export type StaffCalendar = typeof staffCalendars.$inferSelect;
export type NewStaffCalendar = typeof staffCalendars.$inferInsert;
export type StaffCalendarOverride = typeof staffCalendarOverrides.$inferSelect;
export type NewStaffCalendarOverride = typeof staffCalendarOverrides.$inferInsert;

export function isStaffCalendarCategory(value: unknown): value is StaffCalendarCategory {
  return (
    typeof value === 'string' &&
    (STAFF_CALENDAR_CATEGORIES as readonly string[]).includes(value)
  );
}
