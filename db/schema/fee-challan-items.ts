import { index, numeric, pgTable, text, uuid } from 'drizzle-orm/pg-core';

import { feeChallans } from './fee-challans';
import { feeTypes } from './fee-types';
import { schools } from './schools';

/**
 * fee_challan_items — the lines printed on one challan.
 *
 * `description` is the fee head's name copied at generation time, not a join.
 * A school that renames "Tuition Fee" to "Academic Fee" in March must not
 * silently rewrite what February's printed slip said, and a head that is
 * deleted outright leaves `fee_type_id` null while the line survives intact.
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
    /** Null once the head is deleted; `description` still says what it was. */
    feeTypeId: uuid('fee_type_id').references(() => feeTypes.id, {
      onDelete: 'set null',
    }),
    /** The fee head's name, persisted at generation time. */
    description: text('description').notNull(),
    /** Gross PKR for this line, before its share of any concession. */
    amount: numeric('amount', { precision: 12, scale: 2 }).notNull(),
    concessionAmount: numeric('concession_amount', { precision: 12, scale: 2 })
      .notNull()
      .default('0'),
    /** amount - concessionAmount. */
    netAmount: numeric('net_amount', { precision: 12, scale: 2 }).notNull(),
  },
  (table) => [index('fee_challan_items_challan_id_idx').on(table.challanId)],
);

export type FeeChallanItem = typeof feeChallanItems.$inferSelect;
export type NewFeeChallanItem = typeof feeChallanItems.$inferInsert;
