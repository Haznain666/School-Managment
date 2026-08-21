import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  date,
  index,
  numeric,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

import { EXPENSE_STATUSES, type ExpenseStatus } from '@/lib/accounting';

import { branches } from './branches';
import { ledgerAccounts } from './ledger-accounts';
import { ledgerTransactions } from './ledger-entries';
import { schoolUsers } from './school-users';
import { schools } from './schools';

/**
 * expense_categories + expenses — what the school spent (Sprint 13.5).
 *
 * ── This is the ledger's first consumer, and that is the whole point ─────
 * `SPRINTS.md` §13.5 is explicit: *do not build expenses as a flat table with
 * a running total*. A `SUM(amount)` column would work, would be simpler, and
 * would produce a figure that could not be reconciled against the bank —
 * because it would know what was spent and not where the money came from.
 *
 * So an approved expense is not a number in a table. It is a transaction:
 * the category's account is debited, the account it was paid from is
 * credited, and `ledger_transaction_id` below is the link back. Delete the
 * expenses table tomorrow and the school's books are still correct.
 *
 * ── A category names the account, it does not replace it ─────────────────
 * "Van diesel" and "Van repairs" are two words a clerk chooses between and one
 * head — Transport & Fuel — that both post to. Categories are therefore a
 * reference to a `ledger_accounts` row rather than a name copied from one,
 * which is what stops the chart and the picker drifting apart.
 */
export const expenseCategories = pgTable(
  'expense_categories',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /** GHL Location ID — the tenant key. */
    locationId: text('location_id')
      .notNull()
      .references(() => schools.locationId, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    /**
     * The expense head this category posts to.
     *
     * `restrict`: an account a category points at cannot be deleted out from
     * under it, or the next expense filed under that category would have
     * nowhere to go.
     */
    ledgerAccountId: uuid('ledger_account_id')
      .notNull()
      .references(() => ledgerAccounts.id, { onDelete: 'restrict' }),
    isActive: boolean('is_active').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('expense_categories_location_id_idx').on(table.locationId),
    uniqueIndex('expense_categories_location_name_idx').on(
      table.locationId,
      sql`lower(${table.name})`,
    ),
  ],
);

/**
 * expenses — one thing the school paid for.
 *
 * ── Draft, approved, rejected, and no fourth state ───────────────────────
 * See `EXPENSE_STATUSES` in `lib/accounting.ts` for why there is no `paid`:
 * approving *is* paying here, because the same action posts the money out of
 * a cash or bank account. A bill to be paid later is `2000 Accounts Payable`,
 * which is what that account is for.
 *
 * ── Rows here are editable; the ledger they produced is not ──────────────
 * This is the deliberate asymmetry in the module. A draft expense is a form
 * somebody is filling in and may correct freely. The moment it is approved it
 * posts, and from then on the amount, the date, the category and the account
 * are frozen — because they are now describing a transaction that exists, and
 * a description that can be edited away from what it describes is worse than
 * no description. Correcting an approved expense means reversing its posting,
 * which leaves both entries in the book.
 */
export const expenses = pgTable(
  'expenses',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /** GHL Location ID — the tenant key. */
    locationId: text('location_id')
      .notNull()
      .references(() => schools.locationId, { onDelete: 'cascade' }),
    branchId: uuid('branch_id').references(() => branches.id, { onDelete: 'set null' }),
    categoryId: uuid('category_id')
      .notNull()
      .references(() => expenseCategories.id, { onDelete: 'restrict' }),
    /**
     * The asset account the money left — office cash, the bank, or the cash
     * account of the person who paid out of their own float.
     */
    paidFromAccountId: uuid('paid_from_account_id')
      .notNull()
      .references(() => ledgerAccounts.id, { onDelete: 'restrict' }),
    amount: numeric('amount', { precision: 14, scale: 2 }).notNull(),
    expenseDate: date('expense_date').notNull(),
    /** Who was paid. Free text: most of them are not in any table here. */
    payee: text('payee'),
    /** Bill number, receipt number, cheque number. */
    referenceNumber: text('reference_number'),
    /**
     * The bill, photographed or scanned.
     *
     * A URL rather than bytes — this application stores no files itself (see
     * `lib/storage.ts`), and an expense with no attachment is ordinary rather
     * than incomplete: the receipt for a 200-rupee rickshaw fare does not
     * exist and never will.
     */
    attachmentUrl: text('attachment_url'),
    notes: text('notes'),
    status: text('status').notNull().default('draft').$type<ExpenseStatus>(),
    createdByUid: text('created_by_uid').notNull(),
    /**
     * Who approved or rejected it, as a `school_users` row rather than a uid.
     *
     * Deliberately different from `created_by_uid` beside it: the creator is
     * an audit breadcrumb and a uid is enough, while the approver is a person
     * whose name is printed on the voucher and shown against the expense, and
     * a name needs a join.
     */
    approvedBy: uuid('approved_by').references(() => schoolUsers.id, {
      onDelete: 'set null',
    }),
    approvedAt: timestamp('approved_at', { withTimezone: true }),
    /** Why it was refused. Required by the API when rejecting. */
    rejectionReason: text('rejection_reason'),
    /**
     * The posting this expense produced, once approved.
     *
     * Null while it is a draft, and null forever if it is rejected — which is
     * exactly the difference between a request for money and money that left
     * the school.
     */
    ledgerTransactionId: uuid('ledger_transaction_id').references(
      () => ledgerTransactions.id,
      { onDelete: 'set null' },
    ),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('expenses_location_id_idx').on(table.locationId),
    index('expenses_location_date_idx').on(table.locationId, table.expenseDate),
    index('expenses_location_status_idx').on(table.locationId, table.status),
    index('expenses_category_id_idx').on(table.categoryId),
    check('expenses_amount_check', sql`${table.amount} > 0`),
    check(
      'expenses_status_check',
      sql.raw(`status IN (${EXPENSE_STATUSES.map((status) => `'${status}'`).join(', ')})`),
    ),
    // An approved expense has a posting; a draft or rejected one does not.
    // Without this the two could disagree, and the profit and loss would then
    // carry a figure that no screen could explain.
    check(
      'expenses_posting_check',
      sql`(${table.status} = 'approved') = (${table.ledgerTransactionId} IS NOT NULL)`,
    ),
  ],
);

export type ExpenseCategory = typeof expenseCategories.$inferSelect;
export type NewExpenseCategory = typeof expenseCategories.$inferInsert;
export type Expense = typeof expenses.$inferSelect;
export type NewExpense = typeof expenses.$inferInsert;
