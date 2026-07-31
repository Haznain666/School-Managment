import { sql } from 'drizzle-orm';
import {
  check,
  integer,
  pgTable,
  text,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

import { schools } from './schools';

/**
 * challan_sequences — the counter behind challan numbers.
 *
 * One row per (school, billing month, billing year), so numbering restarts
 * each month: `GVS-2025-07-0001` and `GVS-2025-08-0001` are different bills.
 *
 * Same design as `school_id_sequences`, and for the same reason: the counter is
 * per-tenant-per-period, which a Postgres sequence cannot scope. It is
 * incremented by a single `INSERT ... ON CONFLICT DO UPDATE ... RETURNING`,
 * which Postgres runs atomically — bulk generation for four hundred students
 * takes a row lock per increment and cannot hand two of them the same number.
 * The unique index on `fee_challans.challan_number` is the backstop if it ever
 * did.
 */
export const challanSequences = pgTable(
  'challan_sequences',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /** GHL Location ID — the tenant key. */
    locationId: text('location_id')
      .notNull()
      .references(() => schools.locationId, { onDelete: 'cascade' }),
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
    check(
      'challan_sequences_billing_month_check',
      sql`${table.billingMonth} BETWEEN 1 AND 12`,
    ),
  ],
);

export type ChallanSequence = typeof challanSequences.$inferSelect;
export type NewChallanSequence = typeof challanSequences.$inferInsert;
