import { sql } from 'drizzle-orm';
import {
  check,
  index,
  integer,
  numeric,
  pgTable,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';

import { payslips } from './payslips';
import { salaryComponents } from './salary-components';
import { schools } from './schools';

/**
 * payslip_items — one line on a payslip.
 *
 * `description` duplicates the component's name and `kind` duplicates its
 * classification, deliberately. Renaming "Medical Allowance" to "Health
 * Allowance" next year must not rewrite the payslips already issued under the
 * old name, and retiring a component must not blank a line on a payslip a
 * teacher has in their file.
 *
 * `componentId` is kept alongside for grouping in reports, and is nullable
 * for the same reason: a component deleted outright leaves the line readable.
 */
export const payslipItems = pgTable(
  'payslip_items',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /** GHL Location ID — the tenant key. */
    locationId: text('location_id')
      .notNull()
      .references(() => schools.locationId, { onDelete: 'cascade' }),
    payslipId: uuid('payslip_id')
      .notNull()
      .references(() => payslips.id, { onDelete: 'cascade' }),
    /** Null once the component it came from is gone. The line still reads. */
    componentId: uuid('component_id').references(() => salaryComponents.id, {
      onDelete: 'set null',
    }),
    /** Snapshot of the component name as it was when this payslip was raised. */
    description: text('description').notNull(),
    /** 'earning' or 'deduction', snapshot at generation time. */
    kind: text('kind').notNull(),
    amount: numeric('amount', { precision: 12, scale: 2 }).notNull(),
    sortOrder: integer('sort_order').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('payslip_items_location_id_idx').on(table.locationId),
    index('payslip_items_payslip_id_idx').on(table.payslipId),
    check('payslip_items_kind_check', sql`${table.kind} IN ('earning', 'deduction')`),
  ],
);

export type PayslipItem = typeof payslipItems.$inferSelect;
export type NewPayslipItem = typeof payslipItems.$inferInsert;
