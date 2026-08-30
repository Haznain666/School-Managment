# SPRINT 20 — the voucher, the discount, and the bank

**Written:** 2026-08-30. **Migration:** `0037_sprint20_vouchers_discounts_banks.sql`
(the next free number — confirmed by listing `db/migrations/`, which ends at
`0036`).

Read `CLAUDE.md` first. Every rule in it applies here, and three of them apply
sharply:

* **the ledger is append-only** — nothing in this sprint moves money, but the
  voucher's bank block sits next to code that does;
* **a value never reaches the driver through a raw `` sql`` `` template** — and
  when one is unavoidable, alias it to a name no joined table has;
* **every data-fetching route shows a loader** — three new routes here.

---

## Decisions taken before development, and not to be re-litigated

The product owner was asked and did not answer, so these are the defaults the
sprint is built on. They are stated here rather than discovered later.

| # | Decision | Why this one |
| --- | --- | --- |
| D1 | **The printed voucher is TWO copies, not three.** `STUDENT COPY` and `SCHOOL COPY`, side by side on landscape A4. | The reference PDF is two-up. Once the bank details are printed *on* the voucher, the bank copy has no job left — the teller reads the account number off the slip in front of them. Two copies also give each one half a sheet instead of a third, which is what the new bank block and notes need. |
| D2 | **Bank accounts live at `/dashboard/settings/banks`.** | They are school-wide reference data read by **two** modules — Fees prints them on a voucher, Payroll pays salaries from them. Neither owns them, and putting them under Fees would file the payroll bank under Fees. Settings is already where the school profile and branding live and is gated on the same permission pair. |
| D3 | **The discount UI appears in BOTH the enrollment wizard and the student profile.** | The requirement says discounts are chosen *while enrolling* and that auto-apply fires when the child "is being enrolled and identified as sibling" — that is the wizard. It also says the operator may "remove or apply other discounts" afterwards — that is the profile. One component serves both. |
| D4 | **`schools` gains `ntn`, `website` and `finance_email`.** | The reference voucher prints all three and the product holds none of them. Three nullable columns, editable on the School Profile form, printed only when set. Expand-only. |

---

## Item 1 — Users & Staff shows a student's sentinel in the Phone column

**Screen:** `/dashboard/users`. **Screenshot:** rows *Student 11*, *Student 2*,
*Student 3*, *Student 5* show `student:LGS-2026-0009` where a phone belongs.

`school_users.phone` is `NOT NULL` and a seven-year-old has no phone, so
`studentDirectoryPhone` writes the sentinel `student:<admission number>`.
§5bf fixed this on the **all-students** list by reading the primary guardian
through an ordered aggregate. The **users** list was never given the same
treatment and still prints the raw column.

**Do:**

* find the query behind `/dashboard/users` (`lib/school-queries.ts` or
  `lib/users-queries.ts` — locate it, do not guess) and, for rows whose role is
  `student`, resolve the **primary guardian's** phone the way `listStudents`
  does. If the aggregate is reused, alias it to a name **no joined table in that
  statement has** and qualify every reference including the one in the `WHERE`
  — CLAUDE.md's alias rule, which has now shipped a defect three times;
* where a student has no guardian on file, print `—`, never the sentinel;
* if the resolution turns out to be expensive on that screen, the acceptable
  fallback is to render `—` for the student rows and nothing else. **Printing
  the sentinel is not acceptable in any case.**

`formatPhoneForDisplay` already refuses to mask anything containing a letter, so
the sentinel is passing through untouched — the defect is the *selection*, not
the formatting.

## Item 2 — the two campus charts

**Screen:** `/dashboard`, group view (owner, no campus selected).

### 2a. A zero is a dash

`PKR 0` printed twice, stacked, against a campus with no activity is four
characters of noise where the reader wants to see nothing. Every **value label**
on a bar (`BarChart`, horizontal mode) whose value is exactly `0` renders `—`
instead of the formatted amount, in `text-ink-faint`.

The axis ticks keep `PKR 0` — an axis is a scale, and a scale with a dash on it
is broken. This is about the per-bar figure only.

The hidden accessible data table and the `summary` keep the real figure. A
screen reader must not be told a school collected a dash.

### 2b. The value label is running out of the card

`H_PADDING.right` is a hard-coded `40` viewBox units. `PKR 20,000` at 11px is
about 55, so the label is drawn past the right edge of the viewBox and the
screenshot shows `PKR 20,00` with the last glyph cut off.

