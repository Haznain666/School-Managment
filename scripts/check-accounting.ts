/**
 * The accounting rules, asserted rather than trusted — Sprint 13.5.
 *
 * ── Why a script and not a click-through ─────────────────────────────────
 * Almost everything this module does is a *rule*. Debits equal credits. An
 * asset grows on the debit side and income on the credit side. A reversal is
 * the mirror of what it reverses. A cheque lands somewhere that is not the
 * bank. None of those is visible on a screen, and a person checking by hand
 * checks the two examples they happen to think of, once.
 *
 * Worse, the failures are *silent*. An unbalanced ledger does not throw, it
 * just stops balancing; a sign convention inverted in one place produces a
 * profit and loss where salaries appear to earn the school money, and every
 * number on it is a plausible-looking number. There is nothing for a
 * type-checker or a passing build to object to. That is what this file is for.
 *
 * ── What it covers, and what it deliberately does not ────────────────────
 * Everything here is pure: `lib/accounting.ts` and the three consumers that
 * import it. It runs with no database, which is what lets it sit in CI beside
 * `check-loaders` and `check-cnic` rather than on the machine with the
 * credentials.
 *
 * The database half — that the seed in migration `0027` produces the same
 * chart `DEFAULT_CHART` describes, and that the backfill posted a balanced
 * transaction per fee payment — is asserted here *against the migration file's
 * text*, which is the strongest thing a credential-free check can do. Running
 * the queries themselves belongs with `check-reports`.
 *
 *   npm run check-accounting
 *
 * Exit code 1 on any violation.
 */

import { readFileSync } from 'node:fs';

import {
  ACCOUNT_TYPE_LABELS,
  DEFAULT_CHART,
  DEFAULT_EXPENSE_CATEGORIES,
  EXPENSE_STATUSES,
  LEDGER_ACCOUNT_TYPES,
  LEDGER_SOURCES,
  MANUAL_SOURCES,
  SYSTEM_ACCOUNT_KEYS,
  balancePaise,
  balanceSheetHoldsPaise,
  expenseIsPosted,
  groupForStatement,
  isAccountCode,
  isBalanced,
  isManualSource,
  landingAccountFor,
  lineProblem,
  mirrorLines,
  normalBalanceOf,
  parseAmountPaise,
  parsePositiveAmountPaise,
  profitPaise,
  signedBalancePaise,
  statementOf,
  suggestAccountCode,
  transactionTotalPaise,
  twoSidedLines,
  type LedgerAccountType,
} from '../lib/accounting';
import { PERMISSIONS, DEFAULT_ROLE_PERMISSIONS } from '../lib/permissions';
import { REPORTS } from '../lib/report-catalogue';

let failures = 0;
let checks = 0;

function ok(condition: boolean, description: string): void {
  checks += 1;
  if (condition) return;
  failures += 1;
  console.log(`  ✗ ${description}`);
}

function section(title: string): void {
  console.log(`\n=== ${title} ===`);
}

const MIGRATION = readFileSync('db/migrations/0027_sprint135_accounting.sql', 'utf8');

/* -----------------------------------------------------------------------------
 * 1. The one invariant: debits equal credits.
 * -------------------------------------------------------------------------- */

section('Balance');

const A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const C = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';

ok(isBalanced(twoSidedLines(A, B, 50_000)), 'a two-sided entry balances');

ok(
  lineProblem([
    { accountId: A, debitPaise: 50_000, creditPaise: 0 },
    { accountId: B, debitPaise: 0, creditPaise: 49_999 },
  ]) === 'unbalanced',
  'one paisa out is refused — the whole point of working in integers',
);

ok(
  lineProblem([
    { accountId: A, debitPaise: 50_000, creditPaise: 0 },
    { accountId: B, debitPaise: 0, creditPaise: 30_000 },
    { accountId: C, debitPaise: 0, creditPaise: 20_000 },
  ]) === null,
  'a three-line split balances when the two sides agree',
);

