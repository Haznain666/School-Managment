# Sprint 23 test cases — the principal's grades, the class teacher, and the discount

**Status: DRIVEN 2026-09-03** against Askari School System, on a local
`next dev` pointed at the **live migrated database**, entered through a
platform emergency-login link (`scripts/qa-emergency-link.mjs`) rather than by
typing a password. **The run's results are recorded in §"QA run" at the foot of
this file** — read that before trusting any expectation above it, because two
of the expectations below turned out to be wrong about the browser.

Every row below is a case somebody has to open a browser and run. Nothing here
is marked PASS on the strength of a gate, and the gates that *were* run are
listed separately at the foot so the two are never confused.

**Migration `0039` must be applied before any of this.** Five surfaces are a 500
without it — `SPRINT-23-DDL-NOTES.md` names them — so a run started on an
unmigrated database will fail cases 20 to 24 for the wrong reason.

Set-up: a school on **separate principals** (`principal_model = 'multiple'`)
with at least two people in the Principal role, at least four classes, and one
child holding a discount with three vouchers against it — one `unpaid`, one
`partial`, one `paid`.

---

## Item 1 — removing a discount reprices unpaid vouchers

| # | Case | Expected |
| --- | --- | --- |
| 1 | Grant a sibling discount, raise a monthly voucher, confirm the discount is on it. Then **Remove** the grant | the voucher's total goes **up** by the discount and its `concessionAmount` returns to `0.00` |
| 2 | Repeat, but record a **part payment** before removing | the voucher does **not** move, and the panel says one voucher was left unchanged because a payment is recorded against it — **naming the voucher number** |
| 3 | Repeat with the voucher fully **paid** | unchanged, and reported the same way |
| 4 | A grant whose `valid_until` passes **naturally** | issued vouchers keep their discount. This is the §5bj behaviour and it must survive |
| 5 | **Granting** a discount (not removing) with one `unpaid` and one `partial` voucher | **both** are repriced, against their own due dates, exactly as before this sprint |
| 6 | A child whose voucher is folded into a **family voucher** | reported as skipped, not edited |
| 7 | `ledger_transactions` / `ledger_entries` row counts, before and after cases 1–3 | **identical.** Nothing this item does may post or reverse |

Case 7 is the one to take seriously. A voucher with no payment has posted
nothing, which is exactly why repricing it is safe under the append-only rule —
but "exactly why it is safe" is a claim, and the row count is the evidence.

## Item 2 — one class, one principal

| # | Case | Expected |
| --- | --- | --- |
| 8 | Settings → Principals | the toggle **"Allow a class to have more than one principal"** is present and **off** |
| 9 | Assign classes 1–3 to Principal 1. Open Principal 2's assignment form | 1–3 are greyed and labelled with Principal 1's name |
| 10 | Force it anyway — `POST /api/school/principals` with class 3 in `gradeIds` | **409**, message names Principal 1 and the Settings switch |
| 11 | Turn the toggle **on**, repeat case 10 | succeeds |
| 12 | Turn it **off** again | the overlap created in 11 is **still there**, chipped *"Also assigned to X"*. Nothing was deleted |
| 13 | **End** Principal 1's assignment, then assign class 1 to Principal 2 with the toggle off | succeeds — an ended assignment is not a clash |
| 14 | Edit Principal 1's own assignment, keeping class 3 | succeeds — a person does not clash with themselves |
| 15 | Two campuses, each with a "Class 3". Assign one to each head, toggle off | succeeds — classes are already per campus |
| 16 | An assignment with **no** classes named ("runs everything") | claims nothing; another head may still be given class 3 |
| 17 | `PATCH /api/school/principals/[id]` reopening an ended assignment onto a taken class, toggle off | **409** |
| 18 | Tenancy: the same POST from the other school | 404/400, and the other school's assignments are untouched |

## Items 5 and 8 — staff photographs and the joining date