Measure it, the way the vertical chart already measures its left gutter:
`axisGutter` in `lib/chart-scale.ts` exists for exactly this and takes the
ticks and the formatter. Use the same approach against the **widest value that
will actually be drawn**, not against the ticks, and reserve that much. A chart
whose longest bar is `PKR 1,250,000` needs more room than one topping out at
`PKR 900`.

### 2c. Type and colour

* value labels: `text-[10px] font-semibold tabular-nums`, `fill-[rgb(var(--ink))]`;
  a zero renders `—` in `fill-[rgb(var(--ink-faint))]` per 2a;
* axis ticks: keep `text-[10px]`, `fill-[rgb(var(--ink-muted))]`;
* category labels down the left edge: `text-[11px]`, `fill-[rgb(var(--ink))]`
  — they are the row's name and are currently the same weight as the ticks;
* nothing new is hard-coded as a hex. Every colour comes from a CSS variable, so
  `npm run check-theme` still passes and a dark school palette still works.

### 2d. A period selector on both charts

**Collection by campus** and **Income against expense by campus** each get a
`<Select>` in the card header offering **This month** and **This academic
year**.

* the selection is one query parameter shared by both charts —
  `?period=month` / `?period=year` — because two selectors that can disagree
  produce a screen whose two halves are about different periods with nothing
  saying so. Default is `year` for Collection (what it shows today) and the page
  reads the same parameter for both;
* `getCampusLedgerTotals` **already takes a `{ from, to }` window**. Pass the
  academic year's span for `year` and `monthOf(now)` for `month`;
* `getCampusScorecard` is hard-coded to the active academic year. Give it an
  optional window that narrows the `fee_challans` aggregate by issue date;
  absent means the whole year, exactly as today;
* the card's `description` states the period in words, so a printed or
  screenshotted dashboard still says what it is about;
* the page is already `force-dynamic`, so reading a second search parameter
  costs nothing. **Do not** add `searchParams` to any page that does not already
  have it — CLAUDE.md's second rule.

## Item 3 — a paid or cancelled voucher has nothing to print, and "challan" is not a word this product uses

### 3a. Hide Print on a closed voucher

`ChallanActions` renders **Print** unconditionally. Once a voucher is `paid`,
`cancelled` or `waived` the slip is not a payment instrument any more.

* Print appears only when `status` is `unpaid` or `partial` — the existing
  `isOpen` flag;
* the same rule applies to the **bulk print** selection on the voucher list: a
  closed voucher is not printable and must not be selectable for a print run.
  Where the list already allows selecting one, exclude it and say why in the
  disabled state rather than silently dropping it from the job;
* a **paid** voucher still needs a receipt, and that is a different document
  this sprint does not build. Do not repurpose the voucher print for it, and do
  not leave the button there in the meantime.

### 3b. `challan` → `voucher`, everywhere a person can read it

Sprint 18 renamed the screens; what is left is error messages, help text and one
button. **This is a user-facing-string rename only.** Table names, column names,
route paths, file names, type names and API response keys **do not change** —
`fee_challans`, `/dashboard/fees/challans`, `ChallanPrintView`, `challanId` all
stay exactly as they are, for the reason §5bi records about the Enrol→Enroll
pass: a route or a response key is a contract.

Known occurrences, and the list is not exhaustive — **grep for it**:

| File | Text |
| --- | --- |
| `components/fees/ChallanActions.tsx` | the button `Print challan`; `The late fee has been added to this challan.` |
| `components/fees/ChallanGenerator.tsx` | `Could not price this challan.`, `Could not generate the challan.`, `Could not generate the challans.` |
| `components/fees/ChallanTable.tsx` | `Could not load the challans.` |
| `components/fees/FeeReports.tsx` | `… across N challan(s)` — two places |
| `components/admissions/TransferPanel.tsx` | `A challan already paid is not touched…` |
| `components/fees/ConcessionManager.tsx` | `Their challans are billed at the…` |
| `components/parent/NotificationPreferencesForm.tsx` | `…and challans still appear on your fee page` |
| `types/school-auth.ts` | `Sees their children's attendance and fee challans.` |
| `db/schema/notification-preferences.ts` | `Fee challans and reminders`; `A new challan, and reminders while one is unpaid.` |
| `lib/accounting.ts` | `Tuition and every other charge raised on a challan.` |

