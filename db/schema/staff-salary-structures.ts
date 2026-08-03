import {
  index,
  integer,
  numeric,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

import { salaryComponents } from './salary-components';
import { schools } from './schools';
import { staff } from './staff';

/**
 * staff_salary_structures — what one staff member is paid under one head.
 *
 * One row per (staff member, component). The pair is uniquely indexed so that
 * assigning a structure is an upsert rather than a delete-and-reinsert: an HR
 * manager who saves the same screen twice must not end up paying House Rent
 * twice.
 *
 * `amount` is the rupee figure for a `fixed` component and is ignored for a
 * `percent_of_basic` one, where `percentBasisPoints` (overriding the
 * component's default) decides instead. Storing both rather than one nullable
 * column keeps a school's override visible after they switch a head between
 * the two calculations.
 */
export const staffSalaryStructures = pgTable(
  'staff_salary_structures',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /** GHL Location ID — the tenant key. */
    locationId: text('location_id')
      .notNull()
      .references(() => schools.locationId, { onDelete: 'cascade' }),
    staffId: uuid('staff_id')
      .notNull()
      .references(() => staff.id, { onDelete: 'cascade' }),
    componentId: uuid('component_id')
      .notNull()
      .references(() => salaryComponents.id, { onDelete: 'cascade' }),
    /** Rupees. Meaningful for `fixed` components only. */
    amount: numeric('amount', { precision: 12, scale: 2 }).notNull().default('0'),
    /** Hundredths of a percent. Overrides the component default when set. */
    percentBasisPoints: integer('percent_basis_points'),
    /**
     * When this figure took effect. Kept for the audit trail an increment
     * letter needs; payslips snapshot their own amounts, so changing this never
     * rewrites a payslip already issued.
     */
    effectiveFrom: timestamp('effective_from', { withTimezone: true })
      .notNull()
      .defaultNow(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('staff_salary_structures_location_id_idx').on(table.locationId),
    index('staff_salary_structures_staff_id_idx').on(table.staffId),
    uniqueIndex('staff_salary_structures_staff_component_idx').on(
      table.staffId,
      table.componentId,
    ),
  ],
);

export type StaffSalaryStructure = typeof staffSalaryStructures.$inferSelect;
export type NewStaffSalaryStructure = typeof staffSalaryStructures.$inferInsert;
