/**
 * Double-entry accounting — the rules, with nothing plugged in.
 *
 * ── Why this file has no imports worth speaking of ───────────────────────
 * `lib/ledger.ts` posts to Postgres, `lib/accounting-queries.ts` reads from
 * it, `scripts/check-accounting.ts` asserts against it and the expense form
 * runs in a browser. All four need the same answers to "which side does an
 * expense go on" and "what is this account's balance", and an answer that
 * lives in two places is an answer that will eventually differ. So the rules
 * live here, in a module that imports one formatter and no database.
 *
 * ── The one invariant ────────────────────────────────────────────────────
 * Every transaction's debits equal its credits, in whole paise. That is the
 * property that makes a balance sheet balance, and it is checked here, in the
 * poster, and again by a CHECK-shaped assertion in the check script — because
 * the only thing worse than an unbalanced ledger is an unbalanced ledger that
 * nothing complains about.
 *
 * ── Append-only ──────────────────────────────────────────────────────────
 * Nothing in this module edits or deletes. A correction is `reverseTransaction`
 * in `lib/ledger.ts`: a new transaction whose lines are the mirror of the
 * original. A disputed balance six months later is explainable only if the
 * wrong entry is still there beside the entry that cancelled it.
 */

import { toPaise } from './money';

/* -----------------------------------------------------------------------------
 * Account types
 * -------------------------------------------------------------------------- */

export const LEDGER_ACCOUNT_TYPES = [
  'asset',
  'liability',
  'equity',
  'income',
  'expense',
] as const;

export type LedgerAccountType = (typeof LEDGER_ACCOUNT_TYPES)[number];

export function isLedgerAccountType(value: unknown): value is LedgerAccountType {
  return (
    typeof value === 'string' &&
    (LEDGER_ACCOUNT_TYPES as readonly string[]).includes(value)
  );
}

export const ACCOUNT_TYPE_LABELS: Record<LedgerAccountType, string> = {
  asset: 'Asset',
  liability: 'Liability',
  equity: 'Equity',
  income: 'Income',
  expense: 'Expense',
};

/**
 * What each type means in the words a school administrator would use.
 *
 * Shown beside the type picker on the chart of accounts. A head teacher
 * creating an account head should not have to know the word "contra".
 */
export const ACCOUNT_TYPE_DESCRIPTIONS: Record<LedgerAccountType, string> = {
  asset: 'What the school holds — cash in the drawer, money in the bank, fees still owed.',
  liability: 'What the school owes — unpaid bills, salaries due, security deposits held.',
  equity: 'What the school is worth to its owners, and the opening balances it started from.',
  income: 'Money the school earns — tuition, admission fees, transport charges.',
  expense: 'Money the school spends — salaries, rent, utilities, repairs.',
};

/** `debit` or `credit` — the side an increase in this type goes on. */
export type NormalBalance = 'debit' | 'credit';

/**
 * Which side increases this type of account.
 *
 * Assets and expenses grow on the debit side; liabilities, equity and income
 * grow on the credit side. Every balance in this product is computed from this
 * one function, so the sign convention cannot drift between the balance sheet
 * and the day book.
 */
export function normalBalanceOf(type: LedgerAccountType): NormalBalance {
  return type === 'asset' || type === 'expense' ? 'debit' : 'credit';
}

/* -----------------------------------------------------------------------------
 * The accounts the software itself posts to
 * -------------------------------------------------------------------------- */

/**
 * Accounts the application must be able to find by name.
 *
 * A school may rename, re-code and re-describe any of these, and may add a
 * hundred of its own beside them — but something has to answer "where does a
 * cash fee payment land", and a match on the *label* would break the first
 * time a school typed "Cash in hand (main office)". `system_key` is that
 * answer: set once at seeding, unique per school, and never shown as an
 * editable field.
 *
 * A school-defined account has `system_key` null, which is why the uniqueness
 * is a partial index rather than a plain unique constraint.
 */