Also sweep `lib/email-templates*`, `lib/fee-notices.ts`, `lib/fee-reminders.ts`
and `lib/voucher-auto-send.ts` — a parent-facing email that says "challan" is
the worst place for the word to survive.

`Challan` at the start of a sentence becomes `Voucher`; `challans` becomes
`vouchers`. Do not touch a comment or a docblock — they are for developers, and
rewriting them loses the history that explains the tables.

## Item 4 — the aged debt screen

**Screen:** `/dashboard/fees/defaulters`.

### 4a. 🐛 The guardian's phone is losing digits — root cause confirmed

`lib/defaulters.ts` masks the number on purpose: `maskPhone('+923211234567')`
gives `+92321****5555`. `AgedDebtTable` then hands that to
`formatPhoneForDisplay`, which strips every non-digit — asterisks included —
and re-masks what is left. `+92321****5555` becomes nine digits, which the
mobile mask renders as `(0321) 555-5`.

**The masking is right and stays.** The report exists to decide *who* to chase,
and rendering four hundred parents' full numbers into one page is handing out a
contact list. The defect is that a masked value is being put through a
formatter that assumes it is a number.

Fix it in **both** places, because either alone leaves the trap loaded:

1. `formatPhoneForDisplay` returns the value **untouched** when it contains a
   `*`, exactly as it already does for a letter, and for the same reason —
   digits that are not a whole number must never be re-grouped;
2. mask **after** formatting rather than before. Add `maskDisplayPhone` to
   `lib/phone-formats.ts`: format to `(0321) 123-4567` first, then blank the
   subscriber middle, giving `(0321) ***-4567`. That is a masked number that
   still reads as a Pakistani mobile and still has the right digit count.
   `lib/defaulters.ts` uses it; `maskPhone` in `lib/phone.ts` is left alone —
   it has a different job (confirming where a passcode was sent).

`reachable` is already computed from the **unmasked** value and must stay that
way.

### 4b. Column spacing and header alignment

`DataTable` sets `flex-row-reverse` on the sort button for `numeric` and `end`
aligned columns, so *Open vouchers*, *Days overdue* and *Outstanding* print
their caret **before** the label while every other header prints it after. Read
across the header row it looks like two different tables.

* the caret always follows the label. Achieve the right-edge alignment with
  `justify-end` on a full-width button instead of reversing the flex direction;
* give the sort caret a fixed footprint so a sorted and an unsorted header are
  the same width and the row does not shift when somebody sorts it.

### 4c. Type inside the cells

Three different sizes are in use for the same *kind* of thing — the secondary
line under a cell's main value. `text-xs` on the student number, `text-xs` on
the guardian phone, `text-[11px]` on the reminder chips, plain `text-xs` on
"Never".

Pick one — `text-xs` — for every secondary line in this table, and one muted
colour, `text-ink-muted`. The chips keep their pill background; only the type
size changes.

### 4d. The page title

`Aged debt` is rendered through `PageHeader` and must match every other page
title in the product. Check it against `/dashboard/fees/challans` and
`/dashboard/users` in a browser at the same zoom, and if the description
paragraph beneath it differs in size or colour from the others, correct the
outlier rather than the majority.

---

## Item 5 — schemes have a type

`concession_schemes` gains **`scheme_type`**, `NOT NULL`, one of:

| Value | Label |
| --- | --- |
| `sibling` | Sibling Discount |
| `scholarship` | Scholarship Discount |
| `other` | Other Discount |

**Backfilled to `other`, not to a guess.** A scheme called "Sibling Discount"
almost certainly *is* one, and inferring that from the name is exactly the drift
`concession_schemes` was created to end. `other` is the honest answer for a row
created before the question was asked, and it is one dropdown to correct.

Enforced by a CHECK, and by `readSchemeInput` in
`app/api/school/fees/concession-schemes/input.ts` — the shared reader, so create
and edit cannot disagree.

The create/edit modal in `components/fees/ConcessionSchemes.tsx` gains the
dropdown, above the name. The list gains a **Type** column and a facet filter on
it.

**A scheme's type does not change what it is worth.** The rate, the heads and
the dates still decide the money. The type decides which slot in the discount
modal it appears in, and nothing else.

## Item 6 — two settings, on `late_fee_rules`

That table is already "the school's fee settings" — one row per school, holding
the due day and the auto-send policy. Two boolean columns, both defaulting to
**false**, both surfaced as toggles on `/dashboard/fees/settings`.

### 6a. `auto_apply_sibling_discount`