| # | Case | Expected |
| --- | --- | --- |
| 19 | Student detail screen, a student with a photograph | it renders. (Verification case — this already worked; confirm it still does) |
| 20 | HR → Staff | an avatar per row; initials for everybody with no photograph, and **no silhouette** |
| 21 | Staff profile → **Add photo**, a JPEG under 2 MB | appears on the profile **and** on the list |
| 22 | A 3 MB file | refused: *"The photo must be 2 MB or smaller."* |
| 23 | A PDF renamed `.jpg` | refused: *"The photo must be a PNG, JPG or WebP image."* |
| 24 | Tenancy: `POST /api/school/hr/staff/<other school's staff id>/photo` | 404, and nothing is written to Storage |
| 25 | `school_users.avatar_url` for that person, after case 21 | **unchanged.** A personnel photograph is not a sign-in avatar |
| 26 | Invite form and HR forms: a joining date **two years ahead** | refused on the server, message names the limit; the input's `max` stops it being typed |
| 27 | A joining date **in 1998** | accepted, on both forms and on the HR profile's edit |
| 28 | The two forms' messages for case 26 | **identical wording.** Sprint 22's QA finding 1 was the two halves disagreeing about one person |

## Item 4 — the class teacher

| # | Case | Expected |
| --- | --- | --- |
| 29 | Invite a teacher through Users & Staff with an employment record (no HR "Class Teacher" tick). Open Academics → Classes | they appear in the class-teacher picker |
| 30 | Set a class teacher on **Academics → Timetable** | it shows on Academics → Classes, and the reverse |
| 31 | Assign a second teacher to one section | the first is replaced; the section never has two |
| 32 | Set one teacher on two sections | allowed, and both pickers note *"also class teacher of …"* |
| 33 | The picker on the section that teacher already holds | does **not** say they "also" hold this one |
| 34 | A **resigned** member of staff | not offered |
| 35 | Somebody with `academics.write` but not `admissions.write`, on the timetable | the class-teacher control is visible and **disabled**, and the route refuses a hand-made PATCH |

## Item 3 — the principal's grades

Signed in as a principal assigned classes 1–3 at a `multiple` school.

| # | Case | Expected |
| --- | --- | --- |
| 36 | Students list | classes 1–3 only |
| 37 | A student in class 5 — open their profile by URL | **not found** |
| 38 | A student with **no placement at all** | still visible. A child not yet placed is not hidden from every head |
| 39 | Enrolment wizard's class picker | 1–3 only |
| 40 | HR → Staff | this head's campuses' staff. A head with a division and no campus sees everybody — see the release note |
| 41 | Users & Staff → Invite, campus picker | this head's campuses |
| 42 | Voucher register, its class filter, and its **totals** | 1–3 only, and the totals are 1–3's, not the school's |
| 43 | Generate vouchers | class picker offers 1–3 |
| 44 | Fee reports: outstanding, collection, chase list | 1–3 only |
| 45 | Aged debt, **and its bucket totals above the table** | 1–3 only. A head's rows under the school's receivable is the failure to look for |
| 46 | Timetable: grade and section pickers | 1–3 only |
| 47 | Exams overview, its outcome chart, and the datesheet columns | 1–3 only |
| 48 | Report cards, promotions sheet | 1–3 only |
| 49 | Mark attendance; attendance reports and the by-class chart | 1–3 only |
| 50 | Reports → attendance-summary, subject-attendance, fee-collection, outstanding-aging, academic-results | 1–3 on screen, on **Print** and in the **CSV** — all three the same |
| 51 | Reports → balance sheet, P&L, day book | **unnarrowed**, deliberately. No class dimension exists |
| 52 | Every narrowed screen | carries the *"You are seeing …"* line |
| 53 | A principal with **no assignment** | every one of those screens says who to ask, and none of them is a blank page |
| 54 | Switch the school to **single principal** | the same principal sees everything again, everywhere |
| 55 | A **school administrator** at the same school | sees everything, on every screen above. This is the regression that matters most |
| 56 | **The recorded consequence.** `POST /api/school/fees/challans` with a class outside the head's scope | **it succeeds.** This is a visibility filter, not an authorization boundary, and this case exists so the decision is tested rather than assumed |

