# Test cases — Sprint 20: the voucher, the discount, and the bank

Traces to [`SPRINT-20-SPEC.md`](../SPRINT-20-SPEC.md) items 1–11, and to
STATE.md §5bj.

Migration `0037` — **APPLIED and verified** before this run. 37 bookkeeping rows
→ **38**. Catalogue asserted 18 of 18 against `information_schema` / `pg_catalog`,
then every constraint made to **fire** inside a transaction that was rolled
back, each expected refusal in its own `SAVEPOINT`: **39 of 39 passed, nothing
left behind.**

Driven against the **real live database** at `9b0d5462ea70`, through `next dev`
from the worktree, in Chrome via Playwright. Tenant: **Lahore Grammar School** —
two campuses (Defence, Karachi), six students, one concession scheme.

## Status — 2026-08-30

**Four defects found and fixed. One design inconsistency found and reported,
not fixed.**

| Mark | Meaning |
| --- | --- |
| ✅ | executed and passing |
| 🐛 | defect found, fixed, re-verified |
| ⚠️ | executed, passing, with a caveat |
| ⬜ | not executed, and why |

**Everything written to LGS during this run was removed and the removal was
read back.** Three bank accounts, three concession schemes, one grant, three
school fields and one scheme reclassification — all reverted by
`scripts/qa-sprint20-cleanup.ts`, which puts the repriced voucher back through
the fee module's **own** `repriceOpenChallans` rather than writing figures at
the columns. Final read-back: `bank_accounts` 0 rows; one scheme, type `other`;
Student 11 on her two original grants; voucher `LGS-2026-08-0008` back to
concession `0.00` / total `15000.00`, byte-identical to the pre-run snapshot;
`schools.ntn` / `.website` / `.finance_email` all null.

**A note on how this was driven.** The Browser pane could not composite in this
session, so React's streamed content never resolved in it and every page read as
its loading skeleton. That is a harness limitation and **not** a product
defect — the same URLs render completely in Playwright, which drives its own
Chrome. Anyone reproducing this run should use Playwright, not the pane.

---

## ✅ Item 1 — the Phone column no longer prints a student's sentinel

`/dashboard/users`, thirteen rows read out of the DOM. **No `student:` anywhere
on the page.**

Students 2, 3, 5 and 11 — the four children of one family — all show
`(0300) 123-4156`, their shared father's number, resolved through the primary
guardian. Student 1 shows `(0321) 312-4545` and Student 18 `(0321) 212-1212`,
each their own guardian's. Before this sprint every one of those cells read
`student:LGS-2026-00NN`.

`listSchoolUsers` is the statement that worried the developer most — an ordered
aggregate over the guardian's phone on a query that also joins
`school_users.phone`, which is the exact shape that shipped §5bg's 42702. It
**executes** against the live schema; `npm run check-sprint20` asserts it on
every run.

⚠️ **The free-text search and the Phone sort still read `school_users.phone`**,
so a student sorts by the sentinel while displaying a guardian's number.
Reported by the developer, unchanged here, recorded in STATE.md §5bj.

## ✅ Item 2 — the two campus charts

`/dashboard` as the owner, no campus selected, so the group view renders.

**2a — a zero is a dash.** Karachi Branch has no billing and no ledger
activity. Both charts print `—` against it, twice each, where the screenshot
that opened this sprint showed `PKR 0` stacked on `PKR 0`. The axis ticks keep
`PKR 0`, which is right: an axis is a scale.

**2b — nothing overflows.** Every `<text>` in every chart on the page was
measured with `getBBox()` against its own viewBox width. **Zero overflowing
labels**, including `PKR 200,000` — half again as long as the `PKR 20,000` that
was being clipped to `PKR 20,00` in the original report.

**2d — one period, both charts.** Both selectors are labelled *Period* and
offer *This month* / *This academic year*. `?period=month` moves **both** to
`month` and both card descriptions follow: *"Billed against collected, this
month"* and *"From the ledger, this month"*.