> **Apply the sibling discount automatically**
> When a child is enrolled and the school already teaches a brother or sister,
> grant the sibling discount without being asked.

Off by default and it must stay off until a school turns it on. A sprint that
deployed and started discounting every family's fees at a school that never
asked for it is the fee module's equivalent of the auto-send email, and it is
not recoverable by a toggle — the vouchers are already priced.

When it is on, the enrollment path grants **the school's active `sibling`
scheme** — see item 7c for which one, and item 9 for who qualifies.

### 6b. `sibling_discount_for_last_child`

> **Keep the discount when only one child is left**
> By default the sibling discount is removed once a family has only one child
> still at the school. Switch this on to keep it.

Default **false**, which is the behaviour the requirement describes: a discount
for having siblings is not owed to a child who no longer has any.

## Item 7 — the Apply-discount section

A new component, `components/fees/StudentDiscountPanel.tsx`, used from two
places (D3).

### 7a. Where it goes

* **the enrollment wizard** — a new step, `Discounts`, between *Documents* and
  *Review and confirm*. Entirely skippable, like Documents: an admissions desk
  with a queue must never be blocked by a discount decision, and there is no
  validation to fail;
* **the student profile** — a card immediately **above** `FeeClearancePanel`,
  which is the "voucher generation section" the requirement names.

### 7b. What it shows

Three states, and each says something different:

1. **the student qualifies for a sibling discount and auto-apply is off** —
   > *Sara has a brother at this school. She qualifies for the sibling discount.*
   plus an **Apply discount** button;
2. **discounts are applied** — one chip per grant, naming the scheme and its
   rate (`Sibling Discount · 20%`), each with a remove control, plus **Apply
   discount** to add another;
3. **no discounts and no sibling** — **Apply discount** alone, with the
   scholarship and other schemes behind it.

### 7c. The modal

**Apply discount** opens a modal listing every **active** scheme the school has,
grouped by `scheme_type`, and the operator may select **at most one of each
type**. Selecting a second scholarship replaces the first in the selection
rather than adding to it — a radio group per section, not a checkbox list.

* **the Sibling Discount section appears only when the student is a sibling.**
  Not disabled — absent. A greyed-out section invites the operator to hunt for
  the permission that would enable it;
* a scheme already granted to this student is shown as already applied and
  cannot be selected twice;
* the modal states, per section, what an empty fee-head set means: *applies to
  every fee head*. That is the rule `concessionHeads` enforces and §5be records
  the cost of reading narrowly.

### 7d. What applying does

Writes an ordinary `student_concessions` row per selected scheme, **freezing the
scheme's name, rate, dates and heads onto it**, with `scheme_id` as provenance.
This is exactly what `applyScheme` in `lib/concession-schemes.ts` already does —
**reuse it, do not write a second grant path.** A second one would be a second
place for the freezing rule to be forgotten.

Removing a chip removes that grant. Removal must reprice the student's **open**
vouchers through `repriceOpenChallans`, which `lib/concession-schemes.ts`
already calls and which is idempotent with respect to credit. A paid voucher is
never repriced.

## Item 8 — siblings across campuses

**Already correct, and the job is to prove it and not break it.**
`lib/siblings.ts` matches on `student_guardians.location_id` — the *school* —
and joins no `branches` and no `grades`. Two children at two campuses of one
school already read as siblings today.

**Do:**

* add assertions to `scripts/check-branch-scope.ts` (or a new
  `scripts/check-siblings.ts` if that file is the wrong home) that the sibling
  query carries **no** branch predicate, so a future scoping pass cannot narrow
  it by accident. `resolveBranchScope` is applied to nine catalogue reads and it
  would be a natural mistake to apply it here;
* the sibling-qualification read in item 9 is written the same way — school
  scope, never campus.

Say it on the screen too: where the sibling chip names a brother at another
campus, print the campus name beside him. A clerk at Defence looking at a
discount granted for a child at Karachi needs to see why.

## Item 9 — who actually qualifies for a sibling discount

Three rules, and the second is the one with teeth.

### 9a. Never the only child

A sibling discount is granted to the **second sibling onwards**. A family with
one child at the school gets none.

Ordering is by **enrolment date, then admission number** — the eldest
enrolment keeps the undiscounted fee and every later one is discounted. Any
other ordering makes the discount move between children when a name is
corrected.

### 9b. The last one standing loses it

When siblings leave — completed, withdrawn, transferred out of the **school**,
not merely out of a campus — and one child remains, that child no longer
qualifies. Their sibling grant is **removed automatically**, and only their
sibling grant: a scholarship is a judgement about that child and is untouched.

