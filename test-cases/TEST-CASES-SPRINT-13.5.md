# Test cases — Sprint 13.5: Accounting

Traces to [`RELEASE-NOTES-SPRINT-13.5.md`](../release-notes/RELEASE-NOTES-SPRINT-13.5.md).
Migration `0027`.

## Status — 2026-08-21

**`0027` was applied to a real PostgreSQL 16 and the sprint was driven end to
end in Chromium.** The cases below are marked with what that run actually
established:

| Mark | Meaning |
| --- | --- |
| ✅ **VERIFIED** | executed against a real database or in a real browser, and passed |
| 🐛 **FOUND A BUG** | executed, failed, fixed, re-executed |
| ⬜ | not yet executed — needs the live database, a printer, or a second real tenant |

The run used two seeded schools: one carrying three fee payments (cash, bank
transfer, cheque) recorded **before** `0027`, so the backfill was tested on data
that predated it; and one with the module on and no chart, for the empty state.

⚠ **The browser run needed the two auth seams stubbed locally**, because
sign-in requires a Supabase project this environment does not have. Those stubs
were reverted and are not in the repository — `git status` was checked before
committing. What that means for these cases: everything *behind* the session is
genuinely verified; **the sign-in path itself is not**, and neither is
middleware's real tenant resolution.

⚠ **Seed before starting.** Several cases need history that does not exist on a
fresh school:

- a school with **at least three fee payments already recorded** before `0027`
  runs — one cash, one bank transfer, one cheque. UC-A135-02 is the backfill and
  it can only be tested once, on data that predates the migration.
- **two members of staff** who can be given cash accounts, one of whom will take
  a payment during the test.
- the **Accounts & Finance** module switched on for the school in Super Admin.

---

## The migration and the backfill

#### UC-A135-01 · A migrated school opens with a chart, not an empty screen — P1 · ✅ **VERIFIED**
**Role** School administrator (`accounting.read`) · **Traces to** "Fifteen heads to start with"
1. Apply `0027`. Open **Accounting → Chart of accounts**.
- **Expect** fifteen accounts, in code order, `1000` through `5900`. Cash in
  Hand, Bank Account, Cheques in Hand and Fee Income are each marked **Posted to
  automatically**.
- **Fail** if the empty state appears. A school that has been taking money for a
  year opening on "Setup required" is how somebody concludes the module does not
  work.

#### UC-A135-02 · Every historical fee payment is in the books — P1 · ✅ **VERIFIED**
**Role** School administrator · **Traces to** "backfills every payment ever recorded"
1. Note the number of `fee_payments` rows before applying `0027`.
2. Apply it. Open **Accounting → Day book** with the date range set wide enough
   to cover the oldest payment.
- **Expect** one entry per historical payment, each dated **to the payment**,
  each debiting a cash/bank/cheque account and crediting Fee Income, and each
  labelled "Fee payment (backfilled from the fee module)".
- **Expect** Cash in Hand on the overview to be non-zero at a school that has
  taken cash.
- **Fail** if every backfilled entry carries today's date. A year of takings on
  one afternoon's day book is worse than none.
- **Fail** if a cheque payment debited Bank Account. A cheque is not money until
  it clears.

#### UC-A135-03 · Running the backfill twice writes nothing — P2 · ✅ **VERIFIED**
1. Re-run the three backfill statements at the foot of `0027`.
- **Expect** zero rows affected on all three.
- **Fail** on a doubled Cash in Hand balance.

---

## Fee payments post to the ledger

#### UC-A135-04 · Taking a payment posts it — P1 · ✅ **VERIFIED** (via the poster; the challan screen itself ⬜)
**Role** Accountant (`fees.write`) · **Traces to** "inside the same database transaction"
1. Record a **cash** payment of 5,000 against any challan.
2. Open **Accounting → Day book**.
- **Expect** an entry dated today: debit Cash in Hand 5,000, credit Fee Income
  5,000, memo naming the student and the challan number.
- **Expect** the Cash in Hand tile on the accounting overview to have risen by
  exactly 5,000.
- **Fail** if the payment succeeded and no entry appears. This is the defect the
  whole sprint exists to prevent, and it is invisible from the fee module.

#### UC-A135-05 · A bank transfer and a cheque land in different places — P1 · ✅ **VERIFIED**
1. Record one payment as **Bank transfer** and one as **Cheque**.
- **Expect** the transfer to debit `1010 Bank Account` and the cheque to debit
  `1020 Cheques in Hand`.
- **Fail** if both went to Bank. A school counting an uncleared cheque as bank
  balance will overdraw on one that bounces.

