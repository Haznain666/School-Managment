# SPRINT-20-DDL-NOTES.md — what `0037` does, and what breaks without it

Migration: `db/migrations/0037_sprint20_vouchers_discounts_banks.sql`
Journal entry: `db/migrations/meta/_journal.json`, `idx: 37`, stamped
`1788177600000` — one day after `0036`.
Status at the time of writing: **written, NOT applied.** Applying it is the
DevOps step.

`0036` (Sprint 19b) is applied and verified. `0037` builds on the tree that
shipped with it and touches none of the same objects. `0037` was confirmed free
by **listing `db/migrations/`**, not by trusting prose: the directory ended at
`0036`.

---

## ⚠ The migration goes first. Not "should", **must**.

Six screens read the new columns on every render, and the fee counter's own
write path reads them before it writes. The failures are
`column … does not exist` or `relation "bank_accounts" does not exist`, which
reach the browser as a Next.js digest and name nothing.

| Surface | What it does on a database without `0037` |
| --- | --- |
| `/dashboard/settings/banks` | 500. `listBankAccounts` selects from `bank_accounts`, which does not exist. |
| **Any voucher detail page** — `/dashboard/fees/challans/[id]`, `…/record-payment`, `…/print`, and `/parent/fees?challan=` | 500. `getChallanDetail` now selects `schools.ntn`, `.website` and `.finance_email` on every call, and the print builder reads `bank_accounts` on top of that. |
| **`POST /api/school/fees/challans/[id]/payments`** | **500 — recording a fee payment stops working at every school.** `getChallanDetail` is the first thing it does. |
| `PATCH /api/school/fees/challans/[id]` (waive, cancel, apply late fee) | 500, same read. |
| `/dashboard/fees/concessions` | 500. `listConcessionSchemes` selects `scheme_type`. |
| `/dashboard/fees/settings` | 500. `getLateFeeRule` selects the two new booleans, and the page also asks for the active sibling schemes. |
| `/dashboard/settings` | 500. The profile read selects `ntn`, `website`, `finance_email`. |
| `GET`/`POST`/`PATCH`/`DELETE /api/school/settings/banks…` | 500. |
| `POST` / `PATCH /api/school/fees/concession-schemes` | 500 — a *write*, so it fails after validating rather than before. |
| `GET /api/school/fees/student-discounts` | 500, so the discount panel on the student profile and in the wizard renders its error state. |
| `POST /api/school/students` — enrolling a child | **Succeeds.** See below. |

The row to read twice is the **payments** one. Everything above and below it
breaks a *read*, which is loud and harmless — somebody sees an error page and
reports it within the minute. Recording a payment is a school's money coming in
over a counter with a parent standing at it, and while the read fails before
anything is written (so there is no partial state and no ledger entry without
its payment), a fee counter that cannot take money is the most expensive
half-hour this deployment can have.

### The enrolment does **not** roll back, and that is deliberate

The spec predicted that it would: the sibling auto-grant reads
`late_fee_rules.auto_apply_sibling_discount`, and a grant inside the enrolment
transaction would take admissions down at every school exactly as §5bi's
guardian-address column did.

It is built the other way. `applyEnrollmentDiscounts` runs **after**
`enrollStudent` has committed, in `POST /api/school/students`, and swallows its
own failures — the same judgement the GHL sync three lines above it and the
photo upload in the wizard both make. **A child admitted is a fact.** A discount
that did not apply is one click from the profile the wizard redirects to, and
that profile *says so*: the panel prints "Sara has a brother at this school. She
qualifies for the sibling discount" with the button beside it.

It could not have been inside the transaction in any case. `enrollStudent`
writes its four tables through one `batch()`, every statement in a batch is
built before any of them runs, and the sibling question is answered from the
guardian rows — which do not exist until that batch commits.

So on a database without `0037`, enrolling a child works, the auto-grant logs a
failure, and the profile shows the operator what to do about it.

**Apply `0037`, verify it, then deploy the code.** The migration is expand-only
and nothing serving today reads any of it, so it is safe to apply while the
*old* build is still up — which is the order it should actually be applied in.

---

## What it does

Four blocks. Every one expand-only: one new table and five new columns, all of
them either nullable or carrying a default. No existing column is altered, no
CHECK is widened, no row is rewritten, and **no permission key is added** — so
the `role_permissions` `permission` CHECK is untouched, which is the trap
STATE.md §5o records.

### Block 1 — `concession_schemes.scheme_type`

```
scheme_type  text NOT NULL DEFAULT 'other'
CHECK (scheme_type IN ('sibling','scholarship','other'))
```

**Every existing row takes the default. Nothing is inferred from a name.** A
scheme called "Sibling Discount" almost certainly is one, and guessing that from
a string is precisely the drift `concession_schemes` was created to end — the
same school also holds "Sibling disc." and "sibling discount (2 kids)". `other`
is the honest answer for a row created before the question was asked and it is
one dropdown to correct.

