import { sql } from 'drizzle-orm';
import {
  check,
  date,
  index,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

import { schoolUsers } from './school-users';
import { schools } from './schools';
import { staff } from './staff';

export const STAFF_ATTENDANCE_STATUSES = [
  'present',
  'absent',
  'late',
  'half_day',
  'leave',
  'holiday',
] as const;
export type StaffAttendanceStatus = (typeof STAFF_ATTENDANCE_STATUSES)[number];

export const STAFF_ATTENDANCE_STATUS_LABELS: Record<StaffAttendanceStatus, string> = {
  present: 'Present',
  absent: 'Absent',
  late: 'Late',
  half_day: 'Half day',
  leave: 'On leave',
  holiday: 'Holiday',
};

/** Single letters for the marking toggles, where a full word will not fit. */
export const STAFF_ATTENDANCE_STATUS_INITIALS: Record<StaffAttendanceStatus, string> = {
  present: 'P',
  absent: 'A',
  late: 'L',
  half_day: 'H/D',
  leave: 'V',
  holiday: 'H',
};

/**
 * staff_attendance — one row per staff member per day.
 *
 * Same shape and same reasoning as `attendance_records` for students: the
 * unique key on (location, date, staff) is what makes marking idempotent, so
 * the API upserts onto it and a register saved twice cannot hold two
 * contradictory answers for one day.
 *
 * Payroll reads this as the second half of its loss-of-pay figure. An `absent`
 * day with no approved leave behind it is unpaid; a `leave` day defers to the
 * leave request, which knows whether that leave was paid; `half_day` counts as
 * half. `holiday` is excluded entirely — a school closure is not an absence and
 * must never dock anyone.
 */
export const staffAttendance = pgTable(
  'staff_attendance',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /** GHL Location ID — the tenant key. */
    locationId: text('location_id')
      .notNull()
      .references(() => schools.locationId, { onDelete: 'cascade' }),
    staffId: uuid('staff_id')
      .notNull()
      .references(() => staff.id, { onDelete: 'cascade' }),
    date: date('date').notNull(),
    status: text('status').notNull().$type<StaffAttendanceStatus>(),
    /** Who took the register. Null when their account has since been removed. */
    markedBy: uuid('marked_by').references(() => schoolUsers.id, {
      onDelete: 'set null',
    }),
    notes: text('notes'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('staff_attendance_location_id_date_idx').on(table.locationId, table.date),
    index('staff_attendance_staff_id_idx').on(table.staffId),
    uniqueIndex('staff_attendance_location_date_staff_idx').on(
      table.locationId,
      table.date,
      table.staffId,
    ),
    check(
      'staff_attendance_status_check',
      sql`${table.status} IN ('present', 'absent', 'late', 'half_day', 'leave', 'holiday')`,
    ),
  ],
);

export type StaffAttendanceRecord = typeof staffAttendance.$inferSelect;
export type NewStaffAttendanceRecord = typeof staffAttendance.$inferInsert;

export function isStaffAttendanceStatus(
  value: unknown,
): value is StaffAttendanceStatus {
  return (
    typeof value === 'string' &&
    (STAFF_ATTENDANCE_STATUSES as readonly string[]).includes(value)
  );
}
