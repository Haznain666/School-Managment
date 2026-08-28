# Test cases — Sprint 18: vouchers, concessions, student CRUD and the enrolment lock

Traces to [`SPRINT-18-SPEC.md`](../SPRINT-18-SPEC.md), eighteen items, and to
STATE.md §5bf.

Migration `0034` — **APPLIED and verified** against the live database before this
run. Nothing here re-applied it and nothing here rolled it back. The branch under
test is `claude/sprint-dev-devops-qa-05b2ed`, driven at `ef09f2a` and re-verified
after each fix.

## Status — 2026-08-28

**Six defects were found and five are fixed** — F1 to F6 below. One of them,
**F1, made an entire screen a 500 at every school** and had shipped: no gate
executes a query, and §5bf records that none of this phase had been driven in a
browser. F6 is reported rather than built, because it is a decision about money
rather than a repair.

| Mark | Meaning |
| --- | --- |
| ✅ | executed and passing |
| 🐛 | **was a defect QA found, now fixed and re-verified** |
| ⚠️ | executed, passed, with a caveat recorded |
| ⬜ | not executed, and why |

**Gates.** All nine run green on the final tree, in this worktree:

```
typecheck  lint  check-currency  check-loaders  check-forms
check-address-phone  check-cnic  check-sprint-periods  check-accounting  build
```

`npm run build` was run twice — once to verify F1 and F2, once to verify F3 to
F5 — each time after deleting `../node_modules` and followed by
`cp -r .next/static .next/standalone/.next/static` (522 files). §5f and §5be.

**How this was driven.** The standalone artifact, started with `preview_start`,
against LGS's **real** live database. Super Admin sign-in, then *Login as Admin*
into Lahore Grammar School. **No school member's password was handled**: a
local-only bcrypt hash was minted into `.env.standalone.local`, which is
gitignored and ships nowhere, and the plaintext was chosen for this run.

**SMTP was deliberately blanked in that env file**, and this is the safety note
worth keeping. `instrumentation.ts` starts the outbox drainer in-process, and the
QA process points at the *same* Supabase database as the live deployment — so a
voucher generated here would have queued a real email to a real LGS parent, which
the live drainer would then have sent. With `SMTP_HOST` empty, `drainOutbox`
claims nothing. `email_outbox` was read at the end of the run: **17 rows, all
`sent`, none queued** — no parent was emailed by this run.

---

## ⚠️ The environment note that will otherwise cost the next session

**Streamed Suspense boundaries never reveal while the Browser pane is not
displayed, and this is not a build problem.** React 19 defers a boundary reveal
to `requestAnimationFrame` — the page carries
`requestAnimationFrame(function(){$RT=performance.now()})` and a `$RB`/`$RV`
queue. A pane that is not displayed composites no frames, so rAF never fires, the
reveal never runs, and every data screen sits on its skeleton for ever with the
finished content parked in a `div[hidden]` beside it.

This looks exactly like §5be's symptom and has a different cause. The static
assets were correctly copied (522 files, every chunk 200, `window.next` and
`webpackChunk_N_E` both present, React fibers attached). The fix that made this
whole run possible:

```js
window.requestAnimationFrame = (f) => setTimeout(() => f(performance.now()), 0);
setInterval(() => {
  if (window.$RB && window.$RB.length) {
    const q = window.$RB.slice(); window.$RB.length = 0; window.$RV(q);
  }
}, 50);
```

Armed immediately after each navigation, every screen renders and hydrates and
client fetches fire. Two further notes for whoever comes next: `form_input` and
coordinate clicks are unreliable without compositing — set values through the
native `HTMLInputElement.prototype.value` setter plus an `input` event, and call
`element.click()` — and `window.confirm` returns false under automation, so any
control behind one must have it stubbed.

---

## The six defects QA found

**F1 — the all-students screen was a 500, at every school.** 🐛
`listStudents` reads the primary guardian's number through a joined subquery
whose ordered aggregate is aliased `phone`. Drizzle emits a raw-`sql` subquery
column by its bare alias, and the same statement joins `school_users`, which has
a `phone` of its own:

```
column reference "phone" is ambiguous          (42702)
```

