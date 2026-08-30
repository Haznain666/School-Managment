import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  date,
  index,
  integer,
  numeric,
  pgTable,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';

import { branches } from './branches';
import { schools } from './schools';

export const LATE_FEE_TYPES = ['fixed', 'daily'] as const;
export type LateFeeType = (typeof LATE_FEE_TYPES)[number];

export const LATE_FEE_TYPE_LABELS: Record<LateFeeType, string> = {
  fixed: 'One-off charge',
  daily: 'Per day overdue',
};

/**
 * late_fee_rules — one row per school, holding its fee timing policy.
 *
 * Late fees are off by default, because a school that has not configured a
 * policy must not start silently adding charges to its parents' challans.
 *
 * `grace_days` is counted from the due date, so a rule with three grace days
 * charges nothing until the fourth day. A `daily` rule is capped by
 * `max_late_fee` when set — without a cap an unpaid challan would grow without
 * limit, which no school actually wants.
 *
 * `due_day` lives here rather than in a table of its own because it is the same
 * kind of setting — one number, per school, about when fees fall due — and a
 * second single-row settings table would only be somewhere else to look.
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
    /**
     * The campus that owns this policy, or null when the school shares it.
     *
     * ⚠ Inert today, and deliberately so. `location_id` above is `.unique()` —
     * one policy per school — so no second row can exist to carry a campus, and
     * every row is and stays null. The column ships now because it is
     * expand-only and because relaxing that unique index is a *separate*
     * decision: the moment two rows can exist, every reader of this table has
     * to choose between them, and there is no code today that would. See
     * `SPRINT-19A-DDL-NOTES.md`.
     */
    branchId: uuid('branch_id').references(() => branches.id, {
      onDelete: 'set null',
    }),
    /**
     * Day of the month a monthly challan falls due. The 10th unless the school
     * says otherwise; capped at 28 so every month has one.
     */
    dueDay: integer('due_day').notNull().default(10),
    isEnabled: boolean('is_enabled').notNull().default(false),
    graceDays: integer('grace_days').notNull().default(0),
    lateFeeType: text('late_fee_type').notNull().default('fixed').$type<LateFeeType>(),
    lateFeeAmount: numeric('late_fee_amount', { precision: 10, scale: 2 })
      .notNull()
      .default('0'),
    /** Ceiling for a daily rule. Null = uncapped. */
    maxLateFee: numeric('max_late_fee', { precision: 10, scale: 2 }),
    /**
     * Whether the school emails its parents this month's open vouchers on a
     * timer (Sprint 18, item 17).
     *
     * **Off, and it must stay off until a school turns it on.** A sprint that
     * deployed and started writing to every parent at a school that never
     * asked for it would be the single worst thing this module could do, and
     * it would be irreversible — an email cannot be recalled.
     */
    autoSendVouchers: boolean('auto_send_vouchers').notNull().default(false),
    /** Day of the month the send runs. Capped at 28 so every month has one. */
    autoSendDay: integer('auto_send_day').notNull().default(28),
    /**
     * The claim column. The date the sweep last ran for this school.
     *
     * CLAUDE.md's rule, and the reason this is a column rather than a variable
     * in the sweeper: production runs **seven** server processes, each with its
     * own timer, and a read-then-check lets all seven decide to send. The
     * sweeper claims the school with a conditional
     * `UPDATE … WHERE auto_send_last_run_on IS NULL OR < today … RETURNING`, so
     * Postgres decides it on one row under one lock and exactly one process
     * gets it. Null means never run.
     */
    autoSendLastRunOn: date('auto_send_last_run_on'),
    /**
     * Whether enrolling a child who already has a brother or sister here grants
     * the school's sibling scheme without being asked (Sprint 20, item 6a).
     *
     * **Off, and it must stay off until a school turns it on.** This is the fee
     * module's equivalent of `auto_send_vouchers` above and it is worse in one
     * respect: an email cannot be recalled, and a discount applied by surprise
     * cannot be un-applied either — by the time anybody notices, the vouchers
     * have been priced, printed and in some cases paid. A school that wants it
     * says so on `/dashboard/fees/settings`.
     */
    autoApplySiblingDiscount: boolean('auto_apply_sibling_discount')
      .notNull()
      .default(false),
    /**
     * Whether the last child of a family keeps the sibling discount once every
     * other sibling has left (Sprint 20, item 6b).
     *
     * Default false, which is what the requirement describes: a discount given
     * for *having* siblings is not owed to a child who no longer has any. A
     * school that reads it as a loyalty discount instead switches this on and
     * `lib/sibling-discounts.ts` stops removing anything.
     */
    siblingDiscountForLastChild: boolean('sibling_discount_for_last_child')
      .notNull()
      .default(false),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index('late_fee_rules_location_branch_idx').on(table.locationId, table.branchId),
    check(
      'late_fee_rules_late_fee_type_check',
      sql`${table.lateFeeType} IN ('fixed', 'daily')`,
    ),
    check('late_fee_rules_due_day_check', sql`${table.dueDay} BETWEEN 1 AND 28`),
    check(
      'late_fee_rules_auto_send_day_check',
      sql`${table.autoSendDay} BETWEEN 1 AND 28`,
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