#### UC-A135-06 · A school with no chart can still take money — P2 · **NEEDS SEED**
**Role** Accountant
1. On a school where the chart has *not* been set up, record a payment.
- **Expect** the payment to succeed. The receipt response carries a null ledger
  reference.
- **Fail** if the counter cannot take a parent's cash because of an accounting
  setup step nobody at the counter can perform.

---

## Expenses

#### UC-A135-07 · Filing an expense moves no money — P1 · ✅ **VERIFIED IN BROWSER**
**Role** Accountant (`accounting.write`) · **Traces to** "Filing is not paying"
1. **Accounting → Expenses → File an expense.** 12,000, Electricity, paid from
   Cash in Hand. Save.
- **Expect** the row to read **Awaiting approval**, and the Cash in Hand tile to
  be **unchanged**.
- **Expect** the day book to contain nothing for it.
- **Fail** if the balance moved. Filing is a request.

#### UC-A135-08 · Approving posts it — P1 · ✅ **VERIFIED IN BROWSER**
1. Approve the expense from UC-A135-07.
- **Expect** Cash in Hand to fall by 12,000 and a day-book entry debiting
  Utilities and crediting Cash in Hand.
- **Expect** the row to name the approver.

#### UC-A135-09 · An approved expense cannot be edited — P1 · ✅ **VERIFIED IN BROWSER**
1. Look at the approved expense's row.
- **Expect** no Edit and no Discard control; the row says to reverse its ledger
  entry instead.
- **Fail** if Edit is present. A description that can be edited away from the
  transaction it describes is worse than no description.

#### UC-A135-10 · Rejecting requires a reason and posts nothing — P2
1. File another expense and reject it with the reason box empty.
- **Expect** a refusal naming the missing reason.
2. Reject it with a reason.
- **Expect** the row to show the reason, and no ledger entry to exist for it.

#### UC-A135-11 · Two people approving at once approve it once — P1 · **HARD**
**Role** Two sessions, both `accounting.write`
1. Open the same draft in two browsers. Press Approve in both within a second.
- **Expect** one success and one "Somebody else decided this one first".
- **Expect** exactly **one** ledger entry, and Cash to fall by the amount once.
- **Fail** on two entries. Production runs seven server processes; this is not a
  theoretical race.

#### UC-A135-12 · An expense cannot be paid out of an income account — P2
1. Try to file an expense paid from Fee Income (post the request directly if the
   picker does not offer it — the picker filters, the route decides).
- **Expect** a refusal. A balanced entry can still be nonsense.

---

## The append-only rule

#### UC-A135-13 · A wrong entry is reversed, not deleted — P1 · ✅ **VERIFIED IN BROWSER**
**Role** Accountant · **Traces to** "the ledger is append-only"
1. In the day book, reverse any entry. Give a reason.
- **Expect** a **new** entry dated today, memo beginning "Reversal —", carrying
  the reason, marked **Is a reversal**.
- **Expect** the original **still visible**, struck through, marked
  **Reversed**.
- **Expect** the two accounts it touched to be back where they were.
- **Fail** if the original disappeared. A day book that hides a reversed entry
  disagrees with itself the moment anybody adds it up.

#### UC-A135-14 · A reversal cannot itself be reversed — P1 · ✅ **VERIFIED**
1. Try to reverse the reversal from UC-A135-13.
- **Expect** the control to be absent, and a direct request to be refused with a
  sentence saying it would restore the mistake.

#### UC-A135-15 · An entry cannot be reversed twice — P1 · ✅ **VERIFIED**
1. Reverse an entry, then post a second reversal of the same entry directly to
   the API.
- **Expect** "That entry has already been reversed."
- **Fail** on a double correction. A 50,000 payment reversed twice leaves the
  school 50,000 up on its own books with nothing on screen saying why.

#### UC-A135-16 · There is no delete anywhere in the module — P1 · ✅ **VERIFIED**
1. Look for a delete control on the day book, on the chart of accounts, and on
   any approved expense.
- **Expect** none. The chart offers **Switch off** and says what that means.

---

## Journal entries

#### UC-A135-17 · An unbalanced entry cannot be posted — P1 · ✅ **VERIFIED IN BROWSER** (form and API both)
1. **Day book → Post a journal entry.** Debit 5,000 on one account, credit 4,000
   on another.
- **Expect** the message "Debits and credits must be equal" and the Post button
  disabled.
2. Post the same body directly to `POST /api/school/accounting/entries`.
- **Expect** a 400 with the same sentence. **Fail** if the server accepts what
  the form refused — that is the two halves disagreeing, which is the defect
  this shared check exists to prevent.