⚠️ **The figures do not change between the two periods at LGS, and that is the
data rather than the filter.** Every one of the school's nine vouchers was
issued in August 2026 — confirmed by reading `fee_challans.issue_date` directly
— so the month and the academic year contain the same rows. The billed total
(`PKR 200,000`) and collected (`PKR 95,000`) both reconcile exactly against
those rows with cancelled vouchers excluded. A tenant with vouchers in two
months would be a better test and does not exist.

## 🐛 Item 3a — Print, on vouchers that are not payment instruments

**Detail page, cancelled voucher** (`LGS-2026-08-0010`): no Print button. ✅

**Detail page, open voucher** (`LGS-2026-08-0011`): *Print voucher*, *Record
payment*, *Send reminder*, *Waive*, *Cancel voucher*. ✅

**The voucher list**: every Paid and Cancelled row's checkbox is `disabled`;
every Unpaid row's is selectable. ✅

**The bulk print route** refuses closed vouchers reached by hand-built URL and
says how many it dropped and why. ✅

**🐛 Defect — `FeeClearancePanel` still offered Print on a paid admission
voucher.** Item 3a reached `ChallanActions`, the list and the bulk route, but
not the panel that *raises* the voucher in the first place. Student 11's
admission fee is paid — `LGS-2026-08-0006`, PKR 35,000 — and the profile offered
*Print voucher* beside it. Handing a parent a slip that says *pay this* for
money the school has already taken is how a fee gets paid twice, and the second
payment lands as an unexplained credit nobody reconciles.

Fixed — **and the first fix was wrong, which the browser also caught.** Removing
Print from the `settled` case took it away from a voucher that is still a live
demand. `resolveAdmissionFee` returns `settled` by **two** routes: a paid or
waived voucher, *and* an enrolment **cleared by hand** at a desk, which is what
a school does when it takes cash. In that second case the voucher behind it can
still be `unpaid`. Student 18 is exactly that — the panel reads *Paid* while
`LGS-2026-08-0011` is unpaid for PKR 50,000 and the family appears on the
aged-debt screen owing it.

So the test is the **voucher's** status, not the panel's case: `openVoucher` is
the same `unpaid | partial` test `ChallanActions`, the voucher list and the bulk
print route apply, so all four screens now agree about what is printable. Both
ends re-verified:

| Student | Voucher | Print |
| --- | --- | --- |
| Student 11 | `LGS-2026-08-0006` **paid** | absent ✅ |
| Student 18 | `LGS-2026-08-0011` **unpaid**, enrolment hand-cleared | present ✅ |

⚠ **A pre-existing contradiction surfaced while doing this and is not Sprint
20's**: Student 18's profile says *"Paid, so this enrollment is confirmed"* while
the same school's aged-debt screen lists them owing 50,000. `feeStatus` on the
enrolment and the voucher's own status are two different facts and the panel
reports only the first. Left alone; worth a look in the next fee sprint.

**And the sentence under it.** *"Print a copy only if the family asked for one"*
survived the button it referred to. An instruction pointing at a control that is
not on screen sends the reader hunting for it. The print half is now conditional
on the button, assembled as one text node so the two halves cannot produce a
hydration mismatch.

## ✅ Item 3b — "challan" is gone from what a person reads

The voucher detail page, the voucher list, the aged-debt screen, the concessions
screen, fee settings, the student profile and the bank screen were each read in
full: **zero occurrences of "challan"** in any rendered text. Page titles are
*Vouchers* and *Voucher*; the nav reads *Vouchers* and *Family Vouchers*; the
buttons are *Print voucher* and *Cancel voucher*; the back link is *← All
vouchers*; the print table is captioned *Voucher lines*.

Routes, tables, columns, file names, type names and response keys are unchanged
— `fee_challans`, `/dashboard/fees/challans`, `challanId` all still spelled that
way, which is the contract the spec protects.

## 🐛 Item 4 — the aged debt screen

**4a — the guardian's number.** Now `(0321) ***-4545` and `(0300) ***-4156`:
masked, the right digit count, still recognisably a Pakistani mobile. The
original report showed `(0321) 454-5` — a shorter number that does not exist.