The failure mode of guessing is not cosmetic. A scheme wrongly marked `sibling`
is one the **last-child sweep will one day remove from a child**, and the note
it writes will say it did so because the family had no siblings left — which
would be true and would still be the wrong discount to take away.

The `DEFAULT` stays on the column after the backfill rather than being dropped.
Every insert in the code names the value explicitly, so it is never reached in
practice; leaving it means an `INSERT` typed at a psql prompt cannot fail on a
`NOT NULL` nobody remembered.

### Block 2 — `late_fee_rules`, two booleans

```
auto_apply_sibling_discount      boolean NOT NULL DEFAULT false
sibling_discount_for_last_child  boolean NOT NULL DEFAULT false
```

`late_fee_rules` is where they belong. That table has been "the school's fee
settings" since the due day moved into it — one row per school, `location_id`
unique — and a second single-row settings table would only be somewhere else to
look.

Both default **false**, and the first is the one that matters. A sprint that
deployed and began discounting every family's fees at a school that never asked
for it is the fee module's equivalent of the auto-send email, and it is *worse*:
it is not recoverable by switching the toggle back, because by then the vouchers
have been priced, printed and in some cases paid. Unwinding that is a
conversation with four hundred parents, not a column update.

### Block 3 — `schools.ntn`, `.website`, `.finance_email`

```
ntn            text NULL
website        text NULL
finance_email  text NULL
```

Decision D4. The reference voucher prints all three and the product held none of
them. Printed **only when set** — the label is omitted with the value rather
than printed empty, because a blank `NTN #` on a fee slip is a question a parent
asks at the counter.

`finance_email` is deliberately not `schools.email`. The office address and the
desk that reconciles a bank transfer are two different inboxes at every school
large enough to have a finance office, and the note under the bank block names
the second. Null means the note is not printed at all.

`ntn` is free text and gets no CHECK. NTN formats have changed twice, and a
school that types its STRN here instead is still printing the number it means to
print; a constraint would refuse a correct document to enforce a shape the tax
authority has already abandoned.

### Block 4 — `bank_accounts`

```
id                 uuid pk
location_id        text -> schools.location_id  on delete cascade
branch_id          uuid -> branches.id          on delete SET NULL   (nullable = shared)
account_title      text not null
bank_name          text not null
branch_name        text
branch_code        text
account_number     text not null
iban               text
swift_code         text
bank_address       text
intermediary_bank  text
intermediary_swift text
currency           text not null default 'PKR'
purpose            text not null default 'student'
                   CHECK (purpose IN ('student','staff','both'))
instructions       text
is_active          boolean not null default true
sort_order         integer not null default 0
created_at         timestamptz not null default now()
updated_at         timestamptz not null default now()

index (location_id)
index (location_id, purpose)
index (location_id, branch_id)
```

**Nothing to seed.** A school with no rows here prints a voucher with the
cash/pay-order line and no bank block, which is exactly what it printed before
this sprint.

`purpose` is `text` + CHECK on three values rather than two booleans. Two
booleans admit a fourth state — neither set — which is an account that exists
and is for nothing, and every reader would then have to decide whether that
meant "both" or "hidden".

`branch_id` is **nullable and means shared**, decision D1 of Sprint 19a one
table further on. `ON DELETE set null` for the same reason `0035`'s nine
catalogue tables are: an account whose campus is deleted is still the school's
account, and a cascade would delete the bank details a voucher printed last
month along with the campus record. Read it with `sharedOrOwnedBy`, never with
`eq` — every row is shared on the day this ships and `eq` would return nothing
at all while looking entirely normal on screen.

**No unique index on the account number.** Two rows carrying one number is a
school that has listed its main account twice for two purposes, or retyped it
while correcting the title. Refusing the second insert at the database would
surface as "could not save" on a screen with no way to find the first; the list
is a dozen rows long and a person can see the duplicate.

---

## Rollback

Every statement is `IF NOT EXISTS` / `EXCEPTION WHEN duplicate_object`, so
re-running the migration is a no-op and applying it to a database that has had
one column added by hand is safe.

Undoing it is not offered and should not be attempted while the Sprint 20 build
is serving — the five screens in the table above go straight back to 500. If it
must be undone, the code comes down first:

```sql
-- 1. roll the build back to 19b
DROP TABLE IF EXISTS "bank_accounts";
ALTER TABLE "schools" DROP COLUMN IF EXISTS "finance_email";
ALTER TABLE "schools" DROP COLUMN IF EXISTS "website";
ALTER TABLE "schools" DROP COLUMN IF EXISTS "ntn";
ALTER TABLE "late_fee_rules" DROP COLUMN IF EXISTS "sibling_discount_for_last_child";
ALTER TABLE "late_fee_rules" DROP COLUMN IF EXISTS "auto_apply_sibling_discount";
ALTER TABLE "concession_schemes" DROP CONSTRAINT IF EXISTS "concession_schemes_scheme_type_check";
ALTER TABLE "concession_schemes" DROP COLUMN IF EXISTS "scheme_type";
```

