import 'server-only';

import {
  and,
  asc,
  desc,
  eq,
  gte,
  inArray,
  lte,
  notInArray,
  sql,
  type SQL,
} from 'drizzle-orm';

import {
  branches,
  cashSettlements,
  expenseCategories,
  expenses,
  ledgerAccounts,
  ledgerEntries,
  ledgerTransactions,
  schoolUsers,
} from '@/db/schema';

import {
  DEFAULT_CHART,
  DEFAULT_EXPENSE_CATEGORIES,
  balancePaise,
  type AccountBalance,
  type ExpenseStatus,
  type LedgerAccountType,
  type LedgerSource,
  type SystemAccountKey,
} from './accounting';
import { db, type Database, type Tx } from './drizzle';
import { toPaise } from './money';

/**
 * Reading the books — Sprint 13.5.
 *
 * ── Every balance is a SUM over `ledger_entries` ─────────────────────────
 * There is no `balance` column anywhere in this module, and there will not be
 * one. A stored balance is a second copy of a number the entries already
 * determine, and the two disagree the first time a posting fails halfway. The
 * indexes that make this affordable are `ledger_entries_location_account_idx`
 * and `ledger_transactions_location_date_idx`; a school with a decade of
 * entries would want a monthly rollup table, and that is a real conversation to
 * have when a school has a decade of entries rather than now.
 *
 * ── Dates are compared with operators, never a raw template ──────────────
 * `gte`/`lte`, not `` sql`${column} <= ${value}` ``. The raw form is the one
 * construct where Drizzle has no column to map the value against, and it is
 * what left every scheduled announcement unsent from Sprint 11 to 2026-08-20
 * (`CLAUDE.md`, STATE.md §5at). The values here are `YYYY-MM-DD` strings
 * against `date` columns, which would survive it — but the rule holds for the
 * next person, who will be comparing a timestamp.
 */

/* -----------------------------------------------------------------------------
 * The chart of accounts
 * -------------------------------------------------------------------------- */

export interface ChartAccountRow {
  id: string;
  code: string;
  name: string;
  type: LedgerAccountType;
  description: string | null;
  systemKey: string | null;
  isActive: boolean;
  ownerUserId: string | null;
  ownerName: string | null;
  branchId: string | null;
  branchName: string | null;
}

/**
 * The whole chart, in code order.
 *
 * Inactive accounts are included by default and marked. A picker filters them
 * out; a statement must not, because an account that has been posted to is
 * part of the history of the school's money and a balance sheet that dropped
 * one would stop balancing.
 */
export async function listLedgerAccounts(
  locationId: string,
  options: { activeOnly?: boolean } = {},
): Promise<ChartAccountRow[]> {
  const conditions: SQL[] = [eq(ledgerAccounts.locationId, locationId)];
  if (options.activeOnly === true) conditions.push(eq(ledgerAccounts.isActive, true));

  const rows = await db
    .select({
      id: ledgerAccounts.id,
      code: ledgerAccounts.code,
      name: ledgerAccounts.name,
      type: ledgerAccounts.type,
      description: ledgerAccounts.description,
      systemKey: ledgerAccounts.systemKey,
      isActive: ledgerAccounts.isActive,
      ownerUserId: ledgerAccounts.ownerUserId,
      ownerName: schoolUsers.name,
      branchId: ledgerAccounts.branchId,
      branchName: branches.name,
    })
    .from(ledgerAccounts)
    .leftJoin(schoolUsers, eq(schoolUsers.id, ledgerAccounts.ownerUserId))
    .leftJoin(branches, eq(branches.id, ledgerAccounts.branchId))
    .where(and(...conditions))
    .orderBy(asc(ledgerAccounts.code));

  return rows;
}

/**
 * Seeds the chart and its expense categories. Idempotent.
 *
 * Called on school creation and offered as a button on an empty chart, which
 * covers both directions: a school provisioned after this sprint never sees
 * the empty state, and one provisioned before it gets out of the empty state
 * in one click. Migration `0027` did the same thing for the schools that
 * existed when it ran — this is the same list, and
 * `scripts/check-accounting.ts` asserts the two agree.
 *
 * Returns how many accounts were actually new, so a caller can tell "set up"
 * from "already set up" without a second query.
 */
