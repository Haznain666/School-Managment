import { integer, pgTable, text, uniqueIndex, uuid } from 'drizzle-orm/pg-core';

import { schools } from './schools';

/**
 * payslip_sequences — the counter behind payslip numbers.
 *
 * One row per (school, payroll month, payroll year), so numbering restarts each
 * month: `GVS-PS-2025-07-0001` and `GVS-PS-2025-08-0001` are different slips.
 *
 * Same reasoning as `challan_sequences`: a run raises one payslip per staff
 * member in a single pass against a globally unique column, so two runs started
 * at the same moment must not be handed the same number. `lib/payslip-number.ts`
 * therefore advances this with one `INSERT ... ON CONFLICT DO UPDATE ...
 * RETURNING`, which Postgres executes atomically — the second writer takes a
 * row lock and reads the incremented value rather than the stale one.
 */
export const payslipSequences = pgTable(
  'payslip_sequences',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /** GHL Location ID — the tenant key. */
    locationId: text('location_id')
      .notNull()
      .references(() => schools.locationId, { onDelete: 'cascade' }),
    /** 1-12. */
    payrollMonth: integer('payroll_month').notNull(),
    payrollYear: integer('payroll_year').notNull(),
    lastSequence: integer('last_sequence').notNull().default(0),
  },
  (table) => [
    // The upsert target: this is what makes the increment atomic.
    uniqueIndex('payslip_sequences_location_month_year_idx').on(
      table.locationId,
      table.payrollMonth,
      table.payrollYear,
    ),
  ],
);

export type PayslipSequence = typeof payslipSequences.$inferSelect;
export type NewPayslipSequence = typeof payslipSequences.$inferInsert;