export const SYSTEM_ACCOUNT_KEYS = [
  'cash_in_hand',
  'bank',
  'cheques_in_hand',
  'fees_receivable',
  'fee_income',
  'other_income',
  'salary_expense',
  'other_expense',
  'accounts_payable',
  'opening_balance',
] as const;

export type SystemAccountKey = (typeof SYSTEM_ACCOUNT_KEYS)[number];

export function isSystemAccountKey(value: unknown): value is SystemAccountKey {
  return (
    typeof value === 'string' && (SYSTEM_ACCOUNT_KEYS as readonly string[]).includes(value)
  );
}

export interface ChartAccountSeed {
  code: string;
  name: string;
  type: LedgerAccountType;
  systemKey: SystemAccountKey | null;
  description: string;
}

/**
 * The chart of accounts a school starts with.
 *
 * Deliberately short. A twelve-line chart that a bursar reads in one screen
 * and extends when they need to is worth more than the eighty-line template an
 * accounting package ships with, of which a school uses nine and is confused
 * by the rest. The heads below are the ones a Pakistani school actually posts
 * to in its first month, and `5xxx` is left wide open for the rest.
 *
 * Codes follow the ordinary convention — 1 asset, 2 liability, 3 equity,
 * 4 income, 5 expense — because a bursar who has used any other system already
 * knows it, and because it is what makes the chart sort correctly with no
 * `sort_order` column to keep in step.
 */
export const DEFAULT_CHART: readonly ChartAccountSeed[] = [
  {
    code: '1000',
    name: 'Cash in Hand',
    type: 'asset',
    systemKey: 'cash_in_hand',
    description: 'The office drawer. Where a cash fee payment lands and where a counter settles to.',
  },
  {
    code: '1010',
    name: 'Bank Account',
    type: 'asset',
    systemKey: 'bank',
    description: 'Money at the bank. Where a fee paid by transfer lands.',
  },
  {
    code: '1020',
    name: 'Cheques in Hand',
    type: 'asset',
    systemKey: 'cheques_in_hand',
    description:
      'Cheques received and not yet cleared. Held separately from Bank because a cheque is not money until it clears.',
  },
  {
    code: '1100',
    name: 'Fees Receivable',
    type: 'asset',
    systemKey: 'fees_receivable',
    description: 'Fees billed on a voucher and not yet received.',
  },
  {
    code: '2000',
    name: 'Accounts Payable',
    type: 'liability',
    systemKey: 'accounts_payable',
    description: 'Bills the school has accepted and not yet paid.',
  },
  {
    code: '3000',
    name: 'Opening Balance',
    type: 'equity',
    systemKey: 'opening_balance',
    description:
      'The other side of every opening figure entered when the school started keeping books here.',
  },
  {
    code: '4000',
    name: 'Fee Income',
    type: 'income',
    systemKey: 'fee_income',
    description: 'Tuition and every other charge raised on a challan.',
  },
  {
    code: '4900',
    name: 'Other Income',
    type: 'income',
    systemKey: 'other_income',
    description: 'Donations, hall hire, anything earned that is not a fee.',
  },
  {
    code: '5000',
    name: 'Salaries & Wages',
    type: 'expense',
    systemKey: 'salary_expense',
    description: 'The staff bill. Payroll posts here.',
  },
  {
    code: '5100',
    name: 'Rent',
    type: 'expense',
    systemKey: null,
    description: 'Building rent for every campus.',
  },
  {
    code: '5200',
    name: 'Utilities',
    type: 'expense',
    systemKey: null,
    description: 'Electricity, gas, water, internet.',
  },
  {
    code: '5300',
    name: 'Teaching Materials',
    type: 'expense',
    systemKey: null,
    description: 'Books, stationery, lab and sports consumables.',
  },
  {
    code: '5400',
    name: 'Transport & Fuel',
    type: 'expense',
    systemKey: null,
    description: 'School vans, fuel and their upkeep.',
  },
  {
    code: '5500',
    name: 'Repairs & Maintenance',
    type: 'expense',
    systemKey: null,
    description: 'Building, furniture and equipment repairs.',
  },
  {
    code: '5900',
    name: 'Other Expenses',
    type: 'expense',
    systemKey: 'other_expense',
    description: 'Anything spent that does not belong under a head above.',
  },
];