#### UC-A135-18 · A hand-written entry cannot claim to be a fee payment — P1 · ✅ **VERIFIED**
1. Post a journal entry directly with `"source": "fee_payment"`.
- **Expect** a 400. **Fail** if it is accepted: it would then sit in the fee
  reconciliation beside real payments with nothing to tell them apart.

#### UC-A135-19 · Another school’s account cannot be posted to — P1 · **TENANCY** · ✅ **VERIFIED**
**Role** School administrator at school A
1. Post a journal entry naming a `ledger_accounts.id` belonging to school B.
- **Expect** "One of the accounts on this entry could not be found." — the same
  sentence a mistyped id gets.
- **Fail** on a 500, on a success, or on any message that distinguishes "exists
  elsewhere" from "does not exist".

---

## The fee counter

#### UC-A135-20 · Opening a drawer redirects that person’s cash — P1 · ✅ **VERIFIED**
**Role** School administrator (`accounting.settle`)
1. **Accounting → Cash counters → Open a cash account** for a member of staff.
2. Sign in as that person and record a **cash** fee payment of 3,000.
3. Return to Cash counters.
- **Expect** their row to read 3,000 held, and **office Cash in Hand to be
  unchanged**.
- **Fail** if the money went to the office account. The whole design is that
  those are two different facts.

#### UC-A135-21 · A bank transfer never enters a drawer — P2 · ✅ **VERIFIED**
1. As the same person, record a **bank transfer**.
- **Expect** it to debit Bank Account, not their drawer. It is already at the
  bank; nobody is carrying it.

#### UC-A135-22 · Settling in full clears the drawer — P1 · ✅ **VERIFIED IN BROWSER**
1. Settle the 3,000 from UC-A135-20 in full.
- **Expect** their balance to reach zero and read **Settled up**, office Cash in
  Hand to rise by 3,000, and a day-book entry for the settlement.

#### UC-A135-23 · A short stays in the drawer and is shown — P1 · ✅ **VERIFIED IN BROWSER**
1. With 3,000 in a drawer, settle **2,500**.
- **Expect** a warning before saving that 500 stays in that person's drawer as a
  balance they are still carrying.
- **Expect** afterwards: their balance is 500, and the settlement row shows
  expected 3,000 against handed over 2,500.
- **Fail** if the drawer was zeroed. A short absorbed by a form is a short that
  becomes nobody's problem.

#### UC-A135-24 · More than the drawer holds is refused — P2 · ✅ **VERIFIED IN BROWSER**
1. Settle 5,000 from a drawer holding 3,000.
- **Expect** a refusal naming what they are actually holding.

#### UC-A135-25 · An accountant cannot settle their own takings — P1 · **PERMISSION** · ✅ **VERIFIED** (nav hidden, URL bounced, API 403)
**Role** Accountant, default permissions
1. Look for **Cash Counters** in the sidebar; then open
   `/dashboard/accounting/counters` directly.
- **Expect** the link to be absent and the direct URL to bounce.
- **Fail** if it opens. A person who takes money and accepts their own count is
  a control with nobody in it.

---

## The statements

#### UC-A135-26 · The balance sheet balances — P1 · ✅ **VERIFIED** (16,800 = 16,800)
1. **Reports → Balance sheet.**
- **Expect** the footer line to show assets equal to liabilities + equity +
  profit, as two identical figures.
- **Fail** if they differ by any amount at all.

#### UC-A135-27 · Every statement prints — P1 · ✅ **VERIFIED ON SCREEN** under `print` media; ⬜ on real A4
1. Open each of the seven Accounting reports and press **Print** on each.
- **Expect** a `PrintSheet` with the school letterhead, the scope sentence, and
  the report's caveat on the page.
- **Fail** if any sheet comes out blank. See STATE.md §5e for what a careless
  print rule has cost this product before.

#### UC-A135-28 · Every statement exports, and agrees with the screen — P1 · ✅ **VERIFIED**
1. Export each report as CSV and compare the totals against the screen.
- **Expect** identical figures. Both come from one runner; a difference means
  something has been formatted on one path and not the other.

#### UC-A135-29 · A reversed entry is marked in the CSV, not silently present — P2 · ✅ **VERIFIED**
1. Export the day book over a range containing a reversed entry.
- **Expect** `[reversed]` on the original and `[reversal]` on the correction.
- **Fail** if both read as ordinary entries. A strike-through does not survive a
  spreadsheet, and somebody reconciling in Excel will count the amount twice.

#### UC-A135-30 · Month by month shows the empty months — P2 · ✅ **VERIFIED** (12 rows)
1. **Reports → Month by month**, for the current year.
- **Expect** twelve rows including the months with nothing in them.
- **Fail** if quiet months are omitted. A missing month reads as an oversight; a
  zero reads as a quiet month.