`GET /api/school/students` returned 500 on every request. Items 3 and 4 — the
Guardian phone column, the Fees chip and the fee-status filter — could not render
a single row, and neither could the screen they live on. Fixed by aliasing
`guardian_phone` and referencing it qualified in the SELECT *and* in both search
patterns; unqualified in the WHERE it would have silently bound to
`school_users.phone`, the `student:` sentinel that item 3 exists to stop
matching. Re-verified: 200, twelve students, real numbers.

**F2 — the register's Kind column called every admission voucher a One-off.** 🐛
Item 11 gave the register a Kind filter written on `challan_kind` and left the
Kind *cell* deriving its label from `billing_month` alone. An admission voucher
carries a null `billing_month` by design. Filtering LGS by *Admission* returned
four rows and **all four disagreed with the filter that had just found them** —
the exact failure §5bf warns about in the other direction. `listChallans` never
selected `challan_kind`. It does now. Re-verified in the browser: four rows read
*Admission*, the two monthly ones still read their month.

**F3 — a scheme's Students count was always nought.** 🐛 The correlated count
subquery interpolated its two columns, and Drizzle emitted them unqualified:

```sql
select count(*) from "student_concessions" where "scheme_id" = "id"
```

Inside the subquery only `student_concessions` is in scope and it has an `id` of
its own, so that compares every row's `scheme_id` to its own primary key. Never
true, never an error. Proven against the live database: raw SQL counted **1**
while the API returned **0**. The stored `scheme_id` was always correct, so the
skip-those-who-already-hold-it rule — which uses real operators — was never
affected; only the one number that tells a clerk whether applying a scheme
worked. Both sides are written out qualified now.

**F4 — a concession scoped to one head was described as applying to every
head.** 🐛 `describeDiscount` read only the legacy single-head column, which a
Sprint 18 multi-select grant leaves null. A concession ticked for **Tuition Fee
alone** was written up on the Granted panel as *"5% off every fee head"*.
Confirmed against the database: `student_concession_fee_types` held exactly one
row, Tuition Fee, while the screen said every head. The calculator priced it
correctly throughout, which is the bad half — the number was right and the
sentence above it was wider than what the school had granted, with nothing
anywhere to disagree. `listConcessions` now returns the head set by name.

**F5 — item 9 missed the most-read string in the product.** 🐛
`SchoolNavbar`'s global search placeholder read *"Search students, staff,
challans…"* on every page of every school portal. Also missed: the fee-head
category hint, the sort-order hint, that page's description, and five error
messages the spec names explicitly. All fixed. `lib/accounting.ts`'s "raised on a
challan" was **left alone deliberately** — it is a ledger account description
seeded into `chart_of_accounts` at provisioning, so editing the constant renames
the account only for schools created afterwards and drifts from every school
already carrying the old wording. That is a data migration, not a copy fix.

**F6 — removing a concession does not claw back the credit it granted.**
⚠️ **Reported, not fixed.** A fixed discount larger than the balance banks the
overflow as `student_credits` (`reason = 'discount_overflow'`). Removing that
concession re-prices the voucher correctly — it went back to exactly its opening
figures — but the banked credit **stays**. The student keeps money the school
never granted, and it will be spent on their next voucher.

