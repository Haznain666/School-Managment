import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  date,
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