ok(lineProblem([]) === 'no_lines', 'no lines is refused');
ok(
  lineProblem([{ accountId: A, debitPaise: 100, creditPaise: 0 }]) === 'one_line',
  'a single line is refused — it cannot balance against anything',
);
ok(
  lineProblem([
    { accountId: A, debitPaise: 100, creditPaise: 100 },
    { accountId: B, debitPaise: 0, creditPaise: 100 },
  ]) === 'both_sides',
  'a line on both sides at once is refused, because every sum would read it twice',
);
ok(
  lineProblem([
    { accountId: A, debitPaise: 0, creditPaise: 0 },
    { accountId: B, debitPaise: 0, creditPaise: 0 },
  ]) === 'empty_line',
  'a line with nothing on it is refused',
);
ok(
  lineProblem([
    { accountId: A, debitPaise: -100, creditPaise: 0 },
    { accountId: B, debitPaise: 0, creditPaise: -100 },
  ]) === 'negative',
  'a negative amount is refused — it belongs on the other side',
);
ok(
  lineProblem([
    { accountId: A, debitPaise: 100.5, creditPaise: 0 },
    { accountId: B, debitPaise: 0, creditPaise: 100.5 },
  ]) === 'non_integer',
  'a fractional paisa is refused',
);

ok(
  transactionTotalPaise(twoSidedLines(A, B, 12_345)) === 12_345,
  'a transaction is worth one of its two equal sides',
);

/* -----------------------------------------------------------------------------
 * 2. A reversal is a mirror, and mirrors balance.
 * -------------------------------------------------------------------------- */

section('Reversal');

const original = [
  { accountId: A, debitPaise: 50_000, creditPaise: 0, memo: 'in' },
  { accountId: B, debitPaise: 0, creditPaise: 30_000, memo: null },
  { accountId: C, debitPaise: 0, creditPaise: 20_000, memo: null },
];
const mirrored = mirrorLines(original);

ok(isBalanced(mirrored), 'a mirrored entry balances');
ok(
  mirrored[0]?.creditPaise === 50_000 && mirrored[0]?.debitPaise === 0,
  'every debit becomes a credit',
);
ok(
  original.every((line, index) => {
    const back = mirrored[index];
    return (
      back !== undefined &&
      line.debitPaise + back.debitPaise === line.debitPaise + line.creditPaise
    );
  }),
  'a line and its mirror sum to the same total on each side',
);

// The property that makes an append-only ledger work at all: the original and
// its reversal, added together, move every account by nothing.
const netByAccount = new Map<string, number>();
for (const line of [...original, ...mirrored]) {
  netByAccount.set(
    line.accountId,
    (netByAccount.get(line.accountId) ?? 0) + line.debitPaise - line.creditPaise,
  );
}
ok(
  [...netByAccount.values()].every((net) => net === 0),
  'an entry plus its reversal nets to zero on every account it touched',
);

ok(
  mirrorLines(mirrored).every(
    (line, index) =>
      line.debitPaise === original[index]?.debitPaise &&
      line.creditPaise === original[index]?.creditPaise,
  ),
  'mirroring twice returns the original — which is why reversing a reversal is refused rather than allowed',
);

/* -----------------------------------------------------------------------------
 * 3. Sign conventions. The silent-failure class.
 * -------------------------------------------------------------------------- */

section('Which way each type grows');

ok(normalBalanceOf('asset') === 'debit', 'an asset grows on the debit side');
ok(normalBalanceOf('expense') === 'debit', 'an expense grows on the debit side');
ok(normalBalanceOf('liability') === 'credit', 'a liability grows on the credit side');
ok(normalBalanceOf('equity') === 'credit', 'equity grows on the credit side');
ok(normalBalanceOf('income') === 'credit', 'income grows on the credit side');

ok(
  balancePaise('asset', { debitPaise: 100_000, creditPaise: 30_000 }) === 70_000,
  'a cash account that took 1,000 and paid out 300 holds 700',
);
ok(
  balancePaise('income', { debitPaise: 0, creditPaise: 100_000 }) === 100_000,
  'income that earned 1,000 reads +1,000 rather than −1,000 — a head teacher must not be shown a negative income line',
);
ok(
  balancePaise('asset', { debitPaise: 0, creditPaise: 5_000 }) === -5_000,
  'an overdrawn asset reads negative, because it genuinely is',
);
ok(
  signedBalancePaise({ debitPaise: 0, creditPaise: 100_000 }) === -100_000,
  'the raw signed balance keeps the sign that makes a trial balance sum to zero',
);

ok(
  LEDGER_ACCOUNT_TYPES.every((type) => ACCOUNT_TYPE_LABELS[type] !== undefined),
  'every account type has a label — an unlabelled one would print as a raw enum on a balance sheet',
);

ok(statementOf('asset') === 'balance_sheet', 'assets are on the balance sheet');
ok(statementOf('income') === 'profit_and_loss', 'income is on the profit and loss');