export async function seedChartOfAccounts(
  locationId: string,
  runner: Tx | Database = db,
): Promise<{ accountsCreated: number; categoriesCreated: number }> {
  const created = await runner
    .insert(ledgerAccounts)
    .values(
      DEFAULT_CHART.map((seed) => ({
        locationId,
        code: seed.code,
        name: seed.name,
        type: seed.type,
        systemKey: seed.systemKey,
        description: seed.description,
      })),
    )
    .onConflictDoNothing()
    .returning({ id: ledgerAccounts.id });

  // Read the whole chart back rather than relying on what the insert returned:
  // a school seeded before this call has the accounts already, and its
  // categories still need somewhere to point.
  const accounts = await runner
    .select({ id: ledgerAccounts.id, code: ledgerAccounts.code })
    .from(ledgerAccounts)
    .where(eq(ledgerAccounts.locationId, locationId));

  const byCode = new Map(accounts.map((account) => [account.code, account.id]));

  const categoryValues = DEFAULT_EXPENSE_CATEGORIES.flatMap((seed) => {
    const accountId = byCode.get(seed.accountCode);
    return accountId === undefined ? [] : [{ locationId, name: seed.name, ledgerAccountId: accountId }];
  });

  if (categoryValues.length === 0) {
    return { accountsCreated: created.length, categoriesCreated: 0 };
  }

  const categories = await runner
    .insert(expenseCategories)
    .values(categoryValues)
    .onConflictDoNothing()
    .returning({ id: expenseCategories.id });

  return { accountsCreated: created.length, categoriesCreated: categories.length };
}

/* -----------------------------------------------------------------------------
 * Balances
 * -------------------------------------------------------------------------- */

export interface BalanceWindow {
  /** `YYYY-MM-DD`, inclusive. Omit for "since the school's first entry". */
  from?: string;
  /** `YYYY-MM-DD`, inclusive. Omit for "up to today". */
  to?: string;
  branchId?: string;
}

function transactionWindow(locationId: string, window: BalanceWindow): SQL[] {
  const conditions: SQL[] = [eq(ledgerTransactions.locationId, locationId)];
  if (window.from !== undefined) {
    conditions.push(gte(ledgerTransactions.entryDate, window.from));
  }
  if (window.to !== undefined) {
    conditions.push(lte(ledgerTransactions.entryDate, window.to));
  }
  if (window.branchId !== undefined) {
    conditions.push(eq(ledgerTransactions.branchId, window.branchId));
  }
  return conditions;
}

/**
 * Debit and credit totals per account over a window.
 *
 * Accounts with no movement in the window are returned with zeroes rather than
 * omitted, which is what lets a balance sheet show `Bank … 0` instead of
 * quietly leaving the line out. A missing line reads as "we do not have a bank
 * account"; a zero reads as "there is nothing in it", and only one of those is
 * true.
 */
export interface LedgerAccountBalance extends AccountBalance {
  /**
   * Carried on the balance so callers can find "the cash account" without
   * matching on a code or a name. A school may recode `1000` to `101` and
   * rename it "Main office drawer" on its first afternoon, and both the
   * overview tiles and the fee-payment posting have to keep working when it
   * does.
   */
  systemKey: SystemAccountKey | null;
  isActive: boolean;
}

export async function getAccountBalances(
  locationId: string,
  window: BalanceWindow = {},
): Promise<LedgerAccountBalance[]> {
  const accounts = await db
    .select({
      id: ledgerAccounts.id,
      code: ledgerAccounts.code,
      name: ledgerAccounts.name,
      type: ledgerAccounts.type,
      systemKey: ledgerAccounts.systemKey,
      isActive: ledgerAccounts.isActive,
    })
    .from(ledgerAccounts)
    .where(eq(ledgerAccounts.locationId, locationId))
    .orderBy(asc(ledgerAccounts.code));

  const totals = await db
    .select({
      accountId: ledgerEntries.accountId,
      debit: sql<string>`coalesce(sum(${ledgerEntries.debit}), 0)`,
      credit: sql<string>`coalesce(sum(${ledgerEntries.credit}), 0)`,
    })
    .from(ledgerEntries)
    .innerJoin(ledgerTransactions, eq(ledgerTransactions.id, ledgerEntries.transactionId))
    .where(and(...transactionWindow(locationId, window)))
    .groupBy(ledgerEntries.accountId);

  const byAccount = new Map(totals.map((row) => [row.accountId, row]));

  return accounts.map((account) => {
    const total = byAccount.get(account.id);
    return {
      accountId: account.id,
      code: account.code,
      name: account.name,
      type: account.type,
      systemKey: account.systemKey,
      isActive: account.isActive,
      debitPaise: toPaise(total?.debit ?? '0'),
      creditPaise: toPaise(total?.credit ?? '0'),
    };
  });
}

