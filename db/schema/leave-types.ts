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

import { schools } from './schools';

/**
 * leave_types — the leave a school grants, and how much of it a year.
 *
 * `isPaid` is the field payroll reads: an approved day of unpaid leave becomes
 * a loss-of-pay day on that month's payslip, and an approved day of paid leave
 * does not. Getting it the wrong way round docks a teacher for their casual
 * leave, so it is stored explicitly rather than inferred from the name.
 */
export const leaveTypes = pgTable(
  'leave_types',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /** GHL Location ID — the tenant key. */
    locationId: text('location_id')
      .notNull()
      .references(() => schools.locationId, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    description: text('description'),
    /** Days granted per academic year. 0 = uncapped, checked by hand. */
    annualQuotaDays: integer('annual_quota_days').notNull().default(0),
    /** False = every approved day of this leave is docked from pay. */
    isPaid: boolean('is_paid').notNull().default(true),
    isActive: boolean('is_active').notNull().default(true),
    sortOrder: integer('sort_order').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('leave_types_location_id_idx').on(table.locationId),
    uniqueIndex('leave_types_location_id_name_idx').on(table.locationId, table.name),
    check(
      'leave_types_annual_quota_days_check',
      sql`${table.annualQuotaDays} >= 0 AND ${table.annualQuotaDays} <= 365`,
    ),
  ],
);

export type LeaveType = typeof leaveTypes.$inferSelect;
export type NewLeaveType = typeof leaveTypes.$inferInsert;

/** The leave heads most Pakistani schools grant, seeded on first setup. */
export const DEFAULT_LEAVE_TYPES: ReadonlyArray<{
  name: string;
  annualQuotaDays: number;
  isPaid: boolean;
  description: string;
  sortOrder: number;
}> = [
  {
    name: 'Casual Leave',
    annualQuotaDays: 10,
    isPaid: true,
    description: 'Short notice leave for personal reasons.',
    sortOrder: 1,
  },
  {
    name: 'Sick Leave',
    annualQuotaDays: 8,
    isPaid: true,
    description: 'Medical leave, supported by a certificate beyond two days.',
    sortOrder: 2,
  },
  {
    name: 'Annual Leave',
    annualQuotaDays: 14,
    isPaid: true,
    description: 'Planned leave, applied for in advance.',
    sortOrder: 3,
  },
  {
    name: 'Unpaid Leave',
    annualQuotaDays: 0,
    isPaid: false,
    description: 'Leave beyond entitlement. Every approved day is docked from pay.',
    sortOrder: 4,
  },
];