/* -----------------------------------------------------------------------------
 * 4. The statements hold together.
 * -------------------------------------------------------------------------- */

section('The statements');

// A worked month: 500,000 of fees taken in cash, 200,000 of salaries paid out
// of it, and a 50,000 bill accrued and unpaid.
const worked = [
  { accountId: A, code: '1000', name: 'Cash', type: 'asset' as const, debitPaise: 500_000, creditPaise: 200_000 },
  { accountId: B, code: '2000', name: 'Payable', type: 'liability' as const, debitPaise: 0, creditPaise: 50_000 },
  { accountId: C, code: '4000', name: 'Fee Income', type: 'income' as const, debitPaise: 0, creditPaise: 500_000 },
  { accountId: '4', code: '5000', name: 'Salaries', type: 'expense' as const, debitPaise: 200_000, creditPaise: 0 },
  { accountId: '5', code: '5100', name: 'Rent', type: 'expense' as const, debitPaise: 50_000, creditPaise: 0 },
];

const assets = worked
  .filter((row) => row.type === 'asset')
  .reduce((total, row) => total + balancePaise('asset', row), 0);
const liabilities = worked
  .filter((row) => row.type === 'liability')
  .reduce((total, row) => total + balancePaise('liability', row), 0);
const income = worked
  .filter((row) => row.type === 'income')
  .reduce((total, row) => total + balancePaise('income', row), 0);
const expensesTotal = worked
  .filter((row) => row.type === 'expense')
  .reduce((total, row) => total + balancePaise('expense', row), 0);

ok(assets === 300_000, 'the worked month leaves 3,000 in cash');
ok(income === 500_000 && expensesTotal === 250_000, 'it earned 5,000 and spent 2,500');
ok(profitPaise(income, expensesTotal) === 250_000, 'so the profit is 2,500');

ok(
  balanceSheetHoldsPaise({
    assetsPaise: assets,
    liabilitiesPaise: liabilities,
    equityPaise: 0,
    incomePaise: income,
    expensesPaise: expensesTotal,
  }),
  'and the balance sheet balances: assets = liabilities + equity + profit',
);

ok(
  !balanceSheetHoldsPaise({
    assetsPaise: assets + 1,
    liabilitiesPaise: liabilities,
    equityPaise: 0,
    incomePaise: income,
    expensesPaise: expensesTotal,
  }),
  'one paisa of asset with nothing on the other side breaks it — the check is a check, not a formality',
);

const grouped = groupForStatement(worked, ['asset', 'liability', 'equity']);
ok(grouped.length === 3, 'the balance sheet groups into three sections');
ok(grouped[0]?.totalPaise === 300_000, 'the asset section totals its own rows');
ok(
  grouped[2]?.rows.length === 0 && grouped[2]?.totalPaise === 0,
  'a section with no accounts is present and empty rather than missing — "no equity" and "no equity section" read differently',
);
ok(
  grouped[0]?.rows.every(
    (row, index) => index === 0 || row.code >= (grouped[0]?.rows[index - 1]?.code ?? ''),
  ) === true,
  'rows within a section come out in code order',
);

/* -----------------------------------------------------------------------------
 * 5. Where money lands.
 * -------------------------------------------------------------------------- */

section('Where a payment lands');

ok(landingAccountFor('cash') === 'cash_in_hand', 'cash goes to the drawer');
ok(landingAccountFor('bank_transfer') === 'bank', 'a transfer goes to the bank');
ok(
  landingAccountFor('cheque') === 'cheques_in_hand',
  'a cheque does NOT go to the bank — it is not money until it clears, and a school counting it as bank balance will overdraw on one that bounces',
);

/* -----------------------------------------------------------------------------
 * 6. The chart of accounts, and its two copies.
 * -------------------------------------------------------------------------- */

section('The chart of accounts');

ok(DEFAULT_CHART.length >= 12, 'the seeded chart has the heads a school actually uses');

ok(
  DEFAULT_CHART.every((seed) => isAccountCode(seed.code)),
  'every seeded code is digits only, so the chart sorts as a string exactly as it sorts as a number',
);

ok(
  new Set(DEFAULT_CHART.map((seed) => seed.code)).size === DEFAULT_CHART.length,
  'no two seeded accounts share a code',
);

const CODE_PREFIX: Record<LedgerAccountType, string> = {
  asset: '1',
  liability: '2',
  equity: '3',
  income: '4',
  expense: '5',
};

