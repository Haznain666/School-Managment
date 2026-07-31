import { integer, pgTable, text, uniqueIndex, uuid } from 'drizzle-orm/pg-core';

import { schools } from './schools';

/**
 * challan_sequences — the counter behind challan numbers.
 *
 * One row per (school, billing month, billing year), so numbering restarts each
 * month: `GVS-2025-07-0001` and `GVS-2025-08-0001` are different bills.
 *
 * The same reasoning as `school_id_sequences`: a bulk run generating four
 * hundred challans must not hand two of them the same number, and the unique
 * index on `fee_challans.challan_number` would turn that race into a failed
 * generation. `lib/challan-number.ts` therefore increments this with a single
 * `INSERT ... ON CONFLICT DO UPDATE ... RETURNING`, which Postgres executes
 * atomically — the second writer takes a row lock and reads the incremented
 * value rather than the stale one.
 */
export const challanSequences = pgTable(
  'challan_sequences',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /** GHL Location ID — the tenant key. */
    locationId: text('location_id')
      .notNull()
      .references(() => schools.locationId, { onDelete: 'cascade' }),
    /** 1–12. One-off challans use the month they were issued in. */
    billingMonth: integer('billing_month').notNull(),
    billingYear: integer('billing_year').notNull(),
    lastSequence: integer('last_sequence').notNull().default(0),
  },
  (table) => [
    // The upsert target: this is what makes the increment atomic.
    uniqueIndex('challan_sequences_location_month_year_idx').on(
      table.locationId,
      table.billingMonth,
      table.billingYear,
    ),
  ],
);

export type ChallanSequence = typeof challanSequences.$inferSelect;
export type NewChallanSequence = typeof challanSequences.$inferInsert;
