# Sprint 23 test cases — the principal's grades, the class teacher, and the discount

**Status: written, NOT driven.** Every row below is a case somebody has to open
a browser and run. Nothing here is marked PASS on the strength of a gate, and
the gates that *were* run are listed separately at the foot so the two are never
confused.

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