Root cause, confirmed before any fix: `lib/defaulters.ts` masked to
`+92321****4545`, and `AgedDebtTable` then put that through
`formatPhoneForDisplay`, which strips every non-digit — asterisks included — and
re-grouped the nine survivors under the mobile mask. Both halves are closed:
`formatPhoneForDisplay` returns anything containing a `*` untouched, exactly as
it already did for a letter, and `maskDisplayPhone` masks **after** formatting.
`reachable` is still computed from the unmasked value.

**4b — the sort carets.** All nine headers now render `flex-direction: row` with
the caret after the label; the three numeric columns get their right edge from
`justify-content: flex-end` instead of `row-reverse`. Read across the header row
they are one table again.

**4d — the title.** `<h1>` at `24px`/`600`, matching `/dashboard/users` and the
voucher list. The screen had been rendering its own `<h2>` at `text-xl` instead
of `PageHeader`.

## ✅ Item 5 — schemes have a type

`/dashboard/fees/concessions` → Schemes. **TYPE** column present, facet filter
offers *Every kind* / *Sibling Discount* / *Scholarship Discount* / *Other
Discount*.

**The backfill inferred nothing from a name**, which is the decision worth
checking and it held: LGS's one scheme is literally called *"Siblings Discount"*
and came out **Other Discount**, because `0037` defaulted every existing row to
`other`. A scheme wrongly marked `sibling` is one the last-child sweep would one
day close.

Create and edit both carry *Kind of discount* above the name, sharing
`readSchemeInput`, so the two cannot disagree. Three schemes were created
through the API — one of each type, all `201` — and all three removed.

## ✅ Item 6 — two settings on `late_fee_rules`

`/dashboard/fees/settings` gains a **Sibling discount** section between Billing
and Late fees, with both toggles **off**, which is what `0037` defaulted them to
and what a school must opt into. Wording is the spec's, and the section carries
the consequence in prose: *"When a family is down to one child at this school,
that child's sibling discount is closed automatically and a note is written on
the grant saying why. Vouchers already raised are not changed."*

`0 schools` have either flag on — confirmed against the live table.

## 🐛 Item 7 — the Apply-discount panel

**7a — placement.** On the student profile the *Discounts* card sits immediately
**above** *Admission fee*, which is the voucher-generation section. In the
wizard the strip reads *1. Student information · 2. Guardian information ·
3. Academic placement · 4. Documents · **5. Discounts** · 6. Review and
confirm*. ✅

**7b — the three states.**

* *qualifies, nothing applied* — Student 11: *"Student 11 has 3 siblings at this
  school — Student 2, Student 3, Student 5. They qualify for the sibling
  discount."* ✅
* *applied* — chips reading `Second Discount · 20%` and `Siblings Discount ·
  10%`, each with a `×`. The rates are the **grants'** frozen values and not the
  scheme's 20%, which is the freezing rule visible on screen. ✅
* *nothing applies* — see the defect below. 🐛

**🐛 Defect — the panel told a school with a live scheme that it had none.**
`sections` drops the sibling section for a child who does not qualify, and at a
school whose only scheme is a sibling one that leaves it empty while
`state.schemes` holds an active row. Student 2 — the **eldest** of the
four-child family, so correctly not entitled — produced *"This school has no
active discount schemes yet. They are defined under Fees → Concessions."* An
administrator who believes that goes and creates a **second** sibling scheme,
which is the duplication `concession_schemes_location_name_idx` exists to
prevent.

Fixed: the school having no schemes and this child being offered none are now
two different sentences, in all three places that made the claim. Re-verified —
Student 2 now reads *"Student 2 is billed at the full rate. The only schemes
this school has are sibling discounts, and they are granted from the second
child onwards."*, and the disabled Apply button's tooltip says *"No discount
scheme can be applied to this student."*

**7c — the modal.**

* **A non-sibling never sees the sibling section.** Student 18, an only child:
  the modal offered *Scholarship Discount* and *Other Discount* only. The
  sibling section is **absent, not disabled**. ✅
* **One of each type.** Student 11 with two sibling schemes available: both sit
  in a single radio group named `discount-sibling`, so selecting the second
  cleared the first and the footer stayed at *Apply 1 discount*. Enforced
  structurally rather than by a counter. ✅