/**
 * The expense categories a school starts with, each pointing at a chart head.
 *
 * A category is the word a clerk chooses from; the account is where the money
 * lands. Keeping them as two things is what lets a school have "Van diesel"
 * and "Van repairs" both posting to Transport & Fuel without inventing two
 * accounts, and it is why `expense_categories.ledger_account_id` is a
 * reference rather than a copy of the name.
 */
export const DEFAULT_EXPENSE_CATEGORIES: readonly { name: string; accountCode: string }[] = [
  { name: 'Rent', accountCode: '5100' },
  { name: 'Electricity', accountCode: '5200' },
  { name: 'Gas & Water', accountCode: '5200' },
  { name: 'Internet & Phone', accountCode: '5200' },
  { name: 'Stationery & Printing', accountCode: '5300' },
  { name: 'Lab & Sports Supplies', accountCode: '5300' },
  { name: 'Van Fuel', accountCode: '5400' },
  { name: 'Van Repairs', accountCode: '5400' },
  { name: 'Building Repairs', accountCode: '5500' },
  { name: 'Furniture & Equipment', accountCode: '5500' },
  { name: 'Miscellaneous', accountCode: '5900' },
];

/* -----------------------------------------------------------------------------
 * Where money lands
 * -------------------------------------------------------------------------- */

/**
 * Which asset account a payment of this kind arrives in.
 *
 * A cheque is not in the bank. It is a piece of paper in a drawer that will
 * probably become money, and a school that counts it as bank balance will
 * overdraw on a cheque that bounces. `1020 Cheques in Hand` exists for exactly
 * that week between the counter and the clearing.
 */
export function landingAccountFor(
  paymentMethod: 'cash' | 'bank_transfer' | 'cheque',
): SystemAccountKey {
  if (paymentMethod === 'bank_transfer') return 'bank';
  if (paymentMethod === 'cheque') return 'cheques_in_hand';
  return 'cash_in_hand';
}

/* -----------------------------------------------------------------------------
 * Lines and balance
 * -------------------------------------------------------------------------- */

/**
 * One side of one transaction, in whole paise.
 *
 * Exactly one of `debitPaise` / `creditPaise` is non-zero. A line carrying
 * both would be two lines pretending to be one, and would make every sum in
 * this file ambiguous about which it meant.
 */
export interface LedgerLineInput {
  accountId: string;
  debitPaise: number;
  creditPaise: number;
  memo?: string | null;
}

export type LineProblem =
  | 'no_lines'
  | 'one_line'
  | 'non_integer'
  | 'negative'
  | 'both_sides'
  | 'empty_line'
  | 'unbalanced';

export const LINE_PROBLEM_MESSAGES: Record<LineProblem, string> = {
  no_lines: 'A journal entry needs at least two lines.',
  one_line: 'A journal entry needs at least two lines — one debit and one credit.',
  non_integer: 'Amounts must be whole paise.',
  negative: 'An amount cannot be negative. Put it on the other side instead.',
  both_sides: 'A line is either a debit or a credit, never both.',
  empty_line: 'A line with no amount on either side does nothing. Remove it.',
  unbalanced: 'Debits and credits must be equal.',
};

/**
 * What is wrong with these lines, or null if nothing is.
 *
 * Returns the *first* problem rather than all of them, and the caller turns it
 * into a sentence. The poster refuses on any non-null answer, which is the
 * property the whole ledger rests on: there is no code path that writes an
 * unbalanced transaction, including the ones nobody has written yet.
 */