/** One account's balance, or zero if it has never been posted to. */
export async function getAccountBalance(
  locationId: string,
  accountId: string,
  window: BalanceWindow = {},
  /**
   * Pass the open transaction when the answer is about to be acted on.
   *
   * The settlement route holds a lock on the drawer while it reads this. On
   * `db` the read would go out over a different pooled connection — still
   * correct under READ COMMITTED, but correct by accident, and the next person
   * to add a `FOR UPDATE` beside it would have no way to tell.
   */
  runner: Tx | Database = db,
): Promise<number> {
  const [account] = await runner
    .select({ type: ledgerAccounts.type })
    .from(ledgerAccounts)
    .where(and(eq(ledgerAccounts.locationId, locationId), eq(ledgerAccounts.id, accountId)))
    .limit(1);

  if (account === undefined) return 0;

  const [total] = await runner
    .select({
      debit: sql<string>`coalesce(sum(${ledgerEntries.debit}), 0)`,
      credit: sql<string>`coalesce(sum(${ledgerEntries.credit}), 0)`,
    })
    .from(ledgerEntries)
    .innerJoin(ledgerTransactions, eq(ledgerTransactions.id, ledgerEntries.transactionId))
    .where(
      and(...transactionWindow(locationId, window), eq(ledgerEntries.accountId, accountId)),
    );

  return balancePaise(account.type, {
    debitPaise: toPaise(total?.debit ?? '0'),
    creditPaise: toPaise(total?.credit ?? '0'),
  });
}

/* -----------------------------------------------------------------------------
 * The day book
 * -------------------------------------------------------------------------- */

export interface DayBookLine {
  accountId: string;
  accountCode: string;
  accountName: string;
  debitPaise: number;
  creditPaise: number;
  memo: string | null;
}

export interface DayBookEntry {
  id: string;
  entryDate: string;
  memo: string;
  source: LedgerSource;
  sourceId: string | null;
  referenceNumber: string | null;
  branchName: string | null;
  createdByUid: string;
  createdAt: Date;
  /** Set when this entry cancels another. */
  reversesTransactionId: string | null;
  /** Set when another entry cancels this one — it is struck through on screen. */
  reversedByTransactionId: string | null;
  lines: DayBookLine[];
  totalPaise: number;
}

/**
 * The day book: every transaction in a window, with its lines.
 *
 * Two queries rather than one joined read. A join returns one row per line and
 * the caller has to regroup, which is the same work with a larger result set
 * and one more place to get the grouping wrong.
 *
 * `reversedByTransactionId` is computed here because it is the difference
 * between a day book that reads correctly and one that lies by omission: a
 * reversed 50,000 payment must still be on the sheet, struck through, beside
 * the entry that cancelled it.
 */
