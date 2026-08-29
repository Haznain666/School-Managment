# Test cases — Sprint 19a: the branch boundary, and the owner who sees across it

Traces to [`SPRINT-19-SPEC.md`](../SPRINT-19-SPEC.md) items 1–13, and to
STATE.md §5bh. Items 14–19 are phase 19b and are not covered here.

Migration `0035` — **APPLIED and verified** against the live database before
this run (35 bookkeeping rows → 36; 34 catalogue assertions; 30
constraint-firing tests, each expected refusal inside its own `SAVEPOINT`, the
whole transaction rolled back). Nothing here re-applied it or rolled it back.

## Status — 2026-08-29

**Four defects were found and all four are fixed and re-verified.** One of them,
**D3, was a 500 on the school-admin dashboard reachable by typing a query
parameter**, and it had shipped: `4b4b735e9a2c` went live with it. Sprint 19a
passed thirteen green gates on the way out, and **not one of them executes a
query or measures a rendered element** — which is the third sprint running where
that sentence has had to be written.

| Mark | Meaning |
| --- | --- |
| ✅ | executed and passing |
| 🐛 | **was a defect QA found, now fixed and re-verified** |
| ⚠️ | executed, passed, with a caveat recorded |
| ⬜ | not executed, and why |

---

## How this was driven

The standalone artifact, started with `preview_start` on **port 3100**, against
the **real live database**. Super Admin sign-in, then *Login as Admin* into each
school.

**No school member's password was handled.** A local-only bcrypt hash was minted
into `.env.standalone.local`, which is gitignored and ships nowhere; the
plaintext was chosen for this run and is a throwaway.

**SMTP was deliberately blanked in that env file**, and this is the safety note
worth keeping. `instrumentation.ts` starts the outbox drainer in-process and the
QA process points at the *same* Supabase database as the live deployment — so
anything queued here would be sent by the **live** drainer to a real parent.
Nothing in this run creates a record, so nothing was queued.

**Nothing was created, edited or deleted at either school.** The only write
attempted was a `DELETE` whose *refusal* was the thing under test, and it
refused.

### The two environment facts that will otherwise cost the next session

**1. The Browser pane does not composite, so screenshots are impossible.**
Every `computer{action:"screenshot"}` call times out with *"the Browser pane is
not displayed"*. This is not a build fault — §5be's missing `.next/static` copy
was done (526 files) and every chunk returned 200. Verification was done through
the DOM instead, which for the chart-overflow question in item 5 is strictly
better evidence than a picture: `getBBox().x < 0` is a number, and "does that
text look like it is outside the box" is a judgement.

**2. Streamed Suspense boundaries never reveal, for the same reason.** React 19
defers a boundary reveal to `requestAnimationFrame`, and an uncomposited pane
fires none, so every data screen sits on its skeleton for ever with the finished
content parked in a `div[hidden]` beside it. Arm this after **every**
navigation, then wait 4–8s:

```js
window.requestAnimationFrame = (f) => setTimeout(() => f(performance.now()), 0);
window.__qaDrain = setInterval(() => {
  try { if (window.$RB && window.$RB.length) { const q = window.$RB.slice(); window.$RB.length = 0; window.$RV(q); } } catch (e) {}
}, 50);
```

Set input values through the native `HTMLInputElement.prototype.value` setter
plus an `input` event and call `element.click()`; `form_input` and coordinate
clicks are unreliable without compositing. **A login form needs ~8s to hydrate
before a click registers** — clicking earlier does nothing at all, silently, and
reads exactly like wrong credentials.

### The tenants

| School | Campuses | Notes |
| --- | --- | --- |
| **Lahore Grammar School** (`lgs`) | **two** — Defence Branch (LHE-MAIN), Karachi Branch (KHI-MAIN) | 12 enrolled students, 14 classes, 8 portal members, all at Defence. Karachi is empty. The only multi-campus fixture that exists. |
| **Beacon House School System** | **one** | The item 13 fixture. |

⚠️ The developer's closing report said *"the group view has no fixture
anywhere — LGS has one campus"*. **That was wrong**, and it is worth recording
why it matters: acting on it would have meant creating a disposable two-campus
tenant in a live production database to test something that was already
testable. Check the data before building a fixture for it.