* Each option states its heads, and an unqualified scheme reads *applies to
  every fee head*. ✅

**7d — applying and removing.**

Applying *QA Scholarship (temp)* 15% to Student 11 returned
`{granted: 1, skipped: 0, repricedVouchers: 1}` and, read from the database:

| Voucher | Status | Before | After |
| --- | --- | --- | --- |
| `LGS-2026-08-0006` | paid | 50,000 − 15,000 = 35,000 | **unchanged** ✅ |
| `LGS-2026-08-0008` | unpaid | 20,000 − 0 − 5,000 credit = 15,000 | 20,000 − **3,000** − 5,000 = **12,000** ✅ |

The open voucher repriced by exactly 15% of its 20,000 subtotal; the paid one
was not touched, which is the rule. The grant froze `15.00` and carries
`scheme_id` as provenance.

Removing it through the chip's `×` wrote `valid_until = 2026-08-29` and the note
*"Removed on 2026-08-30 from the student's discount panel."* — **a dated close,
never a `DELETE`**, exactly as the spec and the ledger rule require. ✅

## ⚠️ Removal does not un-price an already-issued voucher — reported, not fixed

The removal above reported **`0 open vouchers repriced`** and voucher
`LGS-2026-08-0008` kept its 3,000 concession, seconds after applying the same
discount had put it there.

The mechanism is not a bug in itself. `closingDate` closes a grant **yesterday**,
and an August voucher is still inside a window that ran to 29 August, so the
concession legitimately still applies to that voucher's period. The panel says
so honestly: *"Vouchers already issued keep the discount they were raised with."*

**The problem is the asymmetry.** Applying reprices an already-issued open
voucher; removing does not. So a discount applied to the wrong child cannot be
taken off this month's bill from the panel that applied it, and the only
recourse is to cancel the voucher and raise it again — or to edit the grant's
dates on the Concessions screen, which is a different screen and is not what the
`×` promises.

Not fixed here, deliberately: every candidate fix — closing at `today`, or
making the reprice ignore the window for open vouchers — **changes what a parent
owes on a voucher the school has already issued**, and that is a product
decision about money rather than a QA correction. Recorded in STATE.md §5bj as
the first thing to settle in the next fee sprint.

*(The cleanup script demonstrates the other half: deleting the grant outright
and re-running `repriceOpenChallans` restored the voucher to `0.00` / `15,000`,
so the repricing path itself works in both directions.)*

## 🐛 Item 10 — bank accounts

`/dashboard/settings/banks`. Empty state, create, edit, active toggle, delete,
purpose facet, campus scoping — all present. Every field the spec listed exists,
including the international block (SWIFT/BIC, intermediary bank, intermediary
SWIFT, bank address). **Purpose is a three-way radio**, so the "neither ticked"
state a pair of checkboxes would allow cannot occur.

Three accounts were created and all three removed:

| Bank | Purpose | Campus |
| --- | --- | --- |
| Dubai Islamic Bank | Students | All campuses |
| Meezan Bank | Staff | All campuses |
| Habib Bank Limited | Both | Karachi Branch |

**🐛 Defect — a staff account was badged *Printing*.** The status column read
`isActive ? 'Printing' : 'Not printing'` and ignored `purpose`, so the payroll
account claimed it appears on fee vouchers — on a screen whose own field hint
says *"Never printed on a voucher"*. `listVoucherBankAccounts` filters
`purpose IN ('student','both')`, so it never has and never will. A bursar
reading that has been told the school's salary account number goes out to every
parent, and the reasonable response — switching it off — stops nothing and
quietly removes it from payroll.

Fixed: the label now says what the switch governs for that row. Re-verified —
header **STATUS**, Meezan reads *Active*, the two student-facing accounts read
*Printing*.

## ✅ Item 11 — the voucher, repainted

Measured rather than eyeballed. The print root was revealed at exactly the
printable area of A4 landscape with 8 mm margins — **1062 × 733 CSS px** — and
the rendered document measured:

* **two copies**, 531 px each, exactly half the sheet apiece ✅
* document height **440 px** with no bank block, **490 px** with one bank
  account, the notes block and the footer — against 733 px available, so roughly
  **240 px of headroom** for more fee heads and discounts ✅

Content, read off the printed copy:

```
LAHORE GRAMMAR SCHOOL / DEFENCE BRANCH / FEE VOUCHER / STUDENT COPY
2026-2027 · NTN # A934101 · Voucher # LGS-2026-08-0011
ID / Name / Class / Roll no. / Email / Parent email
ISSUE DATE · DUE DATE · VALID UPTO · VERSION
Particulars | Payable Amount (PKR)
  Admission Fee                          50,000
  Gross amount                           50,000
  TOTAL AMOUNT PAYABLE WITHIN DUE DATE   50,000
  TOTAL AMOUNT PAYABLE AFTER DUE DATE    55,000
Amount in words: Fifty Thousand Rupees Only
HOW TO PAY — cash/pay order, then the bank block
NOTES — proof of payment to finance@…, quoting voucher and student ID
address · Tel · email · website · Authorised signature
```

**The after-due-date figure is priced from the school's own rule**: LGS charges
a fixed 5,000, and 50,000 + 5,000 = 55,000. Its **omission** when no rule is
configured is verified by reading `buildVoucherPrintData` — `null` when the rule
is absent, disabled, or prices to zero, and the component renders no row for
null. Not exercised against a school with late fees off, because LGS has them
on and turning them off would rewrite a live policy.

**Two scoping rules proved by absence**, which is the part worth having:

* the **Karachi-only** account did **not** print on a **Defence** student's
  voucher — `sharedOrOwnedBy` working;
* the **staff** account did **not** print at all — the purpose filter working.

Only the *All campuses / Students* account appeared. Both are the kind of rule
that fails silently in the wrong direction, and neither did.

## ✅ D4 — three school fields

`NTN`, `Website` and `Finance email` are on the School Profile form, saved, and
reached the voucher: `NTN # A934101` in the header, `www.lgs.edu.pk` in the
footer, and the notes block appeared **only once a finance email existed**,
quoting both the voucher number and the student ID. All three cleared afterwards.

---

## ⬜ Not executed, and why

* **Item 8 — siblings across campuses.** LGS has two campuses and **all six
  students sit on Defence**, so no query in this run returned two children at
  two campuses. What is proved: `lib/siblings.ts` carries no branch predicate,
  `check-branch-scope` asserts that in 1,379 assertions, and the sibling API
  returns `branchName` per family member ready to render. The rule is asserted,
  not observed. **This is the fixture this project has now asked for in four
  consecutive sprints** — see §5bi on Rehearsal Academy.
* **Item 9b — the last-sibling sweep has never run against a real family.** The
  scheduler starts (`[sibling-discount] sweep started (every 15 minutes)` in the
  dev log) and its claim is a conditional `UPDATE … RETURNING` per CLAUDE.md.
  Exercising the removal would mean withdrawing three of four real children at
  LGS and undoing it, which is more damage than the finding is worth.
* **A full enrolment through the wizard.** The Discounts step renders in place;
  completing the wizard would create a real student in the production database.
  The panel behind that step is the same component, driven through both of its
  states on the profile.
* **The voucher on paper.** Measured in CSS pixels at the exact printable area,
  not sent to a printer. A browser print preview was not available in this
  session.
* **`check-smtp` and `check-provisioning`** — untouched by this sprint.

## Gates — all sixteen green

`typecheck`, `lint`, `check-loaders` (279), `check-forms` (60),
`check-address-phone` (50), `check-cnic` (36), `check-currency` (7),
`check-sprint-periods` (107), `check-accounting` (121), `check-theme` (7
palettes), `check-branch-scope` (1,379), `check-sprint20` (**11 ok, 0 failed**,
`0037 IS APPLIED`), the three database-backed ones — `check-reports`,
`check-dashboard`, `check-portals` — and **`npm run build`**.

The `.claude/worktrees/node_modules` stub was deleted after the build, per §5f.
