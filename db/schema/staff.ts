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

import { branches } from './branches';
import { schools } from './schools';
import { users } from './users';

export const STAFF_STATUSES = ['active', 'on_leave', 'resigned'] as const;
export type StaffStatus = (typeof STAFF_STATUSES)[number];

export const EMPLOYMENT_TYPES = [
  'full_time',
  'part_time',
  'contract',
  'visiting',
] as const;
export type EmploymentType = (typeof EMPLOYMENT_TYPES)[number];

/**
 * staff — employment record for a `users` row of type 'staff'.
 * Payroll/HR detail lands in later sprints behind the `hr` / `payroll` module
 * flags; this is the identity + posting half only.
 */
export const staff = pgTable(
  'staff',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    locationId: text('location_id')
      .notNull()
      .references(() => schools.locationId, { onDelete: 'cascade' }),
    branchId: uuid('branch_id').references(() => branches.id, {
      onDelete: 'set null',
    }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    /** School-assigned employee code. Unique within a school. */
    employeeCode: text('employee_code').notNull(),
    firstName: text('first_name').notNull(),
    lastName: text('last_name').notNull(),
    /** Job title as printed on the contract, e.g. "Senior Physics Teacher". */
    designation: text('designation'),
    department: text('department'),
    employmentType: text('employment_type').$type<EmploymentType>(),
    joinedOn: date('joined_on'),
    status: text('status').notNull().default('active').$type<StaffStatus>(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index('staff_location_id_idx').on(table.locationId),
    index('staff_location_id_branch_id_idx').on(table.locationId, table.branchId),
    uniqueIndex('staff_location_id_employee_code_idx').on(
      table.locationId,
      table.employeeCode,
    ),
    check(
      'staff_status_check',
      sql`${table.status} IN ('active', 'on_leave', 'resigned')`,
    ),
    check(
      'staff_employment_type_check',
      sql`${table.employmentType} IS NULL OR ${table.employmentType} IN ('full_time', 'part_time', 'contract', 'visiting')`,
    ),
  ],
);

export type Staff = typeof staff.$inferSelect;
export type NewStaff = typeof staff.$inferInsert;
