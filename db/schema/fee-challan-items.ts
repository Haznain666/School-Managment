import { index, numeric, pgTable, text, uuid } from 'drizzle-orm/pg-core';

import { feeChallans } from './fee-challans';
import { feeTypes } from './fee-types';
import { schools } from './schools';

/**
 * fee_challan_items — the lines on one challan.
 *
 * `description` duplicates the fee type's name on purpose. A challan is a
 * document a family kept and a bank stamped; if the school later renames
 * "Annual Charges" to "Development Fund", last year's printed challan must
 * still read the way it read when it was paid. For the same reason
 * `fee_type_id` is `ON DELETE SET NULL` — deleting a fee head must not delete
 * the history of what was billed under it.
 *
 * There is no `location_id` filter used for reads here: items are only ever
 * reached through their challan, which is itself tenant-scoped. The column is
 * still carried so the table obeys the platform-wide tenancy invariant and can
 * be audited on its own.
 */
export const feeChallanItems = pgTable(
  'fee_challan_items',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /** GHL Location ID — the tenant key. */
    locationId: text('location_id')
      .notNull()
      .references(() => schools.locationId, { onDelete: 'cascade' }),
    challanId: uuid('challan_id')
      .notNull()
      .references(() => feeChallans.id, { onDelete: 'cascade' }),
    /** Null once the fee head is deleted; `description` survives it. */
    feeTypeId: uuid('fee_type_id').references(() => feeTypes.id, {
      onDelete: 'set null',
    }),
    /** The fee head's name as it stood when the challan was raised. */
    description: text('description').notNull(),
    amount: numeric('amount', { precision: 10, scale: 2 }).notNull(),
    concessionAmount: numeric('concession_amount', { precision: 10, scale: 2 })
      .notNull()
      .default('0'),
    /** amount - concession_amount. */
    netAmount: numeric('net_amount', { precision: 10, scale: 2 }).notNull(),
  },
  (table) => [
    index('fee_challan_items_challan_id_idx').on(table.challanId),
    index('fee_challan_items_location_id_idx').on(table.locationId),
  ],
);

export type FeeChallanItem = typeof feeChallanItems.$inferSelect;
export type NewFeeChallanItem = typeof feeChallanItems.$inferInsert;
