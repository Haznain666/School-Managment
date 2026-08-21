import { sql } from 'drizzle-orm';
import {
  check,
  date,
  index,
  numeric,
  pgTable,
  text,
  timestamp,
  uuid,
  type AnyPgColumn,
} from 'drizzle-orm/pg-core';

import { LEDGER_SOURCES, type LedgerSource } from '@/lib/accounting';

import { branches } from './branches';
import { ledgerAccounts } from './ledger-accounts';
import { schools } from './schools';

/**
 * ledger_transactions + ledger_entries — the school's books (Sprint 13.5).
 *
 * ── APPEND-ONLY. This is the rule the sprint exists for ──────────────────
 * Nothing in this application updates or deletes a row in either table. Not a
 * typo, not a wrong date, not a payment entered twice. A correction is a
 * second transaction whose lines are the mirror of the first, carrying
 * `reverses_transaction_id`, and both stay in the book.
 *
 * The reason is not purity. It is that a parent disputing a figure in March
 * asks about a payment made in October, and the only answer a school can give
 * is the entry as it was written plus everything that has happened to it
 * since. A ledger that can be edited answers "it says 5,000 now", which is not
 * an answer. Sprints 16 (parent wallet) and 20 (POS) post here, and both carry
 * real money in and out of a parent's balance — the rule has to hold before
 * they arrive, not be retrofitted underneath them.
 *
 * There is no `updated_at` on either table, deliberately: a column that can
 * never move is a column that invites somebody to move it.
 *
 * ── Why the entry has a header ───────────────────────────────────────────
 * `SPRINTS.md` §13.5 names one table, `ledger_entries`. It gets two, and the
 * reason is that a transaction has exactly one date, one memo and one cause,
 * while it has two or more sides. Repeating the date on every line lets the
 * two halves of one transaction fall on different days — which is not a
 * hypothetical: it is what a date picker bound to a repeated field does the
 * first time somebody edits one row of a split.
 *
 * Splits are real here, not theoretical. A fee payment against a challan
 * carrying a concession is one transaction with three lines, and payroll is
 * one transaction with a line per deduction head.
 *
 * ── Money is NUMERIC and arithmetic is in paise ──────────────────────────
 * Same rule as the fee module: `lib/money.ts` converts to integer paise, works
 * there, and converts back on the way out. The `debit + credit > 0` and
 * `debit = 0 OR credit = 0` checks below are what stop a line that is on both
 * sides at once, which every sum in `lib/accounting.ts` would read two ways.
 */
export const ledgerTransactions = pgTable(
  'ledger_transactions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /** GHL Location ID — the tenant key. */
    locationId: text('location_id')
      .notNull()
      .references(() => schools.locationId, { onDelete: 'cascade' }),
    /**
     * The campus the money moved at, or null for a school-level entry.
     *
     * Carried on the transaction rather than derived from the accounts,
     * because the two accounts of a transfer between campuses belong to
     * different branches and the entry belongs to neither more than the other.
     */
    branchId: uuid('branch_id').references(() => branches.id, { onDelete: 'set null' }),
    /**
     * The day the school considers this to have happened.
     *
     * A DATE, not a timestamp: a day book is a day book, and a payment taken
     * at 11pm in Lahore must not appear on the following day's sheet because
     * the server stored it in UTC. `created_at` beside it is when the row was
     * written, and the two differ whenever somebody enters yesterday's takings
     * this morning — which is most mornings.
     */
    entryDate: date('entry_date').notNull(),
    /** What this was, in the school's own words. Printed in the day book. */
    memo: text('memo').notNull(),
    source: text('source').notNull().$type<LedgerSource>(),
    /**
     * The row that caused this — a `fee_payments.id`, an `expenses.id`, a
     * `cash_settlements.id`. Untyped on purpose: a foreign key per source
     * would be six nullable columns of which five are always null, and the
     * `source` column already says which table to look in.
     */
    sourceId: uuid('source_id'),
    /** Cheque number, deposit slip, voucher number — whatever the paper says. */
    referenceNumber: text('reference_number'),
    /**
     * The transaction this one cancels, if it is a correction.
     *
     * Self-referencing, and the only edit-shaped thing in the module: setting
     * it is how a reversal says what it reverses, and reading it is how a
     * screen knows to strike the original through rather than hide it.
     */
    reversesTransactionId: uuid('reverses_transaction_id').references(
      (): AnyPgColumn => ledgerTransactions.id,
      { onDelete: 'restrict' },
    ),
    /** Firebase uid of whoever caused it. Never null: money always has a name on it. */
    createdByUid: text('created_by_uid').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('ledger_transactions_location_id_idx').on(table.locationId),
    // The day book, the account summary and every statement filter on a date
    // range within one school. This is the index all of them use.
    index('ledger_transactions_location_date_idx').on(table.locationId, table.entryDate),
    index('ledger_transactions_source_idx').on(table.locationId, table.source, table.sourceId),
    index('ledger_transactions_reverses_idx').on(table.reversesTransactionId),
    check(
      'ledger_transactions_source_check',
      sql.raw(`source IN (${LEDGER_SOURCES.map((source) => `'${source}'`).join(', ')})`),
    ),
  ],
);

export const ledgerEntries = pgTable(
  'ledger_entries',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /**
     * GHL Location ID — the tenant key.
     *
     * Repeated from the transaction rather than joined for. Every balance in
     * the product is `SUM(debit)` over this table filtered by tenant, and
     * making that read join a header table to establish who it belongs to
     * would put a join on the hot path of every financial screen. The
     * migration's foreign key keeps the two in step.
     */
    locationId: text('location_id')
      .notNull()
      .references(() => schools.locationId, { onDelete: 'cascade' }),
    transactionId: uuid('transaction_id')
      .notNull()
      .references(() => ledgerTransactions.id, { onDelete: 'cascade' }),
    /**
     * `restrict`, not `cascade`: an account with entries cannot be deleted,
     * and the database is where that is finally decided. The API refuses first
     * with a sentence; this is what makes the refusal true.
     */
    accountId: uuid('account_id')
      .notNull()
      .references(() => ledgerAccounts.id, { onDelete: 'restrict' }),
    debit: numeric('debit', { precision: 14, scale: 2 }).notNull().default('0'),
    credit: numeric('credit', { precision: 14, scale: 2 }).notNull().default('0'),
    /** A note on this side alone — which head of a split this line is. */
    memo: text('memo'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('ledger_entries_location_id_idx').on(table.locationId),
    index('ledger_entries_transaction_id_idx').on(table.transactionId),
    // Account summary and every balance: one account within one school.
    index('ledger_entries_location_account_idx').on(table.locationId, table.accountId),
    check('ledger_entries_debit_check', sql`${table.debit} >= 0`),
    check('ledger_entries_credit_check', sql`${table.credit} >= 0`),
    // A line is a debit or a credit. Never both, never neither — the first is
    // ambiguous and the second is a row that does nothing but appear in the
    // day book.
    check(
      'ledger_entries_one_side_check',
      sql`(${table.debit} = 0) <> (${table.credit} = 0)`,
    ),
  ],
);

export type LedgerTransaction = typeof ledgerTransactions.$inferSelect;
export type NewLedgerTransaction = typeof ledgerTransactions.$inferInsert;
export type LedgerEntry = typeof ledgerEntries.$inferSelect;
export type NewLedgerEntry = typeof ledgerEntries.$inferInsert;