#### UC-A135-31 · A fee clerk cannot open the salary bill — P1 · **PERMISSION** · ✅ **VERIFIED**
**Role** A user with `fees.read` and no accounting permission
1. Open **Reports**.
- **Expect** the Fees group and **no Accounting group**.
- **Expect** `/dashboard/reports/profit-loss` to bounce.

---

## Module and permission gating

#### UC-A135-32 · The module off closes every screen — P1 · ✅ **VERIFIED IN BROWSER**
1. Switch **Accounts & Finance** off in Super Admin. Open
   `/dashboard/accounting`.
- **Expect** the "not enabled" card, not a crash and not a working screen.
- **Expect** the sidebar section to be gone.

#### UC-A135-33 · The dashboard profit tile is honest in all three states — P1 · ✅ **VERIFIED IN BROWSER** — all three
1. Module off → **Expect** "Needs the Accounts & Finance module."
2. Module on, chart not set up → **Expect** "This school has no chart of
   accounts yet."
3. Module on, chart set up → **Expect** a figure, with income and expenses
   beneath it.
- **Fail** on `PKR 0` in states 1 or 2. A zero for a school that collected three
  lakh this morning is confidently wrong with no way for the reader to tell.

#### UC-A135-34 · A system account cannot be switched off — P2
1. On the chart of accounts, try to switch off **Fee Income**.
- **Expect** the control to be unavailable, and a direct request to be refused
  with a sentence saying where the next payment would go.
2. **Rename** it to "Tuition & Charges" and re-code it.
- **Expect** both to succeed, and the next fee payment to post to it under its
  new name.

#### UC-A135-35 · A new school arrives with its books — P2
**Role** Platform operator
1. Create a school in Super Admin. Switch on Accounts & Finance. Sign in and
   open Accounting.
- **Expect** the chart already present — seeding happens at creation.
- **Fail** on the empty state. It is recoverable in one click, but a school that
  quietly has no books is the state nobody goes looking for.

---

## What the 2026-08-21 run found

### 🐛 The day book threw on every call — UC-A135-27, UC-A135-28, UC-A135-13

`/dashboard/reports/day-book` failed with

```
column reference "id" is ambiguous
```

and so did its print sheet and its CSV. Three of the cases above would have
failed on it, and the sprint shipped with all three unexecuted.

**The cause is worth knowing, because nothing in the repository could have told
you.** Drizzle renders a column interpolated into a `sql` template
**unqualified** when the outer query has a single table in its `FROM`, and
**qualified** once a join is present. The day-book runner read its amount and
its two account names with five correlated sub-selects on a single-table query,
so they came out as bare `"id"`, `"debit"`, `"transaction_id"` — while the
near-identical sub-selects in `lib/accounting-queries.ts`, which sit beside
joins, came out correct. The same code, correct in one file and broken in the
other, for a reason neither file mentions.

The join in one sub-select was ambiguous and Postgres refused it. The amount
sub-select beside it did not have the grace to fail: `where "transaction_id" =
"id"` is a legal comparison of two `ledger_entries` columns that is simply never
true, so **had the query not thrown, the day book would have printed a column of
zeroes**.

Fixed by dropping the correlated sub-selects for two queries and a regroup —
the shape `listDayBook` already used. Re-verified: seven entries, correct
amounts, both sides named, `[reversed]` and `[reversal]` on the corrected pair.

### 🐛 `check-reports` asserted there were nine reports

Sprint 13.5 added seven and did not update the count, so the one check that
executes every runner against a real schema **was itself failing** — which is
how the day book reached a merge. Now asserts sixteen, and asserts the seven
financial statements by name.

**This is the check that catches this class of bug, and it needs a database.**
Run it after touching any runner.

### Not a bug, but worth writing down

`DEV_FALLBACK_LOCATION_ID` is documented at length in `.env.example` and **no
code reads it**. Anybody trying to run a tenant locally will set it and watch
nothing happen. Pre-existing, unrelated to this sprint.

---

## What is still unexecuted

- **UC-A135-06, -10, -11, -12, -34, -35** — the smaller refusals and the
  new-school seed path. All are covered by `check-accounting` or by the QA
  harness at the API level; none has been clicked.
- **UC-A135-11 (two people approving at once)** — the row lock is in the code
  and reasoned about, and it has not been raced in anger.
- **UC-A135-27 on real A4.** The sheets are proven to render under `print`
  media in a headless Chromium and to produce sane PDFs. Nobody has held one.
- **Sign-in.** The browser run stubbed the auth seams because there is no
  Supabase project here. Everything behind the session is verified; the session
  itself is not.