export async function listDayBook(
  locationId: string,
  window: BalanceWindow & { source?: LedgerSource; accountId?: string; limit?: number } = {},
): Promise<DayBookEntry[]> {
  const conditions = transactionWindow(locationId, window);
  if (window.source !== undefined) {
    conditions.push(eq(ledgerTransactions.source, window.source));
  }

  if (window.accountId !== undefined) {
    conditions.push(
      sql`exists (
        select 1 from ${ledgerEntries}
        where ${ledgerEntries.transactionId} = ${ledgerTransactions.id}
          and ${ledgerEntries.accountId} = ${window.accountId}
      )`,
    );
  }

  const transactions = await db
    .select({
      id: ledgerTransactions.id,
      entryDate: ledgerTransactions.entryDate,
      memo: ledgerTransactions.memo,
      source: ledgerTransactions.source,
      sourceId: ledgerTransactions.sourceId,
      referenceNumber: ledgerTransactions.referenceNumber,
      reversesTransactionId: ledgerTransactions.reversesTransactionId,
      createdByUid: ledgerTransactions.createdByUid,
      createdAt: ledgerTransactions.createdAt,
      branchName: branches.name,
    })
    .from(ledgerTransactions)
    .leftJoin(branches, eq(branches.id, ledgerTransactions.branchId))
    .where(and(...conditions))
    .orderBy(desc(ledgerTransactions.entryDate), desc(ledgerTransactions.createdAt))
    .limit(window.limit ?? 500);

  if (transactions.length === 0) return [];

  const ids = transactions.map((transaction) => transaction.id);

  const lines = await db
    .select({
      transactionId: ledgerEntries.transactionId,
      accountId: ledgerEntries.accountId,
      accountCode: ledgerAccounts.code,
      accountName: ledgerAccounts.name,
      debit: ledgerEntries.debit,
      credit: ledgerEntries.credit,
      memo: ledgerEntries.memo,
    })
    .from(ledgerEntries)
    .innerJoin(ledgerAccounts, eq(ledgerAccounts.id, ledgerEntries.accountId))
    .where(inArray(ledgerEntries.transactionId, ids))
    .orderBy(desc(ledgerEntries.debit));

  const reversals = await db
    .select({
      id: ledgerTransactions.id,
      reversesTransactionId: ledgerTransactions.reversesTransactionId,
    })
    .from(ledgerTransactions)
    .where(
      and(
        eq(ledgerTransactions.locationId, locationId),
        inArray(ledgerTransactions.reversesTransactionId, ids),
      ),
    );

  const reversedBy = new Map(
    reversals.flatMap((row) =>
      row.reversesTransactionId === null ? [] : [[row.reversesTransactionId, row.id]],
    ),
  );

  const linesByTransaction = new Map<string, DayBookLine[]>();
  for (const line of lines) {
    const list = linesByTransaction.get(line.transactionId) ?? [];
    list.push({
      accountId: line.accountId,
      accountCode: line.accountCode,
      accountName: line.accountName,
      debitPaise: toPaise(line.debit),
      creditPaise: toPaise(line.credit),
      memo: line.memo,
    });
    linesByTransaction.set(line.transactionId, list);
  }

  return transactions.map((transaction) => {
    const entryLines = linesByTransaction.get(transaction.id) ?? [];
    return {
      ...transaction,
      reversedByTransactionId: reversedBy.get(transaction.id) ?? null,
      lines: entryLines,
      totalPaise: entryLines.reduce((total, line) => total + line.debitPaise, 0),
    };
  });
}

/* -----------------------------------------------------------------------------
 * Expenses
 * -------------------------------------------------------------------------- */

export interface ExpenseCategoryRow {
  id: string;
  name: string;
  isActive: boolean;
  ledgerAccountId: string;
  accountCode: string;
  accountName: string;
  /** How many expenses have been filed under it — a category in use is not deletable. */
  expenseCount: number;
}

export async function listExpenseCategories(
  locationId: string,
): Promise<ExpenseCategoryRow[]> {
  return db
    .select({
      id: expenseCategories.id,
      name: expenseCategories.name,
      isActive: expenseCategories.isActive,
      ledgerAccountId: expenseCategories.ledgerAccountId,
      accountCode: ledgerAccounts.code,
      accountName: ledgerAccounts.name,
      expenseCount: sql<number>`(
        select count(*)::int from ${expenses}
        where ${expenses.categoryId} = ${expenseCategories.id}
      )`,
    })
    .from(expenseCategories)
    .innerJoin(ledgerAccounts, eq(ledgerAccounts.id, expenseCategories.ledgerAccountId))
    .where(eq(expenseCategories.locationId, locationId))
    .orderBy(asc(expenseCategories.name));
}

export interface ExpenseRow {
  id: string;
  expenseDate: string;
  amountPaise: number;
  status: ExpenseStatus;
  payee: string | null;
  referenceNumber: string | null;
  attachmentUrl: string | null;
  notes: string | null;
  rejectionReason: string | null;
  categoryId: string;
  categoryName: string;
  accountCode: string;
  accountName: string;
  paidFromAccountId: string;
  paidFromName: string;
  branchId: string | null;
  branchName: string | null;
  approverName: string | null;
  approvedAt: Date | null;
  ledgerTransactionId: string | null;
  createdByUid: string;
  createdAt: Date;
}

export interface ExpenseFilter {
  from?: string;
  to?: string;
  status?: ExpenseStatus;
  categoryId?: string;
  branchId?: string;
  expenseId?: string;
  limit?: number;
}