ok(
  DEFAULT_CHART.every((seed) => seed.code.startsWith(CODE_PREFIX[seed.type])),
  'every seeded code sits in its type’s range — the convention a bursar from any other system already knows',
);

const seededKeys = DEFAULT_CHART.map((seed) => seed.systemKey).filter(
  (key): key is NonNullable<typeof key> => key !== null,
);

ok(
  new Set(seededKeys).size === seededKeys.length,
  'no system key is seeded twice — the partial unique index would refuse it anyway',
);

// The keys the code actually reaches for. A missing one is not a cosmetic
// problem: it is a fee payment with nowhere to post, discovered by a clerk.
for (const key of ['cash_in_hand', 'bank', 'cheques_in_hand', 'fee_income', 'salary_expense'] as const) {
  ok(
    seededKeys.includes(key),
    `the seed provides ${key}, which the software posts to automatically`,
  );
}

ok(
  SYSTEM_ACCOUNT_KEYS.every((key) =>
    seededKeys.includes(key) || key === 'fees_receivable' || key === 'other_income' || key === 'other_expense' || key === 'accounts_payable' || key === 'opening_balance',
  ),
  'every declared system key is either seeded or one of the five a school reaches by hand',
);

ok(
  DEFAULT_EXPENSE_CATEGORIES.every((category) =>
    DEFAULT_CHART.some(
      (seed) => seed.code === category.accountCode && seed.type === 'expense',
    ),
  ),
  'every seeded expense category points at a seeded EXPENSE account — one pointing at Fee Income would make paying the electricity bill look like earnings',
);

/* The migration and the code must seed the same chart. */

section('The migration agrees with the code');

for (const seed of DEFAULT_CHART) {
  ok(
    MIGRATION.includes(`'${seed.code}'`) && MIGRATION.includes(`'${seed.name}'`),
    `migration 0027 seeds ${seed.code} ${seed.name}`,
  );
}

for (const category of DEFAULT_EXPENSE_CATEGORIES) {
  ok(
    MIGRATION.includes(`'${category.name}'`),
    `migration 0027 seeds the ${category.name} expense category`,
  );
}

ok(
  MIGRATION.includes("'fee_payment'") && MIGRATION.includes('backfilled from the fee module'),
  'migration 0027 backfills existing fee payments into the ledger — without it a year-old school opens the module with an empty book and concludes it does not work',
);

ok(
  MIGRATION.includes('payment."payment_date"') && !MIGRATION.includes('now()::date'),
  'the backfill dates each entry to the payment, not to the day the migration ran — a year of takings on one afternoon’s day book would be worse than none',
);

ok(
  MIGRATION.includes("WHEN 'cheque' THEN 'cheques_in_hand'"),
  'the backfill puts cheques in Cheques in Hand, matching landingAccountFor',
);

ok(
  MIGRATION.includes('payment."ledger_transaction_id" IS NULL'),
  'the backfill is guarded on the link column, so running it twice writes nothing the second time',
);

ok(
  MIGRATION.includes('ledger_entries_one_side_check'),
  'the one-side CHECK reaches the database — the balance rule is enforced below the application as well as in it',
);

ok(
  MIGRATION.includes('expenses_posting_check'),
  'an approved expense cannot exist without its posting, at the database level',
);

/* -----------------------------------------------------------------------------
 * 7. Codes suggested for new accounts.
 * -------------------------------------------------------------------------- */

section('Suggested codes');

ok(
  suggestAccountCode('expense', []).startsWith('5'),
  'a new expense head is suggested in the 5000s',
);
ok(
  suggestAccountCode('asset', DEFAULT_CHART.map((seed) => seed.code)) !== '1000',
  'a code already in the chart is never suggested',
);
ok(
  isAccountCode(suggestAccountCode('income', ['4000', '4010'])),
  'the suggestion is always a valid code',
);
ok(!isAccountCode('50'), 'two digits is not a code');
ok(!isAccountCode('5A00'), 'a letter is not a code');
ok(isAccountCode('5000'), 'four digits is');

/* -----------------------------------------------------------------------------
 * 8. Amounts from a form.
 * -------------------------------------------------------------------------- */

section('Amounts');

