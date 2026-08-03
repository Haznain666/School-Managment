import { sql } from 'drizzle-orm';
import {
  check,
  date,
  index,
  numeric,
  pgTable,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';

import { leaveTypes } from './leave-types';
import { schoolUsers } from './school-users';
import { schools } from './schools';
import { staff } from './staff';

export const LEAVE_STATUSES = ['pending', 'approved', 'rejected', 'cancelled'] as const;
export type LeaveStatus = (typeof LEAVE_STATUSES)[number];

export const LEAVE_STATUS_LABELS: Record<LeaveStatus, string> = {
  pending: 'Pending',
  approved: 'Approved',
  rejected: 'Rejected',
  cancelled: 'Cancelled',
};

/**
 * leave_requests — one application, from one staff member, for a date range.
 *
 * `totalDays` is stored rather than derived from the dates because half days
 * exist: a teacher taking the morning off consumes 0.5 of their casual leave,
 * and a range of one calendar day cannot express that. It is NUMERIC(4,1) for
 * the same reason money is not a float — half days must add up exactly across
 * a year.
 *
 * Payroll reads only `approved` rows of an unpaid `leave_type` overlapping the
 * payroll month. A pending application never docks anyone's pay.
 */
export const leaveRequests = pgTable(
  'leave_requests',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /** GHL Location ID — the tenant key. */
    locationId: text('location_id')
      .notNull()
      .references(() => schools.locationId, { onDelete: 'cascade' }),
    staffId: uuid('staff_id')
      .notNull()
      .references(() => staff.id, { onDelete: 'cascade' }),
    leaveTypeId: uuid('leave_type_id')
      .notNull()
      .references(() => leaveTypes.id),
    startDate: date('start_date').notNull(),
    endDate: date('end_date').notNull(),
    /** Working days consumed, half days allowed. */
    totalDays: numeric('total_days', { precision: 4, scale: 1 }).notNull(),
    reason: text('reason'),
    status: text('status').notNull().default('pending').$type<LeaveStatus>(),
    /** Who decided. Null while pending, or when their account was removed. */
    decidedBy: uuid('decided_by').references(() => schoolUsers.id, {
      onDelete: 'set null',
    }),
    decidedAt: timestamp('decided_at', { withTimezone: true }),
    decisionNote: text('decision_note'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('leave_requests_location_id_idx').on(table.locationId),
    index('leave_requests_location_id_status_idx').on(table.locationId, table.status),
    index('leave_requests_staff_id_idx').on(table.staffId),
    // Payroll scans this range for the month it is paying.
    index('leave_requests_location_id_start_date_idx').on(
      table.locationId,
      table.startDate,
    ),
    check(
      'leave_requests_status_check',
      sql`${table.status} IN ('pending', 'approved', 'rejected', 'cancelled')`,
    ),
    check('leave_requests_date_order_check', sql`${table.endDate} >= ${table.startDate}`),
    check('leave_requests_total_days_check', sql`${table.totalDays} > 0`),
  ],
);

export type LeaveRequest = typeof leaveRequests.$inferSelect;
export type NewLeaveRequest = typeof leaveRequests.$inferInsert;

export function isLeaveStatus(value: unknown): value is LeaveStatus {
  return typeof value === 'string' && (LEAVE_STATUSES as readonly string[]).includes(value);
}