Two of those lose information that cannot be recovered:

* dropping `scheme_type` loses which schemes a school had classified. Every one
  comes back as `other` on re-apply, and the sibling scheme has to be marked
  again before auto-apply or the last-child sweep will do anything;
* dropping `bank_accounts` loses the account details themselves. Export the
  table before dropping it — a school will not thank anybody for asking it to
  retype eleven IBANs.

Nothing in this migration writes to Storage, so unlike `0036` there are no
orphaned objects either way.

**Grants already made are untouched by any of this.** A `student_concessions`
row freezes the scheme's name, rate, dates and heads onto itself at grant time
and `scheme_id` is provenance rather than a live join, so dropping `scheme_type`
changes no child's discount and reprices no voucher.

---

## How to apply it

`npm run db:migrate` is the documented route and **has not worked since Sprint
18**: `DATABASE_URL` in `.env.local` holds unescaped literal `@` characters in
the password, and `npx drizzle-kit migrate` hung on it for five minutes and
applied nothing (§5bg). `0034`, `0035` and `0036` all went in through
drizzle-orm's own `postgres-js` migrator instead — same statements, same
`drizzle.__drizzle_migrations` bookkeeping — against the **pooler host on port
5432** (session mode; 6543 is transaction mode and will not do DDL, and the
direct `db.<ref>.supabase.co` host is IPv6-only, §5c). Percent-encoding the
password would likely restore the documented route and nobody has done it yet.

Expect the bookkeeping table to go from **37 rows to 38**, with entry `id=38`
stamped `1788177600000` to match the journal.

## Verifying it

```sql
-- 1. the new table
SELECT table_name FROM information_schema.tables
 WHERE table_name = 'bank_accounts';                            -- 1 row

-- 2. the five new columns, with their defaults
SELECT table_name, column_name, data_type, is_nullable, column_default
  FROM information_schema.columns
 WHERE (table_name = 'concession_schemes' AND column_name = 'scheme_type')
    OR (table_name = 'late_fee_rules'
        AND column_name IN ('auto_apply_sibling_discount',
                            'sibling_discount_for_last_child'))
    OR (table_name = 'schools'
        AND column_name IN ('ntn','website','finance_email'))
 ORDER BY table_name, column_name;
-- scheme_type                     text  NO  'other'::text
-- auto_apply_sibling_discount     bool  NO  false
-- sibling_discount_for_last_child bool  NO  false
-- finance_email / ntn / website   text  YES (null)

-- 3. every existing scheme took the default, and nothing was guessed
SELECT scheme_type, count(*) FROM concession_schemes GROUP BY 1;
-- one row: other | <however many schemes exist>

-- 4. nobody's auto-apply got switched on
SELECT count(*) FROM late_fee_rules
 WHERE auto_apply_sibling_discount OR sibling_discount_for_last_child;   -- 0

-- 5. bank_accounts: the branch FK is SET NULL, the location FK cascades
SELECT conname, confdeltype FROM pg_constraint
 WHERE conrelid = 'bank_accounts'::regclass AND contype = 'f'
 ORDER BY conname;
-- …_branch_id_branches_id_fk    n   (set null)
-- …_location_id_schools_…_fk    c   (cascade)

-- 6. the three indexes, all tenant-first
SELECT indexname FROM pg_indexes
 WHERE tablename = 'bank_accounts' ORDER BY indexname;
-- bank_accounts_location_branch_idx, bank_accounts_location_id_idx,
-- bank_accounts_location_purpose_idx, bank_accounts_pkey

-- 7. nothing was seeded
SELECT count(*) FROM bank_accounts;                             -- 0

-- 8. both CHECKs actually refuse — each inside its own SAVEPOINT, per §5be
BEGIN;
  SAVEPOINT a;
    UPDATE concession_schemes SET scheme_type = 'sibiling';
                                     -- 23514 concession_schemes_scheme_type_check
  ROLLBACK TO a;
  SAVEPOINT b;
    INSERT INTO bank_accounts
      (location_id, account_title, bank_name, account_number, purpose)
    VALUES ('<a real location id>', 'X', 'Y', '1', 'parents');
                                     -- 23514 bank_accounts_purpose_check
  ROLLBACK TO b;
ROLLBACK;
```

Assertion 8 must run inside `SAVEPOINT`s: a refusal aborts the whole transaction
otherwise and the remaining assertions report a failure that is the *test's*
fault, not the schema's. §5bh records that trap costing a re-run.

Also worth doing once, and only after applying: open `/dashboard/settings/banks`,
`/dashboard/fees/settings`, `/dashboard/fees/concessions`, `/dashboard/settings`
and any voucher's detail page. All five 500 without this migration and all five
are a click or two from the sidebar, so a successful apply is visible in twenty
seconds without a query.