export async function listExpenses(
  locationId: string,
  filter: ExpenseFilter = {},
): Promise<ExpenseRow[]> {
  const conditions: SQL[] = [eq(expenses.locationId, locationId)];
  if (filter.from !== undefined) conditions.push(gte(expenses.expenseDate, filter.from));
  if (filter.to !== undefined) conditions.push(lte(expenses.expenseDate, filter.to));
  if (filter.status !== undefined) conditions.push(eq(expenses.status, filter.status));
  if (filter.categoryId !== undefined) {
    conditions.push(eq(expenses.categoryId, filter.categoryId));
  }
  if (filter.branchId !== undefined) conditions.push(eq(expenses.branchId, filter.branchId));
  if (filter.expenseId !== undefined) conditions.push(eq(expenses.id, filter.expenseId));

  const rows = await db
    .select({
      id: expenses.id,
      expenseDate: expenses.expenseDate,
      amount: expenses.amount,
      status: expenses.status,
      payee: expenses.payee,
      referenceNumber: expenses.referenceNumber,
      attachmentUrl: expenses.attachmentUrl,
      notes: expenses.notes,
      rejectionReason: expenses.rejectionReason,
      categoryId: expenses.categoryId,
      categoryName: expenseCategories.name,
      accountCode: ledgerAccounts.code,
      accountName: ledgerAccounts.name,
      paidFromAccountId: expenses.paidFromAccountId,
      // The account the money left, resolved through a second lookup rather
      // than a second join on the same table — Drizzle needs an alias for
      // that, and the sub-select reads better than one.
      paidFromName: sql<string>`(
        select ${ledgerAccounts.name} from ${ledgerAccounts}
        where ${ledgerAccounts.id} = ${expenses.paidFromAccountId}
      )`,
      branchId: expenses.branchId,
      branchName: branches.name,
      approverName: schoolUsers.name,
      approvedAt: expenses.approvedAt,
      ledgerTransactionId: expenses.ledgerTransactionId,
      createdByUid: expenses.createdByUid,
      createdAt: expenses.createdAt,
    })
    .from(expenses)
    .innerJoin(expenseCategories, eq(expenseCategories.id, expenses.categoryId))
    .innerJoin(ledgerAccounts, eq(ledgerAccounts.id, expenseCategories.ledgerAccountId))
    .leftJoin(branches, eq(branches.id, expenses.branchId))
    .leftJoin(schoolUsers, eq(schoolUsers.id, expenses.approvedBy))
    .where(and(...conditions))
    .orderBy(desc(expenses.expenseDate), desc(expenses.createdAt))
    .limit(filter.limit ?? 200);

  return rows.map((row) => ({
    ...row,
    amountPaise: toPaise(row.amount),
  }));
}

/**
 * One expense.
 *
 * Reuses `listExpenses` with an id filter rather than repeating its eleven
 * joins. The alternative — a second hand-written select — is how a detail page
 * comes to show a different approver name from the list it was reached from.
 */
export async function getExpense(
  locationId: string,
  expenseId: string,
): Promise<ExpenseRow | null> {
  const rows = await listExpenses(locationId, { expenseId, limit: 1 });
  return rows[0] ?? null;
}

/* -----------------------------------------------------------------------------
 * Per-staff cash
 * -------------------------------------------------------------------------- */

export interface StaffCashAccount {
  accountId: string;
  code: string;
  name: string;
  isActive: boolean;
  staffUserId: string;
  staffName: string;
  staffRole: string;
  /** What they are holding right now — what they owe the school. */
  balancePaise: number;
  lastSettledOn: string | null;
}

/**
 * Every cash account with a person attached, and what that person is holding.
 *
 * The balance here is the number the whole per-staff design exists to produce.
 * It is computed over all time with no window: a clerk's position is not a
 * question about a date range, it is "how much is in your drawer".
 */
