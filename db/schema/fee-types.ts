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
 * How often a fee is charged. This is what decides whether a fee lands on a
 * monthly challan, on one challan ever, or on one challan per session.
 *
 *   monthly   tuition, transport — billed every month
 *   one_time  admission fee — billed once, on joining
 *   annual    annual charges, examination fee — once per academic year
 */
export const FEE_CATEGORIES = ['monthly', 'one_time', 'annual'] as const;
export type FeeCategory = (typeof FEE_CATEGORIES)[number];

export const FEE_CATEGORY_LABELS: Record<FeeCategory, string> = {
  monthly: 'Monthly',
  one_time: 'One-time',
  annual: 'Annual',
};

export const FEE_CATEGORY_DESCRIPTIONS: Record<FeeCategory, string> = {
  monthly: 'Charged on every monthly challan',
  one_time: 'Charged once, when the student joins',
  annual: 'Charged once per academic year',
};

/**
 * fee_types — the heads a school bills under.
 *
 * Per school rather than platform-wide: one school's "Annual Charges" is
 * another's "Development Fund", and a shared list would force every school
 * onto one vocabulary. `lib/fee-defaults.ts` seeds the five most schools
 * start with, which they can then rename or switch off.
 */
export const feeTypes = pgTable(
  'fee_types',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /** GHL Location ID — the tenant key. */
    locationId: text('location_id')
      .notNull()
      .references(() => schools.locationId, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    description: text('description'),
    feeCategory: text('fee_category').notNull().$type<FeeCategory>(),
    isActive: boolean('is_active').notNull().default(true),
    /** Controls the order line items appear in on a printed challan. */
    sortOrder: integer('sort_order').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index('fee_types_location_id_idx').on(table.locationId),
    uniqueIndex('fee_types_location_id_name_idx').on(table.locationId, table.name),
    check(
      'fee_types_fee_category_check',
      sql`${table.feeCategory} IN ('monthly', 'one_time', 'annual')`,
    ),
  ],
);

export type FeeType = typeof feeTypes.$inferSelect;
export type NewFeeType = typeof feeTypes.$inferInsert;

export function isFeeCategory(value: unknown): value is FeeCategory {
  return (
    typeof value === 'string' && (FEE_CATEGORIES as readonly string[]).includes(value)
  );
}
