# Release notes — Sprint 13.5: Accounting

**Status:** shipped 2026-08-21, merged in [#22](https://github.com/Haznain666/School-Managment/pull/22).
Migration `0027_sprint135_accounting.sql`.

> ⚠ **`0027` has been proven, not deployed.** It was applied to a real
> PostgreSQL 16 — all 28 migrations in order, then the seed and the backfill
> against a school that already had three fee payments in it. It has **not**
> been run against the production database, and until somebody does, the module
> has no tables there. The backfill is guarded on
> `fee_payments.ledger_transaction_id` being null rather than on a date, so it
> will pick up whatever has accumulated in the meantime.

The school's books. Six tables, one column on an existing table, seven printable
statements, and one rule that everything else here exists to serve.

---

## The rule

**The ledger is append-only.** Nothing in this application updates or deletes a
row in `ledger_transactions` or `ledger_entries`. Not a typo, not a wrong date,
not a payment entered twice.

A correction is a **reversing entry**: a second transaction whose two sides are
the mirror of the first, dated the day it was corrected, carrying the reason it
was written and a link back to what it reversed. Both stay in the book — the
original struck through on screen, the reversal beside it.

The reason is not tidiness. A parent disputing a figure in March is asking about
a payment made in October, and the only answer a school can give is the entry as
it was written plus everything that has happened to it since. A ledger that can
be edited answers "it says 5,000 now", which is not an answer.

Sprint 16 (JazzCash/Easypaisa and the parent wallet) and Sprint 20 (POS) both
post here, and both carry real money in and out of a parent's balance. Which is
why accounting is Sprint 13.5 and not Sprint 21: retrofitting a ledger
underneath live money is exactly the cost this ordering was chosen to avoid.

---

## What a school gets

**A chart of accounts** (`ledger_accounts`). Fifteen heads to start with — cash,
bank, cheques in hand, fees receivable, payables, fee income, salaries, rent,
utilities, teaching materials, transport, repairs and the rest. Deliberately
short: a chart a bursar reads in one screen and extends when they need to is
worth more than the eighty-line template an accounting package ships with, of
which a school uses nine and is confused by the rest.

Accounts are renamed, re-coded and switched off. They are never deleted — an
account that has been posted to is part of the history of the school's money,
and a balance sheet that silently dropped one would stop balancing.

**The books** (`ledger_transactions` + `ledger_entries`). Every entry has one
date, one memo and one cause, and two or more balanced sides. Debits equal
credits in whole paise, checked in the poster, in the browser form, and by a
database constraint.

**Expenses** (`expenses` + `expense_categories`). File a bill, attach it,
approve or reject it. **Filing is not paying**: saving writes a request and
posts nothing. Approving is what moves the money, and it debits the category's
head and credits the account it came out of in one transaction.

An approved expense is frozen. Correcting one means reversing its posting, in
the open, with a reason — not editing a row until it agrees with a different
story.

**Fee payments post to the ledger.** Every payment taken from now on debits the
account the money landed in and credits Fee Income, **inside the same database
transaction** that records the payment. Migration `0027` backfills every payment
ever recorded, dated to the payment rather than to the day it ran.

**Per-staff cash accounts and settlement** (`cash_settlements`). See below.

**Seven statements**, each on screen, on `PrintSheet` and as CSV: balance sheet,
profit and loss, day book, day-by-day account summary, month-by-month for a
year, expenses by category, and an income/expense summary in the shape a tax
return wants.

---

## The fee counter

A Pakistani school runs its fee counter with a person and a drawer. Parents pay
that person across a desk all morning; at some point in the afternoon they count
the drawer and hand it to the bursar, who counts it again. Until that moment the
money is the school's but it is **in the clerk's hands**, and those are two
different facts.

Every other design collapses them. If a cash payment goes straight to office
cash, the office balance says the money is in the safe when it is in a drawer on
the other side of the building — and nobody can be short.

So a member of staff can be given their own cash account. From then on the cash
*they* take lands there, and their balance is **what they owe the school right
now**. Settling moves it: debit office cash or the bank, credit their drawer.

**A short is visible, not absorbed.** The settlement form pre-fills with what
the drawer should hold; whoever counts it types what was actually on the desk.
Anything left over stays in the clerk's account as a balance they are still
carrying. Writing it off is a decision a head teacher makes with a journal
entry, not something a form does quietly at four in the afternoon.

**A school that never opens a drawer behaves exactly as it did before this
release.** Cash goes to the office account, as it always has.

---

## Permissions

Three new keys, and the third one is the point.

| Key | Who holds it by default |
| --- | --- |
| `accounting.read` | School administrator, principal, accountant |
| `accounting.write` | School administrator, accountant |
| `accounting.settle` | **School administrator only** |

An accountant at a fee counter is the person whose takings get settled. A person
who both takes money across a desk and accepts their own count is a control with
nobody in it. A school with one office and one person in it grants `settle` to
them in one click — that is what Sprint 8's permission matrix is for — and does
so having read the sentence explaining what it means.

A head teacher sees the books and does not keep them, which is the same split
Sprint 8 made between `payroll.read` and `payroll.write`.

---

## Two things that are not what the sprint plan said

**`ledger_entries` has a header table.** `SPRINTS.md` §13.5 names one table. A
transaction has exactly one date, one memo and one cause, and two or more sides;
repeating the date on every line lets the two halves of one transaction fall on
different days. Splits are real here rather than theoretical — payroll is one
transaction with a line per deduction head.

**The module flag is the existing `accounts`.** "Accounts & Finance" has been in
the platform module list since Sprint 2. Adding a second `accounting` key would
be two switches for one thing, plus a `school_modules` constraint change, and a
school with the old flag on and the new one off would watch the module disappear
on deploy.

---

## Income is counted when the money arrives

A fee payment posts. **Raising a challan posts nothing.**

The alternative — debit Fees Receivable when a challan is issued, clear it when
it is paid — is textbook accrual accounting, and it would put eight hundred
entries in the day book every time a school bulk-generates a month's challans.
It would also give the school **two answers** to "how much is outstanding": the
ledger's, and the fee module's. The fee module's has a challan number attached
to every rupee of it, so it stays the authoritative one and the aged-debt report
still reads it.

`1100 Fees Receivable` is still seeded, for a school moving its books in here
that needs somewhere to put the fees it was already owed on the day it started.

**If you are reading this in a later sprint and about to make challans post:**
read the header of `0027` first. This was a decision, not an oversight.

---

## What is not in this release

- **No year-end.** The books are never closed, and the balance sheet shows the
  period's profit as its own line under Equity rather than folding it into a
  reserve. A school that has never run a year-end would otherwise have a balance
  sheet that does not balance and nothing on screen saying why.
- **No bank reconciliation.** Cheques land in `1020 Cheques in Hand` and are
  moved to the bank by journal entry when they clear. A reconciliation screen is
  a real feature and is not this one.
- **No budgets, no cost centres, no multi-currency.** A campus can own an
  account and an entry can carry a campus, which covers the question a school
  actually asks.
- **Payroll does not post automatically yet.** `5000 Salaries & Wages` is seeded
  and reachable by journal entry. Wiring the payroll run to it is a small change
  and belongs with a sprint that can test it against a real run.

---

## The check

`npm run check-accounting` — 121 assertions, in CI on every push.

Every failure this module can have is silent. An unbalanced ledger does not
throw; it stops balancing. A sign convention inverted in one place produces a
profit and loss on which salaries appear to earn the school money, and every
number on it looks entirely plausible. Nothing a type-checker or a build can see
is wrong.

So it asserts the rules directly: one paisa out is refused; an entry plus its
reversal nets every account it touched to zero; income reads `+1,000` rather
than `−1,000`; a cheque lands somewhere that is not the bank; the balance-sheet
identity holds, and breaks when one paisa is added to one side of it.

It also asserts that migration `0027`'s hand-written seed and `DEFAULT_CHART` in
`lib/accounting.ts` describe the same fifteen accounts and eleven categories —
the strongest thing a check with no database credentials can say about two
copies of one list.

---

## What QA found, and the one thing it caught

The sprint was driven end to end on 2026-08-21: every migration applied to a
real Postgres, 53 assertions run against the resulting database through the
application's own code, and every screen driven in Chromium.

### 🐛 The day book was broken, in both directions at once

`/dashboard/reports/day-book` threw `column reference "id" is ambiguous` on
every call — the screen, the print sheet and the CSV alike.

**Drizzle renders a column interpolated into a `sql` template unqualified when
the outer query has a single table in its `FROM`, and qualified once a join is
present.** The day-book runner read its amount and its two account names with
five correlated sub-selects on a single-table query, so they came out as bare
`"id"` and `"transaction_id"` — while the near-identical sub-selects in
`lib/accounting-queries.ts`, which sit beside joins, came out correct. The same
construct, right in one file and wrong in the other, for a reason neither file
mentioned.

One sub-select was ambiguous and Postgres refused it outright. The one beside it
was worse: `where "transaction_id" = "id"` is a legal comparison of two
`ledger_entries` columns that is never true, so **had the query not thrown, the
day book would have printed a column of zeroes and said nothing.**

Rewritten as two queries and a regroup — the shape `listDayBook` already used,
which no interpolated column ever leaves.

### 🐛 And the check that should have caught it was itself failing

`scripts/check-reports.ts` executes every runner against a real schema. It also
asserted that there were nine reports. Sprint 13.5 added seven and did not
update the count, so the one check in this repository that could have found the
day book was red for an unrelated reason — which is how the day book reached a
merge.

It now asserts sixteen, and asserts the seven financial statements by name.
**It needs a database, so it is not in CI. Run it after touching any runner.**

### What was actually verified

| | |
| --- | --- |
| Migrations | all 28 applied in order to PostgreSQL 16 |
| The backfill | three pre-`0027` payments posted to `1000`, `1010` and `1020` — the cheque **not** to the bank — each dated to the payment, not to the migration |
| Idempotency | the seed and backfill re-run: **0 rows** written on all five statements |
| The book | debits = credits after every operation, to the paisa |
| The poster | one paisa out refused; another school's accounts refused |
| Reversal | mirror written, original left standing and marked, reversing twice refused, reversing a reversal refused |
| Per-staff cash | a payment landed in the clerk's drawer and not the office safe; with no drawer it fell back to the office, unchanged from before this sprint |
| Settlement | short of 500 named **before** saving, left in the drawer after; over-settlement refused |
| The statements | all seven ran, printed under `print` media, and exported as CSV with the `[reversed]` markers intact |
| The balance sheet | **16,800 = 16,800** |
| Permissions | an accountant's Cash Counters link absent, URL bounced, `POST /settlements` **403** |
| The module gate | screen closed, nav section gone, dashboard tile back to naming what it needs |
| The empty state | one-click setup, then every screen renders at zero |
| Console | no errors and no failed requests across twelve routes |

### What is still not verified

- **Sign-in.** The browser run stubbed the two auth seams, because sign-in needs
  a Supabase project this environment does not have. Everything behind the
  session is verified; the session itself is not. The stubs were reverted and
  are not in the repository.
- **Real A4.** The sheets render under `print` media and produce sane PDFs.
  Nobody has held one. This is still the item `STATE.md` has been carrying for
  four sprints.
- **Two people approving one expense at the same instant.** The row lock is in
  the code and reasoned about; it has not been raced.