## Item 7 — the date field

| # | Case | Expected |
| --- | --- | --- |
| 57 | At **1366×768** (`resize_window`): invite form, enrolment wizard, voucher screens, HR forms | every date field reads `dd/mm/yyyy` with its picker icon. **No missing month** |
| 58 | A date field inside a two-column grid inside a modal | same |
| 59 | At 375×812 | the field does not overflow its column and no horizontal scrollbar appears |

Case 57 is the reported fault and must be verified at that width. A fix verified
only at desktop width is not verified.

---

## Gates run, 2026-09-03 — these are not test cases

| Gate | Result |
| --- | --- |
| `typecheck` | 0 errors |
| `lint` | 0 warnings |
| `check-loaders` | PASS — 279 assertions, 142 routes |
| `check-forms` | PASS — 60 |
| `check-address-phone` | PASS — 50 |
| `check-cnic` | PASS — 36 |
| `check-currency` | PASS — 7 |
| `check-sprint-periods` | PASS — 107 |
| `check-accounting` | PASS — 121 |
| `check-theme` | PASS — 7 palettes |
| `check-branch-scope` | PASS — 1415 |
| `check-reports` | PASS — all 16 runners |
| `check-dashboard` | PASS — 47 aggregates |
| `check-portals` | PASS — 18 of 22 reached, the same 4 NOT EXERCISED as Sprints 21 and 22 |
| `check-sprint20` | PASS — 11 ok |
| `check-sprint21` | PASS — 19 ok |
| `check-sprint22` | PASS — 17 ok, after being taught about `0039` (see below) |
| **`check-sprint23`** | **PASS — 31 ok, 0 failed**, with `0039` NOT applied and four predicted `42703`s |

`check-sprint22` exercises `listStaff` and `getStaff`, both of which now select
`staff.photo_url`. It went red on three assertions the moment this sprint
touched them — correctly, and for exactly the reason the DDL notes predict. Those
three now read `information_schema.columns` and flip their own expectation, the
same way `check-sprint23` does, so the gate stays honest on both sides of the
deploy instead of being red with a note beside it.

`npm run build` was **not** run — it is the DevOps step and needs
`.claude/worktrees/node_modules` deleted first.

`check-sprint23` must be run **again after `0039` is applied**. It reads the
catalogue and flips its own expectation, so the same command asserts the other
half: all thirty-one statements executing, plus the two columns' type,
nullability and default.

---

# QA run — 2026-09-03, Askari School System

Driven in the in-app browser against a local `next dev` pointed at the **live
migrated database**. Signed in through a platform emergency-login link — 15
minutes, single use, recorded in `emergency_login_tokens` — so **no password was
typed and `.env.local` was never touched**. That is a change from Sprints 20–22,
which minted a throwaway `SUPER_ADMIN_PASSWORD_HASH_B64`; the script is
`scripts/qa-emergency-link.mjs` and its docblock says why.

**Askari, not LGS.** LGS is on `principal_model = 'single'`, so items 2 and 3
cannot be exercised there at all. Askari is the only school with `multiple` and
two principals, and it is where every principal case below was run.

## Result

| Item | Verdict | Evidence |
| --- | --- | --- |
| **1 — discount repricing** | ✅ **PASS**, including the case that discriminates the fix | below |
| **2 — distinct grades + toggle** | ✅ **PASS**, chips rendered for the first time | below |
| **3 — principal visibility** | ✅ **PASS** on students, fees and the grade pickers | below |
| **4 — class teacher** | ✅ **PASS** | below |
| **5 — staff photo** | ✅ **PASS** | below |
| **6 — designation default** | ✅ **PASS**, all three clauses | below |
| **7 — the date field** | ⚠️ **FIX PRESENT, SYMPTOM NOT REPRODUCED** — see the finding | below |
| **8 — joining date ceiling** | ✅ **PASS** | below |

