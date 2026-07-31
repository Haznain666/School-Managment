import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  integer,
  numeric,
  pgTable,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';

import { schools } from './schools';

export const LATE_FEE_TYPES = ['fixed', 'daily'] as const;
export type LateFeeType = (typeof LATE_FEE_TYPES)[number];

export const LATE_FEE_TYPE_LABELS: Record<LateFeeType, string> = {
  fixed: 'Flat charge',
  daily: 'Per day',
};

/** Fallback when a school has never opened the fee settings page. */
export const DEFAULT_DUE_DAY = 10;

/**
 * late_fee_rules — one row per school, holding the fee policy knobs.
 *
 * Late fees are off by default. A school that has not configured a policy
 * should not silently start charging families, so `is_enabled` must be turned
 * on deliberately.
 *
 * `daily` accrues per day past the grace period and is why `max_late_fee`
 * exists: an unpaid challan left for a year would otherwise grow without
 * bound. `fixed` adds one flat charge once the grace period lapses.
 *
 * `due_day_of_month` lives here rather than on `schools` because it is a fee
 * policy, not part of the school's identity — the 10th is the Pakistani
 * convention and the default.
 */
export const lateFeeRules = pgTable(
  'late_fee_rules',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /** GHL Location ID — the tenant key, and unique: one policy per school. */
    locationId: text('location_id')
      .notNull()
      .unique()
      .references(() => schools.locationId, { onDelete: 'cascade' }),
    isEnabled: boolean('is_enabled').notNull().default(false),
    /** Days after the due date before anything is charged. */
    graceDays: integer('grace_days').notNull().default(0),
    lateFeeType: text('late_fee_type').notNull().default('fixed').$type<LateFeeType>(),
    lateFeeAmount: numeric('late_fee_amount', { precision: 10, scale: 2 })
      .notNull()
      .default('0'),
    /** Cap on the accumulated late fee. Null = uncapped. */
    maxLateFee: numeric('max_late_fee', { precision: 10, scale: 2 }),
    /** Day of month challans fall due, 1-28. */
    dueDayOfMonth: integer('due_day_of_month').notNull().default(DEFAULT_DUE_DAY),
    /** Month the school's financial year starts, 1-12. */
    financialYearStartMonth: integer('financial_year_start_month').notNull().default(7),
    /** Printed on challans so parents know where to deposit. */
    bankAccountDetails: text('bank_account_details'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    check(
      'late_fee_rules_late_fee_type_check',
      sql`${table.lateFeeType} IN ('fixed', 'daily')`,
    ),
    check('late_fee_rules_grace_days_check', sql`${table.graceDays} >= 0`),
    check(
      'late_fee_rules_due_day_check',
      sql`${table.dueDayOfMonth} BETWEEN 1 AND 28`,
    ),
    check(
      'late_fee_rules_financial_year_month_check',
      sql`${table.financialYearStartMonth} BETWEEN 1 AND 12`,
    ),
  ],
);

export type LateFeeRule = typeof lateFeeRules.$inferSelect;
export type NewLateFeeRule = typeof lateFeeRules.$inferInsert;

export function isLateFeeType(value: unknown): value is LateFeeType {
  return (
    typeof value === 'string' && (LATE_FEE_TYPES as readonly string[]).includes(value)
  );
}