export function lineProblem(lines: readonly LedgerLineInput[]): LineProblem | null {
  if (lines.length === 0) return 'no_lines';
  if (lines.length === 1) return 'one_line';

  let debits = 0;
  let credits = 0;

  for (const line of lines) {
    if (!Number.isInteger(line.debitPaise) || !Number.isInteger(line.creditPaise)) {
      return 'non_integer';
    }
    if (line.debitPaise < 0 || line.creditPaise < 0) return 'negative';
    if (line.debitPaise > 0 && line.creditPaise > 0) return 'both_sides';
    if (line.debitPaise === 0 && line.creditPaise === 0) return 'empty_line';

    debits += line.debitPaise;
    credits += line.creditPaise;
  }

  return debits === credits ? null : 'unbalanced';
}

export function isBalanced(lines: readonly LedgerLineInput[]): boolean {
  return lineProblem(lines) === null;
}

/** The value of a transaction — one side of it, since the two are equal. */
export function transactionTotalPaise(lines: readonly LedgerLineInput[]): number {
  return lines.reduce((total, line) => total + line.debitPaise, 0);
}

/** A simple two-line transaction: this account is debited, that one credited. */
export function twoSidedLines(
  debitAccountId: string,
  creditAccountId: string,
  amountPaise: number,
  memo?: string,
): LedgerLineInput[] {
  return [
    { accountId: debitAccountId, debitPaise: amountPaise, creditPaise: 0, memo: memo ?? null },
    { accountId: creditAccountId, debitPaise: 0, creditPaise: amountPaise, memo: memo ?? null },
  ];
}

/**
 * The mirror of a set of lines — every debit a credit and back.
 *
 * This is what a correction is. Not an edit, not a delete: a second
 * transaction that leaves the first standing and brings the net to zero.
 */
export function mirrorLines(lines: readonly LedgerLineInput[]): LedgerLineInput[] {
  return lines.map((line) => ({
    accountId: line.accountId,
    debitPaise: line.creditPaise,
    creditPaise: line.debitPaise,
    memo: line.memo ?? null,
  }));
}

/* -----------------------------------------------------------------------------
 * Balances
 * -------------------------------------------------------------------------- */

/** Debit and credit totals for one account, as the database sums them. */
export interface AccountTotals {
  debitPaise: number;
  creditPaise: number;
}

/**
 * An account's balance, positive when it holds what it normally holds.
 *
 * A cash account with 50,000 in it reads `+50000`; one that has been
 * overdrawn reads negative. An income account that has earned 50,000 also
 * reads `+50000`, even though it is a credit balance — because "Fee Income:
 * −500,000" on a profit and loss statement is a figure a head teacher will
 * misread, every time, and the sign convention exists to be read rather than
 * to be technically pure.
 */
export function balancePaise(type: LedgerAccountType, totals: AccountTotals): number {
  return normalBalanceOf(type) === 'debit'
    ? totals.debitPaise - totals.creditPaise
    : totals.creditPaise - totals.debitPaise;
}

/**
 * The raw signed balance — debits minus credits, always.
 *
 * Used for the trial balance and for the balance-sheet identity check, where
 * the *point* is that the signs cancel: assets are positive, liabilities and
 * equity negative, and the whole column sums to zero when the books are
 * sound. Never show this figure to a user; `balancePaise` is the one they
 * read.
 */
export function signedBalancePaise(totals: AccountTotals): number {
  return totals.debitPaise - totals.creditPaise;
}

/* -----------------------------------------------------------------------------
 * The statements
 * -------------------------------------------------------------------------- */

/** Which statement a type appears on. */
export type StatementSection = 'balance_sheet' | 'profit_and_loss';

export function statementOf(type: LedgerAccountType): StatementSection {
  return type === 'income' || type === 'expense' ? 'profit_and_loss' : 'balance_sheet';
}

/** Balance-sheet groups in the order they are printed. */
export const BALANCE_SHEET_ORDER: readonly LedgerAccountType[] = [
  'asset',
  'liability',
  'equity',
];