Unless `sibling_discount_for_last_child` is on (item 6b), in which case nothing
is removed.

**How it runs, and this is a CLAUDE.md rule, not a preference:** it is a
background sweep, and anything a timer picks up is **claimed** with a
conditional `UPDATE … RETURNING`, never a read followed by an `if`. Production
runs seven scheduler processes. Follow `lib/voucher-auto-send.ts`, which is the
worked example in this repository — claim first, revert on failure.

The sweep also runs **synchronously** at the two moments a family's shape
changes and somebody is watching: when a student is withdrawn, and when an
enrolment status moves off `active`. A parent must not have to wait for a timer
to learn that their fee has gone up, and the timer is the backstop for the paths
nobody thought of.

**Removal is a `valid_until`, not a `DELETE`.** `student_concessions` closes a
grant by dating it, so the vouchers it already discounted stay explainable —
which is the same reasoning the ledger rule rests on. A deleted grant makes
February's slip unexplainable.

Every automatic removal writes a note on the row saying it was automatic and
why. An administrator asking "who took this discount off" must get an answer
that is not "nobody knows".

### 9c. Cross-campus counts

Qualification is a **school-wide** question, per item 8. A child at Defence with
a sister at Karachi has a sibling.

---

## Item 10 — bank accounts, CRUD, at `/dashboard/settings/banks`

New table **`bank_accounts`**.

| Column | Notes |
| --- | --- |
| `id` | uuid pk |
| `location_id` | tenant key, `NOT NULL`, cascade |
| `branch_id` | nullable — null means the whole school, per `0035`'s rule |
| `account_title` | `NOT NULL` — who the cheque is made out to |
| `bank_name` | `NOT NULL` |
| `branch_name` | the bank's branch, nullable |
| `branch_code` | nullable |
| `account_number` | `NOT NULL` |
| `iban` | nullable |
| `swift_code` | nullable — the international block |
| `bank_address` | nullable |
| `intermediary_bank` | nullable |
| `intermediary_swift` | nullable |
| `currency` | `NOT NULL` default `PKR` |
| `purpose` | `NOT NULL`, one of `student`, `staff`, `both` — CHECK |
| `instructions` | nullable — free text printed under the account on the voucher |
| `is_active` | `NOT NULL` default `true` |
| `sort_order` | `NOT NULL` default 0 — the order they print in |
| `created_at` / `updated_at` | |

Indexed on `(location_id)`, `(location_id, purpose)` and
`(location_id, branch_id)`.

**Screen:** a `DataTable` of accounts with an active/inactive toggle on each
row, a create/edit modal, and delete. Gated on `settings.read` to view and
`settings.write` to change — the same pair the rest of Settings uses, so no new
permission key and no `role_permissions` CHECK change.

**Purpose is a three-way radio, not two checkboxes.** "Students", "Staff",
"Both". Two checkboxes admit a fourth state — neither ticked — which is an
account that exists and is for nothing.

**Deleting is refused once an account has been printed on a voucher**… and it
has not, because nothing records that. So: deleting is allowed, and the
confirmation says plainly that vouchers already printed carry these details and
will not change. Deactivating is the safer act and the screen should say so.

**On the voucher, only `is_active = true` AND `purpose IN ('student','both')`
appear**, ordered by `sort_order` then `bank_name`. A campus-owned account
appears only on that campus's vouchers; a null `branch_id` appears on all of
them — `sharedOrOwnedBy` in `lib/branch-scope.ts` is the predicate, and it is
the one already used for nine catalogue tables.

An **inactive** account never prints. That is the whole point of the toggle: a
school closing an account needs the number off tomorrow's vouchers without
losing the record of where last month's money went.

## Item 11 — the voucher, repainted

`components/fees/ChallanPrintView.tsx`, rebuilt to the reference. Landscape A4,
**two copies** (D1), a dashed cut line between them.

Per copy, in this order:

1. **Header** — logo top-left, school (and campus) name beside it, the copy
   label (`STUDENT COPY` / `SCHOOL COPY`) top-right, and under it the billing
   period, `NTN #` when set, and `Voucher #`.