This is the mirror of the limitation §5be already records ("cancelling a challan
does not return the credit it consumed"). It is not a typo-sized repair: making
repricing reduce credit as well as grant it is a decision about real money and
about what happens when the credit has already been partly spent. It belongs to
whoever owns the fee module, not to a QA pass.

---

## 1 — A matched sibling's identity fields are read-only

| # | Case | Expect | Mark |
| --- | --- | --- | --- |
| 1.1 | Enrol a student; enter a CNIC that matches an existing guardian | Name, email and phone render `disabled` with a hint pointing at the guardian panel | ⬜ |
| 1.2 | Same card, relationship / occupation / primary contact | Stay editable — facts about *this* child | ⬜ |
| 1.3 | Change the CNIC to one that matches nothing | Those three unlock again, empty | ⬜ |
| 1.4 | A card arriving from a converted application, carrying details | Never locked (§5bf, point 2) | ⬜ |

**Not executed.** The enrolment wizard was not driven in this run — see *What was
not tested* below.

---

## 2 — Everything except the CNIC starts locked

| # | Case | Expect | Mark |
| --- | --- | --- | --- |
| 2.1 | A fresh guardian card | Only `CnicField` is enabled | ⬜ |
| 2.2 | Press **"No CNIC to hand — enter by hand"** with the field blank | Every field unlocks, empty | ⬜ |
| 2.3 | The escape hatch while a CNIC is present | Not offered | ⬜ |
| 2.4 | A complete CNIC, lookup returns **no match** | Every field unlocks, empty | ⬜ |
| 2.5 | A complete CNIC, lookup returns **a match** | Card fills; per item 1 only relationship, occupation, primary contact active | ⬜ |
| 2.6 | Lookup fails on the network | Card unlocks — a blip must not become an enrolment nobody can finish | ⬜ |
| 2.7 | Edit the CNIC after unlocking | Never re-locks (§5bf, point 3) | ⬜ |
| 2.8 | `parseGuardians` on the server | Unchanged; the lock is a client courtesy only | ⬜ |

**Not executed.** As above.

---

## 3 — Guardian phone shows a phone, not a student id

| # | Case | Expect | Mark |
| --- | --- | --- | --- |
| 3.1 | `GET /api/school/students` at LGS | **200** — was a 500 before F1 | 🐛 |
| 3.2 | The Guardian phone column across all twelve LGS students | Real numbers; **no** `student:GVS-…` / `student:LGS-…` sentinel anywhere | ✅ |
| 3.3 | Student 11's row | `+923001234156` stored, rendered `(0300) 123-4156` | ✅ |
| 3.4 | A student with no guardian recorded (the six `QA14…` rows) | Em dash, not a sentinel and not a crash | ✅ |
| 3.5 | Free-text search on a guardian number | Searches the guardian column, with the trunk-form second pattern | ⬜ |

Observed rows 3.2/3.3, verbatim:

```
LGS-2026-0009 | Student 11 | Pre-Nursery | B | (0300) 123-4156 | Admission unpaid
LGS-2026-0008 | QA17 Photo Persistence | Class 2 | … | (0321) 555-0101 | Cleared
QA14-101      | QA14 Ali Raza | Pre-Nursery | A | —              | Cleared
```

3.5 not executed: the fix to the two search patterns is in the same commit as
F1 and typechecks, but no search term was driven through the UI.

---

## 4 — The fee status chip on the student listing

| # | Case | Expect | Mark |
| --- | --- | --- | --- |
| 4.1 | A **Fees** column exists on the listing | Header reads `Fees`, between Guardian phone and Enrolled | ✅ |
| 4.2 | Student 11 and Student 5, who hold open admission vouchers | `Admission unpaid` | ✅ |
| 4.3 | Every other LGS student | `Cleared` | ✅ |
| 4.4 | Filter by `admission_unpaid` | Returns exactly Student 11 and Student 5 — the two whose chip says so | ✅ |
| 4.5 | Filter by `cleared` | Returns the ten whose chip says Cleared; excludes the two above | ✅ |
| 4.6 | Filter by `overdue` and by `due` | Empty at LGS, and correctly so — every open voucher falls due 10-Sep-2026 | ✅ |
| 4.7 | The filter never contradicts the chip | Held for all four states | ✅ |
| 4.8 | The column is not sortable | Correct — a documented deviation, §5bf | ✅ |
| 4.9 | `Overdue` decided by `current_date` in the database | Not re-executed; no LGS voucher is past due to prove it with | ⬜ |

---

## 5 — Student CRUD as four assignable permissions

| # | Case | Expect | Mark |
| --- | --- | --- | --- |
| 5.1 | `PERMISSION_GROUPS` carries a **Student records** group | Four keys: read, create, update, delete | ✅ |
| 5.2 | **Delete student** renders on the profile for a `school_admin` | Present | ✅ |
| 5.3 | The confirm modal | Requires the admission number typed; confirm **disabled** until it matches | ✅ |
| 5.4 | The modal's copy | Names the child, lists what goes, offers *withdraw instead*, and warns that a student with payments cannot be deleted at all | ✅ |
| 5.5 | **DELETE refuses a student with payments** | 409, with the count in the sentence | ✅ |
| 5.6 | The student survives that refusal | Student 5 still present; twelve students before and after | ✅ |
| 5.7 | Grant and revoke `students.delete` on the permissions screen and watch the control appear and disappear | — | ⬜ |
| 5.8 | DELETE succeeding on a student with no payments | — | ⬜ |
| 5.9 | The delete removes the `school_users` row as well | — | ⬜ |
| 5.10 | A branch-scoped actor deleting outside their branch | 404 | ⬜ |

5.5 observed verbatim, driven through the modal:

> Student 5 has 1 payment recorded against their vouchers, and money the school
> has received cannot be erased. Withdraw the student instead — the record stays,
> and so does the fee history.

5.7 to 5.10 **not executed, deliberately.** 5.8 and 5.9 destroy a real child's
record at a real school and there is no student at LGS that is safe to spend; the
refusal path is the one that protects data and it is the one that was driven.
5.7 needs a second role's session. The route's guard was read and is correct —
`countPaymentsForStudent` joins `fee_payments` through `fee_challans` and runs
*before* the `batch()`, and the handler is behind `permission: 'students.delete'`.

---

## 6 — The voucher email, aged-debt actions and reminder chips

| # | Case | Expect | Mark |
| --- | --- | --- | --- |
| 6.1 | Generating a voucher queues one email per voucher through `enqueueEmail` | — | ⬜ |
| 6.2 | Send a reminder; a `Reminder 1 · <date>` chip appears on the row | — | ⬜ |
| 6.3 | Two clicks cannot produce two "Reminder 2"s | — | ⬜ |
| 6.4 | **Mark as paid** posts to the ledger in the same transaction | — | ⬜ |
| 6.5 | The defaulters screen sorts and filters on `DataTable` | — | ⬜ |

**Not executed, and the reason is the safety rule at the top of this file.**
Every one of these writes to a real parent's row: 6.1 and 6.2 queue email to real
LGS guardian addresses, which the *live* deployment's drainer would then send,
and 6.4 posts an irreversible entry to an append-only ledger against a real
student. Testing them needs either a disposable tenant or a database the live
process is not also draining. That is a fixture problem, not a five-minute one,
and it is the largest hole in this pass.

---

## 7 — Currency everywhere, with thousands separators

| # | Case | Expect | Mark |
| --- | --- | --- | --- |
| 7.1 | `npm run check-currency` exists and passes | Green | ✅ |
| 7.2 | The vouchers register's amounts | `35,000` / `50,000` / `20,000` — separated, no stray decimals | ✅ |
| 7.3 | A fixed scheme's description | `PKR 35,000 off every fee head` | ✅ |
| 7.4 | The concession detail line on a voucher item | `QA18 Fixed Overflow PKR 35,000` | ✅ |
| 7.5 | Every print view | — | ⬜ |

---

## 8 — Print Voucher before Confirm the fee was paid

| # | Case | Expect | Mark |
| --- | --- | --- | --- |
| 8.1 | Student 5's profile, fee clearance panel in a billed state | **Print voucher** renders **before** *Confirm the fee was paid* | ✅ |
| 8.2 | The line saying the voucher was emailed automatically | — | ⬜ |
| 8.3 | The Print voucher link targets the single-voucher print route for that challan | — | ⬜ |

8.1 observed as the button order on the profile:
`… Change photo, Show, Print voucher, Confirm the fee was paid, Add guardian …`

---

## 9 — "Challan" becomes "Voucher"

| # | Case | Expect | Mark |
| --- | --- | --- | --- |
| 9.1 | The register's page title and `metadata.title` | `Vouchers` | ✅ |
| 9.2 | Its column header | `Voucher #` | ✅ |
| 9.3 | Its search placeholder | `Voucher number, student name or student ID` | ✅ |
| 9.4 | The nav path `/dashboard/fees/challans` is unchanged | Label *Vouchers*, route intact | ✅ |
| 9.5 | **The global search placeholder on every school page** | Was `…staff, challans…` | 🐛 |
| 9.6 | Fee-head category hint, sort-order hint, fee-types page description | Were all "challan" | 🐛 |
| 9.7 | Five error messages the spec names | Were all "challans" | 🐛 |
| 9.8 | Table names, routes, permission keys, identifiers | Not renamed — correct | ✅ |
| 9.9 | Email subjects and bodies | — | ⬜ |
| 9.10 | `lib/accounting.ts`'s account description | Left as "challan" **deliberately** — see F5 | ⚠️ |

---

## 10 — The voucher print format

| # | Case | Expect | Mark |
| --- | --- | --- | --- |
| 10.1 | Print preview is landscape A4 with three copies side by side and cut lines | — | ⬜ |
| 10.2 | `<PrintSheet>` emits `@page { size: A4 landscape }` | — | ⬜ |
| 10.3 | The Details line under each item — category, period, concession | — | ⬜ |
| 10.4 | Bulk printing still gives one voucher per landscape sheet | — | ⬜ |

**Not executed.** Print layout is the one thing that cannot be judged from the
DOM — it needs a rendered print preview, and the pane's compositing problem
above is exactly what makes that impossible in this environment. The `Details`
line's *content* is verified indirectly by 14.2. This item needs a human with a
print dialog, and should not be signed off without one.

---

## 11 — The register shows admission vouchers

| # | Case | Expect | Mark |
| --- | --- | --- | --- |
| 11.1 | **Student 11's outstanding admission voucher appears in the register** | `LGS-2026-08-0006`, Unpaid, 35,000 | ✅ |
| 11.2 | Billing month defaults to **All months** | Selected value empty | ✅ |
| 11.3 | Billing year defaults to empty | Input empty | ✅ |
| 11.4 | A **Kind** filter offers Monthly / One-off / Admission | Present | ✅ |
| 11.5 | `kind=admission` | The four `challan_kind = 'admission'` vouchers | ✅ |
| 11.6 | `kind=one_off` | Empty — LGS has no true one-off, which is correct | ✅ |
| 11.7 | `kind=monthly` | The two with a billing month | ✅ |
| 11.8 | **The Kind column agrees with the Kind filter** | Was "One-off" on all four admissions | 🐛 |
| 11.9 | A **Family vouchers** segmented tab exists | Present beside *Student vouchers* | ✅ |

11.1 is the reported defect and it is confirmed fixed — the row is visible with
both filters at their new empty defaults. 11.8 was found underneath it.

---

## 12 — Concession schemes

| # | Case | Expect | Mark |
| --- | --- | --- | --- |
| 12.1 | `/dashboard/fees/concessions` has **Schemes** and **Granted** tabs | Present | ✅ |
| 12.2 | Create a scheme with **no** fee head ticked | Saved with `feeTypeIds: []` | ✅ |
| 12.3 | It is described as applying to every head | `10% off every fee head` | ✅ |
| 12.4 | Apply it to a student through the picker | Search by name finds Student 11; *Grant to 1 student* | ✅ |
| 12.5 | **An empty head set discounts every head, including an admission head** | Concession 15,000 → **20,000**, total 35,000 → **30,000** | ✅ |
| 12.6 | `repriceOpenChallans` runs on apply | The open voucher re-priced without being regenerated | ✅ |
| 12.7 | A fixed discount larger than the balance banks the overflow | One `student_credits` row, **5,000.00**, `discount_overflow` | ✅ |
| 12.8 | **A second, unrelated concession does not grow that credit** | Still **one** row, still 5,000.00, original timestamp | ✅ |
| 12.9 | Removing the grants re-prices back | 15,000 / 35,000 / unpaid — exactly the opening figures | ✅ |
| 12.10 | The removed grants leave the credit behind | **Defect F6** — reported, not fixed | ⚠️ |
| 12.11 | The scheme's **Students** count | Read 0 while one student held it | 🐛 |
| 12.12 | Applying a scheme twice skips those who hold it | ⬜ — `scheme_id` is stored correctly and the dedupe uses real operators, but a second apply was not driven | ⬜ |
| 12.13 | The ad-hoc per-student form also has the multi-select | Five checkboxes, same as the scheme form | ✅ |
| 12.14 | A grant's described scope matches the heads actually stored | Said "every fee head" for a Tuition-only grant | 🐛 |

12.8 is the regression §5be records being introduced by a fix, and it holds.
The sequence driven: grant a 10% every-head scheme → grant a fixed 35,000
every-head scheme, which overflows and banks 5,000 → grant an unrelated
Tuition-only concession, which re-prices Student 11 again and must not re-bank.
Read straight out of Postgres after the third write:

```
rows=1 total=5000
[{"amount":"5000.00","reason":"discount_overflow","created_at":"2026-08-28T04:07:34.861Z"}]
```

---

## 13 — The fee-head multi-select

| # | Case | Expect | Mark |
| --- | --- | --- | --- |
| 13.1 | The scheme form uses `components/ui/MultiSelect` of fee heads | Tuition, Admission, Annual, Library, Examination | ✅ |
| 13.2 | It offers **Select all** | Present | ✅ |
| 13.3 | Applies-to defaults to "Every fee head" | Nothing ticked on a fresh form | ✅ |
| 13.4 | The hint states the empty-set rule on screen | *"Leave every box unticked for a discount on every fee head, of every category."* | ✅ |
| 13.5 | A ticked subset is stored | One `student_concession_fee_types` row, Tuition Fee | ✅ |

---

## 14 — The voucher names the concession and its rate

| # | Case | Expect | Mark |
| --- | --- | --- | --- |
| 14.1 | `fee_challan_items.concession_detail` is null on a pre-Sprint-18 voucher | Correct — it is persisted at generation, not derived | ✅ |
| 14.2 | After repricing, it names each concession and its rate | See below | ✅ |
| 14.3 | Several are joined with a comma | Four, comma-joined | ✅ |
| 14.4 | A percentage renders as a rate and a fixed amount as currency | `10%` … `PKR 35,000` | ✅ |
| 14.5 | It is null when nothing applied | ⬜ — no voucher at LGS has no concession | ⬜ |
| 14.6 | Shown on the print view and in the voucher email | ⬜ — see items 10 and 6 | ⬜ |

14.2, read off the voucher detail:

```
Siblings Discount 10%, Second Discount 20%, QA18 Every Head 10pc 10%, QA18 Fixed Overflow PKR 35,000
```

Worth recording: repricing **populates** `concession_detail` on a voucher raised
before this sprint. That is the behaviour one wants, and it is why Student 11's
voucher now carries `Siblings Discount 10%, Second Discount 20%` where it
carried null this morning — see *What was left behind*.

---

## 15 — Dates read DD-MMM-YYYY

| # | Case | Expect | Mark |
| --- | --- | --- | --- |
| 15.1 | The student listing's Enrolled column | `22-Aug-2026`, `27-Aug-2026` | ✅ |
| 15.2 | The vouchers register's Due column | `10-Sep-2026`, `10-Aug-2026` | ✅ |
| 15.3 | A scheme's validity range | `01-Aug-2026 — open ended` | ✅ |
| 15.4 | A `YYYY-MM-DD` column is parsed as a calendar date, never through `new Date` | No off-by-one anywhere observed | ✅ |
| 15.5 | **The granted-concessions panel** | Read `From 2026-08-27`, raw ISO | 🐛 |
| 15.6 | The academic-year table's `'August 2025'` is not mangled | ⬜ | ⬜ |
| 15.7 | Date-of-birth inputs carry the hint | ⬜ | ⬜ |

15.5 was fixed in the same commit as F4.

---

## 16 — The relationship, and the phone that came back wrong

| # | Case | Expect | Mark |
| --- | --- | --- | --- |
| 16.1 | A mother enrolling her second child is offered **Mother** | ⬜ — needs the enrolment wizard | ⬜ |
| 16.2 | **A stored `+92…` renders as `(0321) 123-4567`** | `+923001234156` → `(0300) 123-4156` | ✅ |
| 16.3 | **With no validation error** | None on any of the three numbers shown | ✅ |
| 16.4 | Storage is unchanged | Still `+923001234156` in `student_guardians` | ✅ |
| 16.5 | A `student:LGS-…` sentinel is returned untouched, not masked | ⬜ — no sentinel reaches a display after F1's fix | ⬜ |

---

## 17 — Auto-send the monthly voucher

| # | Case | Expect | Mark |
| --- | --- | --- | --- |
| 17.1 | The sweeper starts with the others | `[auto-send] voucher scheduler started (every 60s)` in the boot log | ✅ |
| 17.2 | It is **off by default** | No school was emailed across the whole run; outbox stayed at 17 sent, 0 queued | ✅ |
| 17.3 | The toggle and day selector on `/dashboard/fees/settings` behind `fees.write` | — | ⬜ |
| 17.4 | The claim is a conditional `UPDATE … RETURNING` | — | ⬜ |
| 17.5 | A throw hands the claim back | — | ⬜ |
| 17.6 | It never generates a voucher | — | ⬜ |

17.3 to 17.6 not executed: turning auto-send **on** at a live school with real
parent addresses is precisely the thing the spec says must never happen by
accident, and this run had no tenant it could safely do it in.

---

## 18 — Family vouchers as three steps

| # | Case | Expect | Mark |
| --- | --- | --- | --- |
| 18.1 | A **Family vouchers** tab exists on the register | Present | ✅ |
| 18.2 | The listing puts most-children families first, then largest total | — | ⬜ |
| 18.3 | The Children column is gone from the group table | — | ⬜ |
| 18.4 | Step 1 searches with a **Search button**, not a debounce | — | ⬜ |
| 18.5 | It matches a guardian *or* a child, and returns only guardians with more than one child | — | ⬜ |
| 18.6 | Step 2 lists the months with counts and totals | — | ⬜ |
| 18.7 | Step 3 selects vouchers with a running total | — | ⬜ |
| 18.8 | **A partial payment spreads evenly, not oldest-first** | — | ⬜ |
| 18.9 | **The paise add up exactly**, remainder to the largest balance | — | ⬜ |
| 18.10 | The message says "spread evenly" | — | ⬜ |

**Not executed, and this is the second-largest hole.** LGS has no family with two
enrolled children holding open vouchers in the same month — Student 2, 3, 5 and
11 share a guardian number, but only Student 5 and Student 11 have anything open
and their vouchers are admission vouchers in different months. Building that
fixture means generating vouchers, which emails real parents (see item 6), and
recording a family payment means posting to the append-only ledger. 18.8 and 18.9
are the arithmetic most worth checking in this whole sprint and they remain
unchecked.

---

## What was left behind in LGS

Everything created for this run was removed except one row, which the tooling
refused to let QA delete from a live database — correctly, on reflection.

| Thing | State |
| --- | --- |
| Scheme `QA18 Every Head 10pc` | **Deleted** |
| Scheme `QA18 Fixed Overflow` | **Deleted** |
| Grant of both to Student 11 | **Removed**, voucher re-priced back |
| Ad-hoc concession `QA18 Unrelated Tuition` | **Removed** |
| Student 11's voucher `LGS-2026-08-0006` | **Restored**: 50,000 subtotal, 15,000 concession, 35,000 total, unpaid — its opening figures exactly |
| `student_concessions` for Student 11 | Back to *Siblings Discount* and *Second Discount* |
| `email_outbox` | 17 rows, all `sent`. Nothing queued, **no parent emailed** |
| Ledger | **Untouched.** Nothing in this run posted, updated or deleted a `ledger_transactions` or `ledger_entries` row |

**⚠️ One row remains, and it is money.**

```
student_credits  id = 8d7a36af-c562-4728-ba37-df5e20f0fde8
  student_profile_id = 5447bb84-64e3-42bc-b496-93041c226d70   (Student 11)
  amount = 5000.00   reason = discount_overflow
  applied_challan_id = NULL   (unspent)
  notes = "Discount larger than the balance left on LGS-2026-08-0006."
```

It was banked by the deliberate overflow in case 12.7 and survived the removal of
the concession that caused it — that is defect **F6**. It is unspent, so it is
harmless until Student 11's next voucher, which would silently consume 5,000
rupees the school never granted. **It should be removed before that happens.**
`student_credits` is not one of the two append-only ledger tables, so deleting it
breaks no rule:

```sql
delete from student_credits
where id = '8d7a36af-c562-4728-ba37-df5e20f0fde8'
  and applied_challan_id is null;
```

One further permanent change, benign and disclosed: `LGS-2026-08-0006`'s items
now carry `concession_detail = 'Siblings Discount 10%, Second Discount 20%'`
where they carried null. Repricing wrote it, it is accurate, and it is what item
14 wants a voucher to say. It cannot be un-written and there is no reason to.

Pre-existing test data **not** created by this run and left as found: the six
`QA14 …` students, `QA17 Photo Persistence`, and Student 11's *Siblings Discount*
and *Second Discount*.

---

## Tally

| | Count |
| --- | --- |
| ✅ passed | 63 |
| 🐛 defect found, fixed, re-verified | 8 |
| ⚠️ passed with a caveat / reported not fixed | 3 |
| ⬜ not executed | 62 |

Six distinct defects (F1–F6) across those eight marks. Five fixed in four
commits, each re-verified in the browser against LGS's real data; F6 reported.

The not-executed count is high and it is not padding: items 1, 2, 6, 10, 17 and
18 are almost entirely unexecuted, and the reasons are the same three throughout
— the enrolment wizard was not driven, and email and the ledger cannot be
exercised against a live tenant sharing a database with production without
sending real mail to real parents or writing rows that can never be taken back.