/** Profit-and-loss groups in the order they are printed. */
export const PROFIT_AND_LOSS_ORDER: readonly LedgerAccountType[] = ['income', 'expense'];

export interface AccountBalance extends AccountTotals {
  accountId: string;
  code: string;
  name: string;
  type: LedgerAccountType;
}

export interface StatementGroup {
  type: LedgerAccountType;
  label: string;
  rows: readonly (AccountBalance & { balancePaise: number })[];
  totalPaise: number;
}

/** Groups balances by type, in printing order, with a total per group. */
export function groupForStatement(
  balances: readonly AccountBalance[],
  order: readonly LedgerAccountType[],
): StatementGroup[] {
  return order.map((type) => {
    const rows = balances
      .filter((balance) => balance.type === type)
      .map((balance) => ({ ...balance, balancePaise: balancePaise(type, balance) }))
      .sort((left, right) => left.code.localeCompare(right.code));

    return {
      type,
      label: ACCOUNT_TYPE_LABELS[type],
      rows,
      totalPaise: rows.reduce((total, row) => total + row.balancePaise, 0),
    };
  });
}

/**
 * Profit for a period: income earned less expenses incurred.
 *
 * This is the figure the school dashboard has been showing as unavailable
 * since Sprint 10.5, with the words "Needs the accounting ledger".
 */
export function profitPaise(incomePaise: number, expensePaise: number): number {
  return incomePaise - expensePaise;
}

/**
 * Whether a balance sheet actually balances.
 *
 * Assets = Liabilities + Equity + (Income − Expenses). The last bracket is the
 * period's profit, which has not been closed to equity — this product never
 * closes a year, deliberately, because a school that has never run a year-end
 * would then have a balance sheet that does not balance and no way to know
 * why.
 */
export function balanceSheetHoldsPaise(input: {
  assetsPaise: number;
  liabilitiesPaise: number;
  equityPaise: number;
  incomePaise: number;
  expensesPaise: number;
}): boolean {
  const right =
    input.liabilitiesPaise +
    input.equityPaise +
    profitPaise(input.incomePaise, input.expensesPaise);
  return input.assetsPaise === right;
}

/* -----------------------------------------------------------------------------
 * Sources — what caused a transaction
 * -------------------------------------------------------------------------- */

/**
 * Why a transaction exists.
 *
 * Stored on the transaction rather than inferred, because a day book that
 * cannot say "this came from a fee payment" is a list of numbers, and because
 * a reversal has to be findable from the thing it reversed.
 */
export const LEDGER_SOURCES = [
  'fee_payment',
  'expense',
  'settlement',
  'payroll',
  'opening_balance',
  'manual',
  'reversal',
] as const;

export type LedgerSource = (typeof LEDGER_SOURCES)[number];

export function isLedgerSource(value: unknown): value is LedgerSource {
  return typeof value === 'string' && (LEDGER_SOURCES as readonly string[]).includes(value);
}

export const LEDGER_SOURCE_LABELS: Record<LedgerSource, string> = {
  fee_payment: 'Fee payment',
  expense: 'Expense',
  settlement: 'Cash settlement',
  payroll: 'Payroll',
  opening_balance: 'Opening balance',
  manual: 'Journal entry',
  reversal: 'Reversal',
};

/**
 * Sources a person may choose when posting a journal entry by hand.
 *
 * `fee_payment`, `expense`, `settlement` and `payroll` are stamped by the code
 * that raised them and are refused from a request body: a hand-written entry
 * claiming to be a fee payment would appear in the fee reconciliation beside
 * real ones with nothing to distinguish it.
 */
export const MANUAL_SOURCES: readonly LedgerSource[] = ['manual', 'opening_balance'];

export function isManualSource(value: unknown): value is LedgerSource {
  return isLedgerSource(value) && MANUAL_SOURCES.includes(value);
}

/* -----------------------------------------------------------------------------
 * Expenses
 * -------------------------------------------------------------------------- */