export async function listStaffCashAccounts(
  locationId: string,
): Promise<StaffCashAccount[]> {
  const rows = await db
    .select({
      accountId: ledgerAccounts.id,
      code: ledgerAccounts.code,
      name: ledgerAccounts.name,
      isActive: ledgerAccounts.isActive,
      type: ledgerAccounts.type,
      staffUserId: ledgerAccounts.ownerUserId,
      staffName: schoolUsers.name,
      staffRole: schoolUsers.role,
      debit: sql<string>`coalesce((
        select sum(${ledgerEntries.debit}) from ${ledgerEntries}
        where ${ledgerEntries.accountId} = ${ledgerAccounts.id}
      ), 0)`,
      credit: sql<string>`coalesce((
        select sum(${ledgerEntries.credit}) from ${ledgerEntries}
        where ${ledgerEntries.accountId} = ${ledgerAccounts.id}
      ), 0)`,
      lastSettledOn: sql<string | null>`(
        select max(${cashSettlements.settlementDate}) from ${cashSettlements}
        where ${cashSettlements.fromAccountId} = ${ledgerAccounts.id}
      )`,
    })
    .from(ledgerAccounts)
    .innerJoin(schoolUsers, eq(schoolUsers.id, ledgerAccounts.ownerUserId))
    .where(eq(ledgerAccounts.locationId, locationId))
    .orderBy(asc(schoolUsers.name));

  return rows.flatMap((row) =>
    row.staffUserId === null
      ? []
      : [
          {
            accountId: row.accountId,
            code: row.code,
            name: row.name,
            isActive: row.isActive,
            staffUserId: row.staffUserId,
            staffName: row.staffName,
            staffRole: row.staffRole,
            balancePaise: balancePaise(row.type, {
              debitPaise: toPaise(row.debit),
              creditPaise: toPaise(row.credit),
            }),
            lastSettledOn: row.lastSettledOn,
          },
        ],
  );
}

export interface SettlementRow {
  id: string;
  settlementDate: string;
  amountPaise: number;
  expectedPaise: number;
  /** Expected less handed over. Positive means the drawer was short. */
  shortPaise: number;
  staffName: string;
  fromName: string;
  toName: string;
  referenceNumber: string | null;
  notes: string | null;
  receivedByUid: string;
  ledgerTransactionId: string;
  createdAt: Date;
}

export async function listSettlements(
  locationId: string,
  filter: { from?: string; to?: string; staffUserId?: string; limit?: number } = {},
): Promise<SettlementRow[]> {
  const conditions: SQL[] = [eq(cashSettlements.locationId, locationId)];
  if (filter.from !== undefined) {
    conditions.push(gte(cashSettlements.settlementDate, filter.from));
  }
  if (filter.to !== undefined) {
    conditions.push(lte(cashSettlements.settlementDate, filter.to));
  }
  if (filter.staffUserId !== undefined) {
    conditions.push(eq(cashSettlements.staffUserId, filter.staffUserId));
  }

  const rows = await db
    .select({
      id: cashSettlements.id,
      settlementDate: cashSettlements.settlementDate,
      amount: cashSettlements.amount,
      expectedAmount: cashSettlements.expectedAmount,
      staffName: schoolUsers.name,
      fromName: sql<string>`(
        select ${ledgerAccounts.name} from ${ledgerAccounts}
        where ${ledgerAccounts.id} = ${cashSettlements.fromAccountId}
      )`,
      toName: sql<string>`(
        select ${ledgerAccounts.name} from ${ledgerAccounts}
        where ${ledgerAccounts.id} = ${cashSettlements.toAccountId}
      )`,
      referenceNumber: cashSettlements.referenceNumber,
      notes: cashSettlements.notes,
      receivedByUid: cashSettlements.receivedByUid,
      ledgerTransactionId: cashSettlements.ledgerTransactionId,
      createdAt: cashSettlements.createdAt,
    })
    .from(cashSettlements)
    .innerJoin(schoolUsers, eq(schoolUsers.id, cashSettlements.staffUserId))
    .where(and(...conditions))
    .orderBy(desc(cashSettlements.settlementDate), desc(cashSettlements.createdAt))
    .limit(filter.limit ?? 200);

  return rows.map((row) => {
    const amountPaise = toPaise(row.amount);
    const expectedPaise = toPaise(row.expectedAmount);
    return {
      ...row,
      amountPaise,
      expectedPaise,
      shortPaise: expectedPaise - amountPaise,
    };
  });
}

/* -----------------------------------------------------------------------------
 * The overview
 * -------------------------------------------------------------------------- */

export interface AccountingOverview {
  /** Null when the school has not set up a chart of accounts yet. */
  isSetUp: boolean;
  cashPaise: number;
  bankPaise: number;
  chequesPaise: number;
  monthIncomePaise: number;
  monthExpensePaise: number;
  monthProfitPaise: number;
  /** Money sitting in staff drawers, unsettled. */
  staffHoldingPaise: number;
  draftExpenseCount: number;
  draftExpensePaise: number;
  entryCount: number;
}