ok(parseAmountPaise('1234.56') === 123_456, 'rupees and paise convert exactly');
ok(parseAmountPaise('1234') === 123_400, 'whole rupees convert exactly');
ok(parseAmountPaise('') === null, 'a blank amount is not zero, it is nothing');
ok(parseAmountPaise('abc') === null, 'nonsense is refused rather than read as zero');
ok(
  parseAmountPaise('12.345') === null,
  'three decimal places is refused — there is no third decimal in a rupee',
);
ok(parsePositiveAmountPaise('0') === null, 'zero is refused where a positive is required');
ok(
  parsePositiveAmountPaise('-5') === null,
  'a negative is refused where a positive is required',
);
ok(parsePositiveAmountPaise('0.01') === 1, 'one paisa is a valid amount');

/* -----------------------------------------------------------------------------
 * 9. Sources, statuses and permissions.
 * -------------------------------------------------------------------------- */

section('Sources and statuses');

ok(
  LEDGER_SOURCES.includes('fee_payment') && LEDGER_SOURCES.includes('expense'),
  'the sources cover what actually posts today',
);
ok(
  MANUAL_SOURCES.every((source) => LEDGER_SOURCES.includes(source)),
  'every hand-writable source is a real source',
);
ok(
  !isManualSource('fee_payment'),
  'a hand-written entry cannot claim to be a fee payment — it would sit in the reconciliation beside real ones with nothing to tell them apart',
);
ok(isManualSource('manual'), 'a journal entry can');
ok(isManualSource('opening_balance'), 'so can an opening balance');
ok(
  !isManualSource('reversal'),
  'a reversal is written by the reverse route, never claimed by a request body',
);

ok(EXPENSE_STATUSES.length === 3, 'an expense is a draft, approved or rejected');
ok(expenseIsPosted('approved'), 'only an approved expense has reached the ledger');
ok(!expenseIsPosted('draft'), 'a draft is a request for money, not money that moved');
ok(!expenseIsPosted('rejected'), 'a rejected one is a request that was refused');

section('Permissions');

for (const key of ['accounting.read', 'accounting.write', 'accounting.settle'] as const) {
  ok(
    (PERMISSIONS as readonly string[]).includes(key),
    `${key} is in the catalogue, so the role_permissions CHECK accepts it`,
  );
}

ok(
  DEFAULT_ROLE_PERMISSIONS.accountant.includes('accounting.write'),
  'an accountant may keep the books by default',
);
ok(
  !DEFAULT_ROLE_PERMISSIONS.accountant.includes('accounting.settle'),
  'and may NOT settle their own takings — a person who both takes money across a desk and accepts their own count is a control with nobody in it',
);
ok(
  DEFAULT_ROLE_PERMISSIONS.school_admin.includes('accounting.settle'),
  'the school administrator can, which is who accepts it at a one-office school',
);
ok(
  DEFAULT_ROLE_PERMISSIONS.principal.includes('accounting.read') &&
    !DEFAULT_ROLE_PERMISSIONS.principal.includes('accounting.write'),
  'a head sees the books and does not keep them — the same split as payroll',
);
ok(
  !DEFAULT_ROLE_PERMISSIONS.teacher.includes('accounting.read'),
  'a teacher holds none of it',
);
ok(
  DEFAULT_ROLE_PERMISSIONS.parent.length === 0 &&
    DEFAULT_ROLE_PERMISSIONS.student.length === 0,
  'and neither do the two portal roles',
);

/* -----------------------------------------------------------------------------
 * 10. The reports.
 * -------------------------------------------------------------------------- */

section('The financial statements');

const financial = REPORTS.filter((report) => report.group === 'Accounting');

ok(financial.length === 7, `all seven financial reports are declared (found ${String(financial.length)})`);

ok(
  financial.every((report) => report.permission === 'accounting.read'),
  'every one of them is gated on accounting.read, so a fee clerk cannot open the salary bill',
);

ok(
  financial.every((report) => report.caveat !== undefined),
  'every one of them carries a caveat — a printout leaves the building, and a figure whose meaning depends on an unseen rule is how a school reports the wrong number in good faith',
);

ok(
  financial.every((report) => report.columns.length >= 3),
  'none of them is a single column of figures with nothing naming the rows',
);

ok(
  financial.some((report) => report.key === 'balance-sheet') &&
    financial.some((report) => report.key === 'profit-loss') &&
    financial.some((report) => report.key === 'day-book'),
  'the three a school is actually asked for are among them',
);

/* -------------------------------------------------------------------------- */

console.log(
  failures === 0
    ? `\nPASS — ${String(checks)} assertions across the ledger rules, the chart, the migration and the statements.`
    : `\nFAIL — ${String(failures)} of ${String(checks)} assertions failed.`,
);

process.exitCode = failures === 0 ? 0 : 1;
