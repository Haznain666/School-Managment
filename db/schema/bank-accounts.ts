import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';

import { branches } from './branches';
import { schools } from './schools';

/**
 * Who an account is for.
 *
 * **Three values, not two booleans.** Two checkboxes admit a fourth state —
 * neither ticked — which is an account that exists and is for nothing, and the
 * screen would then have to decide whether that means "both" or "hidden". A
 * radio group cannot be left blank, so the column cannot hold the answer
 * nobody meant.
 */
export const BANK_PURPOSES = ['student', 'staff', 'both'] as const;
export type BankPurpose = (typeof BANK_PURPOSES)[number];

export const BANK_PURPOSE_LABELS: Record<BankPurpose, string> = {
  student: 'Students',
  staff: 'Staff',
  both: 'Both',
};

export const BANK_PURPOSE_HINTS: Record<BankPurpose, string> = {
  student: 'Printed on fee vouchers. Parents pay into this account.',
  staff: 'Salaries are paid out of this account. Never printed on a voucher.',
  both: 'Fees come in and salaries go out of the same account.',
};

/** Which purposes reach a parent's fee voucher. */
export const VOUCHER_BANK_PURPOSES = ['student', 'both'] as const;

export function isBankPurpose(value: unknown): value is BankPurpose {
  return typeof value === 'string' && (BANK_PURPOSES as readonly string[]).includes(value);
}

/**
 * bank_accounts — where a school's money arrives and where its salaries leave
 * from (Sprint 20, item 10).
 *
 * ── Why this is school-wide reference data and not a fee table ───────────
 * Two modules read it and neither owns it: Fees prints the student-facing
 * accounts on a voucher, and Payroll pays out of the staff-facing ones. Filing
 * it under Fees would put the payroll bank under Fees, which is where nobody
 * would look for it — so it lives at `/dashboard/settings/banks` beside the
 * school profile, on the same `settings.read` / `settings.write` pair. **No new
 * permission key**, and therefore no change to the `role_permissions` CHECK,
 * which is the trap STATE.md §5o records.
 *
 * ── `branch_id` is nullable and null means shared ────────────────────────
 * Decision D1 of Sprint 19a, one table further on: a group whose Karachi campus
 * banks with a different branch of the same bank gives that account a
 * `branch_id`, and everything else stays null and prints everywhere.
 * `sharedOrOwnedBy` in `lib/branch-scope.ts` is the predicate — never `eq`,
 * which would hide every shared row, and every row is shared on the day this
 * ships.
 *
 * ── Nothing here is money, so nothing here posts to the ledger ───────────
 * An account *number* is not a balance. The ledger's cash and bank accounts are
 * `ledger_accounts` rows and are an entirely separate thing with an entirely
 * separate job; this table holds the digits a parent types into their banking
 * app. Deliberately not joined to `ledger_accounts`: a school has one office
 * cash account and four bank accounts it prints, and forcing the two into one
 * row would make opening a chart-of-accounts line a prerequisite for printing a
 * voucher.
 *
 * ── Deleting is allowed, and the confirmation is the safeguard ───────────
 * The obvious rule — refuse a delete once the account has been printed on a
 * voucher — cannot be enforced, because nothing records that a voucher was
 * printed and nothing snapshots the account onto it. So delete stays, the
 * confirmation says plainly that vouchers already printed carry these details
 * and will not change, and `is_active` is offered as the safer act: a school
 * closing an account needs the number off tomorrow's vouchers without losing
 * the record of where last month's money went.
 */
export const bankAccounts = pgTable(
  'bank_accounts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /** GHL Location ID — the tenant key. */
    locationId: text('location_id')
      .notNull()
      .references(() => schools.locationId, { onDelete: 'cascade' }),
    /**
     * The campus that owns this account, or null when the school shares it.
     * Read with `sharedOrOwnedBy`, never `eq` — see this file's docblock and
     * `db/schema/subjects.ts` for why it is nullable rather than backfilled.
     */
    branchId: uuid('branch_id').references(() => branches.id, {
      onDelete: 'set null',
    }),
    /** Who the cheque is made out to, exactly as the bank holds it. */
    accountTitle: text('account_title').notNull(),
    bankName: text('bank_name').notNull(),
    /** The *bank's* branch, not the school's. Nullable — an IBAN implies it. */
    branchName: text('branch_name'),
    branchCode: text('branch_code'),
    accountNumber: text('account_number').notNull(),
    iban: text('iban'),
    /** The international block, printed only when a school actually has one. */
    swiftCode: text('swift_code'),
    bankAddress: text('bank_address'),
    intermediaryBank: text('intermediary_bank'),
    intermediarySwift: text('intermediary_swift'),
    /**
     * Stored rather than assumed, because a school with an overseas fee account
     * has one in USD and printing `PKR` beside it would be wrong in the one
     * place being wrong costs a parent a wire fee.
     */
    currency: text('currency').notNull().default('PKR'),
    purpose: text('purpose').notNull().default('student').$type<BankPurpose>(),
    /** Free text printed under the account on the voucher. */
    instructions: text('instructions'),
    /**
     * Whether the account prints and is offered.
     *
     * An inactive account never reaches a voucher. That is the whole point of
     * the toggle: closing an account is a thing a school does on a Tuesday, and
     * the record of where last month's money went has to survive it.
     */
    isActive: boolean('is_active').notNull().default(true),
    /** The order they print in on the voucher, then by bank name. */
    sortOrder: integer('sort_order').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('bank_accounts_location_id_idx').on(table.locationId),
    // The voucher's own read: this school's student-facing accounts.
    index('bank_accounts_location_purpose_idx').on(table.locationId, table.purpose),
    index('bank_accounts_location_branch_idx').on(table.locationId, table.branchId),
    check(
      'bank_accounts_purpose_check',
      sql`${table.purpose} IN ('student', 'staff', 'both')`,
    ),
  ],
);

export type BankAccount = typeof bankAccounts.$inferSelect;
export type NewBankAccount = typeof bankAccounts.$inferInsert;