/**
 * The figures the accounting overview screen and the dashboard tile read.
 *
 * One call rather than eight, because the dashboard renders on every load and
 * the origin was measured at ~1s per uncached request (`CLAUDE.md`). Every
 * figure below comes from two indexed aggregate reads.
 */
export async function getAccountingOverview(
  locationId: string,
  month: { from: string; to: string },
): Promise<AccountingOverview> {
  const [allTime, thisMonth, drafts, entries, staffAccounts] = await Promise.all([
    getAccountBalances(locationId),
    getAccountBalances(locationId, month),
    db
      .select({
        count: sql<number>`count(*)::int`,
        total: sql<string>`coalesce(sum(${expenses.amount}), 0)`,
      })
      .from(expenses)
      .where(and(eq(expenses.locationId, locationId), eq(expenses.status, 'draft'))),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(ledgerTransactions)
      .where(eq(ledgerTransactions.locationId, locationId)),
    listStaffCashAccounts(locationId),
  ]);

  const sumType = (
    balances: readonly LedgerAccountBalance[],
    type: LedgerAccountType,
  ): number =>
    balances
      .filter((balance) => balance.type === type)
      .reduce((total, balance) => total + balancePaise(type, balance), 0);

  // By system key, never by code: a school may recode `1000` to anything it
  // likes on its first afternoon, and these tiles have to survive that.
  const bySystemKey = (key: SystemAccountKey): number => {
    const account = allTime.find((balance) => balance.systemKey === key);
    return account === undefined ? 0 : balancePaise(account.type, account);
  };

  const monthIncomePaise = sumType(thisMonth, 'income');
  const monthExpensePaise = sumType(thisMonth, 'expense');

  return {
    isSetUp: allTime.length > 0,
    cashPaise: bySystemKey('cash_in_hand'),
    bankPaise: bySystemKey('bank'),
    chequesPaise: bySystemKey('cheques_in_hand'),
    monthIncomePaise,
    monthExpensePaise,
    monthProfitPaise: monthIncomePaise - monthExpensePaise,
    staffHoldingPaise: staffAccounts.reduce(
      (total, account) => total + account.balancePaise,
      0,
    ),
    draftExpenseCount: drafts[0]?.count ?? 0,
    draftExpensePaise: toPaise(drafts[0]?.total ?? '0'),
    entryCount: entries[0]?.count ?? 0,
  };
}

/* -----------------------------------------------------------------------------
 * Who is asking
 * -------------------------------------------------------------------------- */

/**
 * The `school_users` row behind a session's uid, or null.
 *
 * `withSchoolAuth` hands a route the Supabase auth id, which is right for an
 * audit breadcrumb and wrong for anything a person's *name* is printed
 * against. An approver's name goes on the expense voucher; a settlement is
 * between two named people. Both need the row, and this is the one place that
 * turns one into the other.
 *
 * Null is a real answer, not an error: a platform operator inside a school
 * through "Login as Admin" holds a session and no membership row. The callers
 * treat that as "no name to record" rather than refusing the action.
 */
export async function schoolUserIdForUid(
  locationId: string,
  authUserId: string,
): Promise<string | null> {
  const [member] = await db
    .select({ id: schoolUsers.id })
    .from(schoolUsers)
    .where(
      and(eq(schoolUsers.locationId, locationId), eq(schoolUsers.authUserId, authUserId)),
    )
    .limit(1);

  return member?.id ?? null;
}

/**
 * Members of staff who could be given a cash drawer.
 *
 * Every active member of the school except students and parents.
 *
 * Teachers are in the list on purpose. A class teacher collecting the trip
 * money on a Monday morning is holding the school's cash exactly as an
 * accountant at a counter is, and the whole point of a drawer is to say so.
 * Students and parents are the two roles that hold no administrative
 * permission at any school, so a drawer for one of them could never be
 * settled.
 */
export async function listStaffForCashAccounts(
  locationId: string,
): Promise<{ id: string; name: string; role: string }[]> {
  return db
    .select({ id: schoolUsers.id, name: schoolUsers.name, role: schoolUsers.role })
    .from(schoolUsers)
    .where(
      and(
        eq(schoolUsers.locationId, locationId),
        eq(schoolUsers.isActive, true),
        notInArray(schoolUsers.role, ['student', 'parent']),
      ),
    )
    .orderBy(asc(schoolUsers.name));
}