## Item 1 — and the test that actually discriminates it

The obvious test does **not** prove the fix. A voucher due in November, with the
grant removed in September, is dropped by the *old* logic and the *new* one
alike — both agree the grant is dead by November. It passed, and it proved
nothing.

The discriminating case is a voucher whose **due date falls inside the grant's
live window and before the close date**. Closing writes `valid_until` to
yesterday (2026-09-02), so a voucher due 2026-09-02 is one the old logic prices
as at a day the grant was still live.

| | Voucher | Due | Before | After removal |
| --- | --- | --- | --- | --- |
| Plain unpaid | `ASST-2026-11-0001` | 10 Nov | 25,600 (conc 6,400) | **32,000, conc 0.00** |
| **Discriminating** | `ASST-2026-10-0002` | **2 Sep** | 22,000 (conc 5,000) | **32,000, conc 0.00** |
| **Part-paid** | `ASST-2027-01-0002` | 10 Jan | 22,000, paid 5,000, `partial` | **unchanged** |

Old behaviour would have kept the discount on the middle row. `priceAsOf: today`
is what dropped it — that is the fix, proved on the only case that separates it
from the behaviour it replaced.

The removal response for the part-paid case was
`repricedVouchers: 0`, `paidVouchers: ["ASST-2027-01-0002"]`, `skipped: []` —
**named by number, not silently skipped** — and `StudentDiscountPanel` renders
those numbers in the notice rather than a bare count. The three paid September
vouchers were untouched throughout, figures read back from the database.

`ledger_transactions` 3 → 4 → 3 and `ledger_entries` 6 → 8 → 6 across the run:
the only movement was the part payment I raised and then removed. **The removal
itself posted nothing**, which is what item 1's "do not touch the ledger" requires.

## Item 2 — the chips, rendered for the first time

No school on the live database had an overlapping assignment, which is why this
had never been seen. I created one.

- `POST` a grade Principal 1 holds, sharing **off** → **409**: *"Class 1 is
  already assigned to ASS Principal 1. Turn on ‘Allow a class to have more than
  one principal’ in Settings, or remove it from their assignment first."*
- An unheld grade → **201**.
- Toggle **on** → the identical clash → **201**.
- Toggle back **off** → **the overlap survived**. Nothing was deleted, which is
  the grandfathering rule.
- The screen then rendered **"Also assigned to ASS Principal 2"** on one row and
  **"Also assigned to ASS Principal 1"** on the other, and the taken grades are
  disabled buttons titled *"Already assigned to ASS Principal 1. Turn on…"*.

⚠️ **A malformed probe of mine is worth recording so nobody repeats it.**
`PATCH /api/school/principals/[id]` with `gradeIds` returns **200 and ignores
them** — the route only ends or reopens an assignment, exactly as its docblock
says. That is correct, not a defect. Grades are edited by delete-and-recreate.

## Item 3 — the visibility filter

Signed in as **ASS Principal 1** (Pre-Nursery → Class 4 of thirteen grades):

- Students list: **1 of 3** students — Student 1 (Pre-Nursery). Students 2 and 3
  (Class 5) hidden.
- Grade dropdown: exactly the seven assigned. Class 5–10 absent.
- `GET /api/school/grades`: the same seven.
- Vouchers: **1 of 3** — Student 1's only.
- As **School Admin** at the same school: all three students, all thirteen
  grades, all three vouchers. The narrowing is a no-op for everyone else.

## Items 4, 5, 6, 8