---

## The four defects

### 🐛 D1 — the owner's dashboard contradicted itself about where the money came from

On `/dashboard` under *All campuses*, two charts one above the other reported the
same PKR 20,000 differently:

* **Collection by campus** → `Defence Branch — billed 95,000, collected 20,000`
* **Income against expense by campus** → `Defence Branch 0 · Karachi Branch 0 · No campus (school-wide) 20,000`

**Cause.** `app/api/school/fees/challans/[challanId]/payments/route.ts` posts
`source: 'fee_payment'` and never passed `branchId`, so every fee-payment ledger
transaction carries `branch_id = NULL`. `getCampusLedgerTotals` groups on that
column and was therefore telling the truth — the ledger was never told which
campus took the money — while the fee charts resolve the campus through the
student's grade.

**Fixed on both sides.** The posting now resolves the student's campus before
the transaction opens and passes it. Existing rows cannot be repaired by a write
— `ledger_transactions` is append-only by the rule in `CLAUDE.md` and was **not**
rewritten — so the read derives the campus for untagged `fee_payment` rows
through `source_id` → `fee_payments` → the voucher's student. A null still
posts: a student with no active enrolment has no campus, and that is not a
reason to refuse somebody at a counter with cash.

**Re-verified:** Income and expense by campus now reads `Defence Branch
PKR 20,000`, the *No campus* row is gone, and the two charts agree.

⚠️ The campus is resolved against **the voucher's own academic year**, not the
current one. A payment taken this month against last year's voucher belongs to
the campus the child was at *then*. A ledger whose past moves when a student
transfers is not a ledger.

### 🐛 D2 — money labels drawn outside the chart

Every end-anchored `<text>` on the page was measured with `getBBox()`. Eight of
them started at a negative x — outside the viewBox, printed over whatever sits
beside the card:

| Chart | Worst label | Started at |
| --- | --- | --- |
| Collections by campus *(new in 19a)* | `PKR 10,000` | **x = −16.2** |
| Ageing of receivables *(since Sprint 15)* | `PKR 20,000` | **x = −16.2** |

**Cause.** `PADDING.left` was the constant `46` in both `BarChart` and
`LineChart`. 46 is correct for `compactNumber` — `"20k"` is three glyphs — and
wrong for any chart passing a money formatter: `"PKR 20,000"` measures ~56
units, is drawn at `x = left − 8` anchored `end`, and therefore starts sixteen
units off the edge.

**This is the same defect the product owner reported against the exam-outcomes
chart.** Item 5 fixed the *horizontal* category labels and never looked at the
vertical axis, which is the identical bug one axis over.

**Fixed** by measuring rather than assuming: `axisGutter(ticks, format)` in
`lib/chart-scale.ts` sizes the gutter from the widest formatted tick, with a
floor of 46 so every existing compact-formatted chart is pixel-identical.

**Re-verified:** page-wide count of end-anchored text starting left of the
viewBox, **8 → 0**.

### 🐛 D3 — a query parameter 500'd the dashboard at every school

`/dashboard?branch=BOGUS-NOT-A-UUID` returned *"Could not load the dashboard"*.

```
select "id" from "grades" where ("grades"."location_id" = $1 and "grades"."branch_id" in ($2))
params: 21fad594-…, BOGUS-NOT-A-UUID
22P02  invalid input syntax for type uuid: "BOGUS-NOT-A-UUID"
```

**Two faults in one four-line function.** `pick()` in `lib/branch-scope.ts`
never checked the shape of the requested id; and for the owner it was called as
`pick(requested, null, null)`, where `allowed === null` means *return whatever
was asked for*. So:

1. a malformed value reached a `uuid` comparison and Postgres refused the whole
   statement — a 500 from a string anybody can type into the address bar;
2. a **well-formed id belonging to another tenant was accepted**, and silently
   narrowed every tile and chart to a campus this school does not have. An
   all-zero dashboard that reports no error is the worse of the two, because
   nothing on it says it is wrong.

The spec's own rule 4 says it must resolve to *"never a 500 and never somebody
else's campus"*, and it did both.