/**
 * Where an expense is in its life.
 *
 * ── Why `paid` is not a fourth status ────────────────────────────────────
 * It is tempting to add one, and it would be wrong: an approved expense in
 * this product *is* paid, because the same action that approves it posts the
 * money out of a cash or bank account. A school that wants to record a bill
 * now and pay it later posts to `2000 Accounts Payable` and settles it with a
 * journal entry, which is what that account is for. Adding a `paid` status
 * would put the same fact in two places — the status column and the ledger —
 * and they would disagree the first time somebody reversed a posting.
 */
export const EXPENSE_STATUSES = ['draft', 'approved', 'rejected'] as const;
export type ExpenseStatus = (typeof EXPENSE_STATUSES)[number];

export function isExpenseStatus(value: unknown): value is ExpenseStatus {
  return typeof value === 'string' && (EXPENSE_STATUSES as readonly string[]).includes(value);
}

export const EXPENSE_STATUS_LABELS: Record<ExpenseStatus, string> = {
  draft: 'Awaiting approval',
  approved: 'Approved',
  rejected: 'Rejected',
};

/**
 * Whether this expense has reached the ledger.
 *
 * Only an approved expense has. A draft is a request, and a rejected one is a
 * request that was refused — neither is money that left the school, and
 * posting either would put a figure on the profit and loss that nobody
 * authorised.
 */
export function expenseIsPosted(status: ExpenseStatus): boolean {
  return status === 'approved';
}

/* -----------------------------------------------------------------------------
 * Parsing amounts from a form
 * -------------------------------------------------------------------------- */

/**
 * A rupee amount from a request body, in paise, or null if it is not one.
 *
 * Deliberately strict where `toPaise` is forgiving: `toPaise` exists to keep a
 * bad database value from poisoning a sum, and answers 0. A request body is a
 * different thing — 0 there means somebody typed something this code did not
 * understand, and posting a zero-value transaction would leave a line in the
 * day book that says nothing happened.
 */
export function parseAmountPaise(value: unknown): number | null {
  if (typeof value !== 'string' && typeof value !== 'number') return null;

  const text = String(value).trim();
  if (text === '') return null;
  if (!/^-?\d+(\.\d{1,2})?$/.test(text)) return null;

  const paise = toPaise(text);
  return Number.isInteger(paise) ? paise : null;
}

/** The same, refusing zero and anything below it. */
export function parsePositiveAmountPaise(value: unknown): number | null {
  const paise = parseAmountPaise(value);
  return paise !== null && paise > 0 ? paise : null;
}

/* -----------------------------------------------------------------------------
 * Account codes
 * -------------------------------------------------------------------------- */

const CODE_PATTERN = /^[0-9]{3,8}$/;

/**
 * Whether this is a usable account code.
 *
 * Digits only, so the chart sorts as a string in the same order it sorts as a
 * number — which is what lets every query order by `code` with no numeric cast
 * and no `sort_order` column that could disagree with it.
 */
export function isAccountCode(value: unknown): value is string {
  return typeof value === 'string' && CODE_PATTERN.test(value);
}

/**
 * The first free code in this type's range.
 *
 * Suggested in the new-account form rather than imposed: a school that codes
 * its accounts its own way types over it, and nothing here depends on the
 * suggestion having been taken.
 */
export function suggestAccountCode(
  type: LedgerAccountType,
  existingCodes: readonly string[],
): string {
  const prefix = { asset: 1, liability: 2, equity: 3, income: 4, expense: 5 }[type];
  const taken = new Set(existingCodes);

  for (let candidate = prefix * 1000; candidate < (prefix + 1) * 1000; candidate += 10) {
    const code = String(candidate);
    if (!taken.has(code)) return code;
  }

  // Every ten is taken — 100 accounts in one type. Fall through to the ones.
  for (let candidate = prefix * 1000; candidate < (prefix + 1) * 1000; candidate += 1) {
    const code = String(candidate);
    if (!taken.has(code)) return code;
  }

  return String(prefix * 1000);
}
