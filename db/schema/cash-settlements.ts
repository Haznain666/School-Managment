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
} from 'drizzle-orm/pg-core';

import { ledgerAccounts } from './ledger-accounts';
import { ledgerTransactions } from './ledger-entries';
import { schoolUsers } from './school-users';
import { schools } from './schools';

/**
 * cash_settlements — a counter clerk handing their takings to the office.
 *
 * ── What this is, in the room ────────────────────────────────────────────
 * A Pakistani school runs its fee counter with a person and a drawer. Parents
 * pay that person across a desk all morning; at some point in the afternoon
 * they count the drawer and hand it to the bursar, who counts it again. Until
 * that moment the money is the school's but it is *in the clerk's hands*, and
 * the two facts are different facts.
 *
 * Every other design collapses them. If a cash payment goes straight to
 * `1000 Cash in Hand`, the office cash balance says the money is in the office
 * safe when it is in a drawer on the other side of the building, and nobody
 * can be short. So each person who takes money gets their own asset account
 * (`ledger_accounts.owner_user_id`), a payment they take lands there, and
 * settling is a transaction that moves it: debit office cash, credit the
 * clerk's account.
 *
 * **A clerk's balance is what they owe the school right now.** That single
 * number is what this whole design is for, and it is the number the competitor
 * demonstrates.
 *
 * ── The short is visible, not hidden ─────────────────────────────────────
 * `expected_amount` is what their account held when the settlement was
 * recorded; `amount` is what was actually handed over. They differ when the
 * drawer is short or over, and the difference stays in the clerk's account as
 * a balance they still carry rather than being written off — writing it off is
 * a decision a head teacher makes with a journal entry, not something a form
 * does silently at 4pm.
 *
 * ── Append-only, like everything else here ───────────────────────────────
 * A settlement is not edited. A wrong one is reversed, which reverses its
 * posting too, and both stay in the book.
 */
export const cashSettlements = pgTable(
  'cash_settlements',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /** GHL Location ID — the tenant key. */
    locationId: text('location_id')
      .notNull()
      .references(() => schools.locationId, { onDelete: 'cascade' }),
    /** Whose takings these are. */
    staffUserId: uuid('staff_user_id')
      .notNull()
      .references(() => schoolUsers.id, { onDelete: 'restrict' }),
    /** Their cash account — the credit side. */
    fromAccountId: uuid('from_account_id')
      .notNull()
      .references(() => ledgerAccounts.id, { onDelete: 'restrict' }),
    /** Where it was handed to: office cash, or straight into the bank. */
    toAccountId: uuid('to_account_id')
      .notNull()
      .references(() => ledgerAccounts.id, { onDelete: 'restrict' }),
    /** What was actually handed over and counted. */
    amount: numeric('amount', { precision: 14, scale: 2 }).notNull(),
    /**
     * What their account held at the moment of settling.
     *
     * Stored rather than recomputed: recomputing it later gives today's
     * balance, not the one the two people in the room agreed on, and the whole
     * value of the figure is that it is the one they signed against.
     */
    expectedAmount: numeric('expected_amount', { precision: 14, scale: 2 }).notNull(),
    settlementDate: date('settlement_date').notNull(),
    /** The bursar. Distinct from the clerk — a settlement has two people in it. */
    receivedByUid: text('received_by_uid').notNull(),
    /** Deposit slip number, if it went to the bank. */
    referenceNumber: text('reference_number'),
    notes: text('notes'),
    ledgerTransactionId: uuid('ledger_transaction_id')
      .notNull()
      .references(() => ledgerTransactions.id, { onDelete: 'restrict' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('cash_settlements_location_id_idx').on(table.locationId),
    index('cash_settlements_location_date_idx').on(table.locationId, table.settlementDate),
    index('cash_settlements_staff_user_id_idx').on(table.staffUserId),
    check('cash_settlements_amount_check', sql`${table.amount} > 0`),
    // Handing money to the account it came from moves nothing and would post a
    // transaction whose two lines cancel on the same account.
    check(
      'cash_settlements_accounts_differ_check',
      sql`${table.fromAccountId} <> ${table.toAccountId}`,
    ),
  ],
);

export type CashSettlement = typeof cashSettlements.$inferSelect;
export type NewCashSettlement = typeof cashSettlements.$inferInsert;