⚠️ **`isUuid` already existed in `lib/validation.ts`, and its docblock says
exactly this**: *"Postgres raises on a malformed uuid literal, so an unchecked
path segment turns a typo into a 500 instead of a 404."* The helper was written
for this and was not called. A rule with a helper beside it is not a rule that
is being followed.

**Fixed:** shape-checked before any membership test, and the owner's `allowed`
list is now the school's own campuses rather than `null`.

**Re-verified:** `?branch=BOGUS-NOT-A-UUID` renders normally, falls back to
*All campuses*, and the scorecard appears.

### 🐛 D4 — the delete guard counted a table nothing writes to

`DELETE /api/school/branches/[branchId]` refused on the count of
`students.branch_id`. **`students` is the minimal Sprint 1 table and nothing in
the product has ever inserted into it** — enrolment writes `student_profiles`
and `student_enrollments`. The count was zero at every school, so the refusal
could never say *"still has 12 students"* however full the campus was.

**What this was and was not.** It was **not** data loss for a populated campus:
`student_enrollments.section_id` has no cascade, so Postgres does block the
delete once a child is enrolled. Two real faults remained:

1. that block arrives as a caught foreign-key error and a vague sentence about
   *"classes, timetables or exams"*, when the true answer is twelve children — a
   refusal that cannot name what it is protecting reads as an obstacle rather
   than a reason;
2. `grades`, `sections` and `fee_structures` all cascade from a branch, so a
   campus **configured but not yet enrolled** tripped nothing and lost its whole
   grade ladder and price list silently, with no record any of it existed.

**Fixed:** counts active enrolments through grade → section, and counts `grades`
so case 2 is refused by this route with a sentence rather than by nothing at all.

**Re-verified** against Defence Branch with its code typed correctly:

```
409  Defence Branch still has 12 enrolled students, 14 classes, 8 portal
     members attached to it, so it cannot be deleted …
```

Nothing was deleted. Before the fix that sentence could only have read *"8
portal members"*.

---

## Item-by-item

### ✅ Item 1 — "Principal name" becomes "Head of School"

`/dashboard/settings`. Field labels read `Type · Phone · Email · **Head of
School** · Address · Upload a logo`. The string "Principal name" does not appear
on the page. The column is still `schools.principal_name`, as intended — a
column rename is 1,200 lines of unreviewable diff for a caption.

### ⚠️ Item 2 — the branch boundary

The resolver behaves for a caller who is *not* branch-bound: an unknown campus
falls back, a valid foreign campus falls back (see D3), a real campus narrows.
`check-branch-scope` passes 1,296 assertions across the catalogue, the resolver
and the listings.

**The branch-bound half is ⬜ — see item 12.**

### ⬜ Item 3 — the Branch Admin / Branch Principal toggles

Not executed. The form renders on `/dashboard/branches/new` and on the Super
Admin branch pages, but **submitting it would create a real campus at a real
school**, and choosing *Somebody else* would send a real password-creation email
to whatever address was typed. Verifying the toggles is safe; verifying what
they *do* is not, without a disposable tenant.

### ✅ Item 4 — the owner dashboard

Rendered at LGS under *All campuses* against real data:

* selector offering `All campuses · Defence Branch · Karachi Branch`
* five group tiles, each with a comparison, and the worst campus named —
  `21.1% of this year's billing collected · lowest: Defence Branch at 21.1%`
* **Collection by campus**, horizontal, billed against collected
* **Enrolment share**, donut (2 campuses, so under the 5-slice switch)
* **Income against expense by campus** *(the D1 chart)*
* **Collections by campus**, 12 months, one line per campus *(the D2 chart)*
* **Per-campus scorecard** — `Defence Branch 12 · 100% · 95,000 · 20,000 ·
  21.1% · 75,000 · 0` and `Karachi Branch 0 · — · 0 · 0 · — · 0 · 0`

⚠️ The five cross-campus charts have only ever been rendered against **two**
campuses, one of which is empty. The six-line cap on the trend chart, the
donut→bar switch above five campuses, and the scorecard's sorting at twenty rows
are all unexercised.

### ✅ Item 4d — SetupProgressCard

Present for the owner of **Beacon House** (one campus, therefore pinned), which
is the case the rule was written to protect. Absent from LGS's *All campuses*
view, where it would be meaningless.

