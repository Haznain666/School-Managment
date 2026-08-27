import { sql } from 'drizzle-orm';
import { check, index, numeric, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

import { feeChallans } from './fee-challans';
import { schools } from './schools';
import { studentProfiles } from './student-profiles';

export const CREDIT_REASONS = [
  'discount_overflow',
  'applied_to_challan',
  'manual',
] as const;
export type CreditReason = (typeof CREDIT_REASONS)[number];

export const CREDIT_REASON_LABELS: Record<CreditReason, string> = {
  discount_overflow: 'Discount carried forward',
  applied_to_challan: 'Applied to a voucher',
  manual: 'Entered by the school',
};

/**
 * student_credits — money the school owes one child, waiting for a voucher.
 *
 * ── Why this table exists ────────────────────────────────────────────────
 * The product owner's rule, verbatim: *as long as the fee has not been paid,
 * any discount applied will be effective. If the discount has been applied
 * afterwards, then it will appear as adjustment in the next voucher.*
 *
 * The first half is `repriceOpenChallans` in `lib/fee-challans.ts`, which
 * rewrites an unpaid challan in place. The second half has nowhere to go
 * without this table: a paid challan is history and must never be edited, so a
 * discount granted after it settled used simply to vanish — the school believed
 * it had granted it and the parent never saw a rupee of it.
 *
 * It is also the floor under a voucher. A discount larger than what is left to
 * bill must not produce a challan for a negative amount; the challan is floored
 * and the surplus is written here as `discount_overflow`.
 *
 * ── This is NOT the double-entry ledger ──────────────────────────────────
 * Do not try to make it balance. `ledger_transactions` / `ledger_entries` are
 * the school's books; this is a fee-module artefact in exactly the sense that
 * an outstanding balance is one (CLAUDE.md, "Income is recognised on receipt,
 * not on billing"). A credit is not income, not an expense and not cash — it is
 * a promise about what the *next* challan will demand, and it reaches the books
 * only when that challan is paid and the payment posts, for the reduced amount.
 *
 * ── Append-only, in the same sense the ledger is ─────────────────────────
 * Nothing UPDATEs or DELETEs a row here. A grant is a positive `amount`, a
 * consumption is a negative one, and a correction is another row. There is
 * deliberately no `updated_at`, and deliberately no balance column: a student's
 * balance is `SUM(amount)`, for the same reason `ledger_entries` has none. A
 * stored balance is a second source of truth, and it is the one that goes wrong
 * without anybody noticing.
 */
export const studentCredits = pgTable(
  'student_credits',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /** GHL Location ID — the tenant key. */
    locationId: text('location_id')
      .notNull()
      .references(() => schools.locationId, { onDelete: 'cascade' }),
    studentProfileId: uuid('student_profile_id')
      .notNull()
      .references(() => studentProfiles.id, { onDelete: 'cascade' }),
    /** PKR. Positive when granted, negative when consumed. Never zero. */
    amount: numeric('amount', { precision: 12, scale: 2 }).notNull(),
    reason: text('reason').notNull().$type<CreditReason>(),
    /**
     * The challan whose repricing created the credit.
     *
     * SET NULL rather than CASCADE on both challan references: a credit
     * outlives the challan that created it — that is the whole point of it —
     * and a cascade would delete a parent's money along with a cancelled
     * voucher.
     */
    sourceChallanId: uuid('source_challan_id').references(() => feeChallans.id, {
      onDelete: 'set null',
    }),
    /** The challan that spent it, on an `applied_to_challan` row. */
    appliedChallanId: uuid('applied_challan_id').references(() => feeChallans.id, {
      onDelete: 'set null',
    }),
    notes: text('notes'),
    /** Supabase uid of whoever caused it — an audit breadcrumb. */
    createdByUid: text('created_by_uid'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('student_credits_location_id_idx').on(table.locationId),
    index('student_credits_student_profile_id_idx').on(table.studentProfileId),
    check(
      'student_credits_reason_check',
      sql`${table.reason} IN ('discount_overflow', 'applied_to_challan', 'manual')`,
    ),
    // A zero row records nothing and could only ever be the result of a bug.
    check('student_credits_amount_check', sql`${table.amount} <> 0`),
  ],
);

export type StudentCredit = typeof studentCredits.$inferSelect;
export type NewStudentCredit = typeof studentCredits.$inferInsert;

export function isCreditReason(value: unknown): value is CreditReason {
  return (
    typeof value === 'string' && (CREDIT_REASONS as readonly string[]).includes(value)
  );
}