**4.** `QA23 Probe2`, created through the **invite** path with no
`is_class_teacher` flag, **appeared in the class-teacher picker** — the exact bug
reported. Assigned to two sections: both `200`, and the note read
`alsoClassTeacherOf: ["Pre-Nursery-A", "Class 5-A"]`. One class teacher per
section stays structural — it is one column.

**5.** Valid PNG → **200**, stored at
`<location_id>/staff/<staff_id>/photo.png` — inside the school's own prefix. A
PDF → **415** *"must be a PNG, JPG or WebP image."* A 3 MB PNG → **413** *"must
be 2 MB or smaller."* `photoUrl` read back on the record.

**6.** All three clauses, on a clean page: blank → **"Branch Administrator"**;
role changed to Accountant → **"Accountant"** (the stale label replaced); a typed
*"Senior Finance Officer"* → **survived** a further role change untouched.

**8.** `joinedOn` at **+400 days** → **400**, *"A joining date can be at most one
year from today — 2027-09-03 or earlier."* A **1998** date → **201**, employment
created. Past dates stay unlimited, as specified.

⚠️ A second malformed probe, recorded for the same reason: sending
`createStaffRecord` / `joinedOn` at the **top level** of the invitation body
makes the route skip its whole employment block and answer `201` with
`employment: null`. The fields belong under `employment`. Nothing is wrong with
the route; the request was.

## ⚠️ Item 7 — the finding

**The fix is present and harmless. It does not explain the reported symptom, and
the comment shipped beside it was wrong.**

`app/globals.css` asserted that Chromium clips the **middle** segment of a date
input. Measured on Chromium at 1366×768 by cloning a real date input at fixed
widths:

| width | renders |
| --- | --- |
| ≥130px | `dd/mm/yyyy` |
| 120px | `dd/mm/yyy` |
| 110px | `dd/mm/y` |
| 100px | `dd/mm/` |
| 80px | `dd/m` |
| 60px | `dd` |

It truncates **from the right**. The **year** is lost first; **the month is
never the segment dropped**. The reported `dd------yyyy` — day and year present,
month missing — is not a thing Chromium does at any width.

Further, **no field in the product is narrow enough to clip**: the narrowest
measured is **355px** (Joining date, Invite staff, 1366×768), against a
threshold of ~130px.

So the `min-width` rule is worth keeping — it protects a genuinely narrow
container and every date field nobody has written yet — but **item 7 must not be
closed on it**. The comment has been corrected in this sprint to record what was
measured rather than what was assumed. The remaining question is the reporter's
**browser and locale**; a Firefox or Safari date input, or a non-`en-GB` locale,
renders differently and is the next place to look.

## Residue — read back, not asserted

Everything created was removed and the removal was read out of the database:

| | After |
| --- | --- |
| `QA23%` school_users / staff | **0 / 0** |
| staff holding a photo | **0** |
| storage object | deleted; the prefix lists empty |
| sections with a class teacher | **0** |
| fee_challans / payments / ledger_transactions | **3 / 3 / 3** — the originals |
| principal_assignments | **2** — the originals; QA rows **0** |
| `allow_shared_principal_grades` | **false** — restored |
| open concessions | **2** — both grants restored to an open `valid_until` |
| emergency_login_tokens | **0** |
| `email_outbox` to `qa23%` | **0** |

⚠️ **One thing that is by design and surprised the cleanup:** deleting a school
member leaves their `staff` row behind with `school_user_id` set to NULL. That
is `ON DELETE SET NULL` doing what Sprint 22 chose — an employment record is a
separate fact from a login, and a person who has left still has an employment
history. It is not a defect, but a cleanup that deletes only the member leaves
an orphan, and this one had to be removed explicitly.

## Gates re-run after the comment correction

`typecheck` 0 · `lint` 0 · `check-loaders` 279 · `check-forms` 60 ·
`check-cnic` 36 · `check-currency` 7 · `check-accounting` 121 ·
**`check-sprint23` 33 ok, 0 failed, 0 not exercised** (`0039` APPLIED).