### ✅ Item 5 — the exam-outcomes chart draws inside itself

Horizontal category labels measured across every chart on the dashboard: the
longest, `"No campus (school-wide)"`, starts at **x = 38.4**, comfortably inside
a 172-unit label column. Truncation carries a `<title>` with the full string and
the hidden data table keeps every name in full.

The vertical axis of the same component did **not** hold — that is D2.

### ✅ Item 6 — the sidebar collapses and starts closed

On `/dashboard`, all seven sections render as headings alone: `ADMISSIONS ·
ACADEMICS · EXAMS · FEES · HR · PAYROLL · ACCOUNTING`, no child items. On
`/dashboard/admissions`, **ADMISSIONS alone is open** and shows Overview,
Academic Years, Grades & Sections, Enroll Student, Import Students, Promote
Students, All Students, Applications — the rest stay shut. The flat items
(Dashboard, Users & Staff, Branches, Communications, Reports, Settings,
Feedback) do not collapse, as specified.

### ⚠️ Item 7 — Users & Staff pages at 50

`Showing 1–16 of 16 users`, with a Campus column reading `All branches` for the
owner. `defaultLimit: 50` is set.

⚠️ **The pager itself is unexercised** — no school on this platform has more
than 50 users, so the second page has never been rendered and the count query's
agreement with the page query is unproven at the boundary. §5bf records that
exact trap on the student list.

### ✅ Item 8 — a branch is editable from the school portal

`/dashboard/branches` rows link to `/dashboard/branches/<id>`. That page carries
the full campus record, an **Edit campus** link, the **Principals** card moved
from Settings (item 10's other half), and **Delete this campus** behind a typed
code. The delete refusal is D4.

### ✅ Item 9 — every report offers a campus

`/dashboard/reports/academic-results` — one of the four that had no `branch`
filter before this sprint — now renders a `branch` select offering `All campuses
· Defence Branch · Karachi Branch`, beside its existing `term` select.

⬜ The other thirteen reports, the printed sheet's scope caption, and the CSV
export were not walked.

### ✅ Item 10 — Settings loses the principal card

No principal card, no "Principals & divisions" copy on `/dashboard/settings`.
The component is not deleted — it renders on the branch detail page, where the
question "who runs this campus" is actually asked.

### ⬜ Item 11 — Admissions Overview takes a campus

Not executed. `/dashboard/admissions?branch=…` renders without error, but that
the funnel's numbers actually narrow was not confirmed.

### ⬜ Item 12 — branch-bound users see one campus

**Not executed, and this is the sprint's whole point.**

No branch-bound member's password is available, and none may be reset — that
would lock a real member of a real school out of their account. Proving this
needs either a disposable tenant or a deliberate test account, and STATE.md
§5bg already names a disposable tenant as the most valuable thing this project
could build for its own QA. This sprint is the strongest argument yet.

What *is* established: `check-branch-scope` passes 1,296 assertions, the
resolver's branch-bound path is `[callerBranchId, ...grants]` filtered to live
campuses, and `lib/global-search.ts` — the widest exposure, because it crosses
every module in one query — is in the scoped set. That is code reading, not
evidence, and it is recorded as such.

### ✅ Item 13 — one branch means no question

Beacon House, one campus: **no campus selector anywhere on the dashboard**, no
per-campus scorecard, no cross-campus charts. The single campus is applied
silently. LGS, two campuses: the selector appears.

---

## Gates

All thirteen green on the fixed tree, in this worktree:

```
typecheck             clean
lint                  clean
check-loaders         PASS — 275 assertions
check-branch-scope    PASS — 1296 assertions
check-forms           PASS — 60 assertions
check-address-phone   PASS — 40 assertions
check-cnic            PASS — 36 assertions
check-currency        PASS — 7 assertions
check-sprint-periods  PASS — 107 assertions
check-accounting      PASS — 121 assertions
check-dashboard       PASS — 47 aggregates
check-reports         All checks passed
build                 green, 526 static files copied
```

⚠️ **Thirteen green gates did not see three of the four defects**, and could
not have: none of them executes a query or measures a rendered element. D3 was a
500 reachable from the address bar and it shipped. The gate that found it was
opening the screen.