2. **Student block** — ID, Name, Email, Parent Email, as label/value pairs.
3. **Dates block** — `ISSUE DATE`, `DUE DATE`, `VALID UPTO`, `VERSION`.
   *Valid upto* is the due date plus the school's grace days where late fees are
   configured, and the due date otherwise. *Version* is `1` — the product has no
   voucher versioning and printing a number the reader cannot act on is
   acceptable only because the reference has it; do **not** invent a versioning
   scheme to fill it.
4. **Particulars table** — `Particulars | Payable Amount (PKR)`. Charges, then
   each discount as its own row in parentheses — `Academic Scholarship
   PKR (12,750)` — then subtotals, then:
   * `TOTAL AMOUNT PAYABLE WITHIN DUE DATE`
   * `TOTAL AMOUNT PAYABLE AFTER DUE DATE` — the total plus the late fee the
     school's own rule would charge. **Omit this row entirely when the school
     has no late fee configured.** A row saying the two totals are equal
     teaches a parent that paying late costs nothing.
5. **Payment methods** — the cash/pay-order line, then one block per active
   student bank account from item 10: bank name, account title, account number,
   IBAN, and the international details when set.
6. **Notes** — the school's own, defaulting to the reference's wording about
   sending proof of payment to the finance email, printed only when a finance
   email exists.
7. **Footer** — address, phone, office email, website, from `schools` and the
   campus.

**Colour:** the reference's header band and table rules take the school's own
brand colour through the existing CSS variables. **No hex literals.**
`lib/brand-derive.ts` is the load-bearing file and `npm run check-theme` is the
gate. A voucher printed in one school's green and another's blue is the product
working; a voucher printed in a hard-coded blue is a regression.

**Print-safety:** `@media print` behaviour belongs to `<PrintSheet>` and is not
re-implemented here. §5bd's warning stands — a careless global print rule made
every voucher come out blank once.

The **amount in words** stays. It is what stops a 1,000 becoming a 10,000
between the school gate and the cashier's window, and the reference's omission
of it is not a reason to drop it.

---

## Migration `0037` — expand-only, and it goes in FIRST

Every block is additive: two new tables' worth of columns, one new table, and
new nullable or defaulted columns. No column is altered and no row is rewritten,
so it is safe to apply while the **old** build is still serving.

The opposite order is not safe. State it in the DDL header, screen by screen, as
`0035` and `0036` do, and write `SPRINT-20-DDL-NOTES.md` beside it saying what
it does, how to verify it, how to undo it, and **what breaks if the code
deploys first**:

| Surface | Without `0037` |
| --- | --- |
| `/dashboard/settings/banks` | 500 — `bank_accounts` does not exist |
| the printed voucher | 500 — it reads `bank_accounts` on every render |
| `/dashboard/fees/concessions` | 500 — `listConcessionSchemes` selects `scheme_type` |
| `/dashboard/fees/settings` | 500 — the settings read selects the two new booleans |
| **enrollment with auto-apply on** | the grant fails inside the enrolment transaction — **enrolling a child stops working**, exactly the §5bi hazard |

Blocks:

1. `concession_schemes.scheme_type` — text, default `'other'`, `NOT NULL`, CHECK
   on the three values. Existing rows take the default; nothing is inferred from
   a name.
2. `late_fee_rules.auto_apply_sibling_discount` and
   `.sibling_discount_for_last_child` — boolean, `NOT NULL`, default false.
3. `schools.ntn`, `.website`, `.finance_email` — text, nullable, no default.
4. `bank_accounts` — the table above, with its CHECK, its foreign keys and its
   three indexes.

**No new permission keys.** Banks reuse `settings.read` / `settings.write`,
discounts reuse `fees.read` / `fees.write`. The `role_permissions` CHECK is
untouched, which is the trap §5o records.

---

## Definition of done

All ten gates, plus `check-theme` and `check-branch-scope`:

```
npm run typecheck && npm run lint && npm run check-loaders && npm run check-forms && npm run check-address-phone && npm run check-cnic && npm run check-currency && npm run check-sprint-periods && npm run check-accounting && npm run check-theme && npm run check-branch-scope && npm run build
```

`npm run build` is not optional. It is the only gate with a bundler in it, and
this sprint moves constants between server and client modules in at least three
places (the scheme-type constants, the bank purpose constants, the discount
panel). §5bg records what that costs when it is skipped.

Delete `D:\School-Management-System\.claude\worktrees\node_modules` before every
build in this worktree — §5f, and three sessions have rediscovered it.

And the gate no script is: **open the screens.** §5bg and §5bh both conclude
that thirteen green checks cannot stand in for a person clicking, and every
defect either sprint found was found that way.
