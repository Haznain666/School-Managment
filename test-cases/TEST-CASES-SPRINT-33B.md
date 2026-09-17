# Test cases — Sprint 33b: the Section Head, the chain of command and HR leave

Requirement: `SPRINT-33-SPEC.md` Part B (decisions 1–16). STATE.md §5ch is the handover entry.
Tenant used for QA: **Askari School System** (`askari-school-system`). Main Campus has one
Principal (Imran Qureshi), one Vice Principal (Kamran Baig) and three Section Heads (Farah
Siddiqui, Rukhsana Bano, Tariq Jameel). Each campus has one coordinator.

**QA round 1** was run against the **live deployed build `2f8776fb0e6a`**, confirmed through
`/api/internal/build`. Migrations `0047` and `0048` were applied, and the four
`school_users_one_*_idx` indexes exist. Verdict: **do not ship until F1–F3 are fixed.** The
findings are listed at the end of this file.

**Sessions are real members**, opened with `scripts/qa-emergency-link.mjs`, with `QA_BASE_URL`
set to the **subdomain**. Ten links were minted, and `used_at` was checked before each one.

Where the Browser pane would not paint, page content was read with `javascript_tool`
(`fetch`, `innerHTML`, `querySelectorAll`) and confirmed against the database.

Legend: **B** = browser (UI), **F** = browser `fetch` against the live API, **DB** = read back from Postgres.

Fixtures: Adnan Sheikh (teacher, Main, supervised only by Bilal Hussain); Nasreen Akhtar
(accountant, Main); Iqbal Day 2026-11-09 and Quaid-e-Azam Day 2026-12-25 (both gazetted).

## 1. B1 — the Section Head role

| # | Case | Expected | Result | How |
| --- | --- | --- | --- | --- |
| 1.1 | Farah signs in via `/login` | lands on `/dashboard`, badge "Section Head" | pass | B |
| 1.2 | Sidebar matches her permission keys | Leave (Approvals, My leave), Staff Performance; no HR | pass | B |
| 1.3 | `/dashboard/hr/calendars`, `/dashboard/hr/chain` | redirected to `/dashboard` | pass | F |
| 1.4 | `/dashboard/leave` opens | "Leave approvals", empty state, `isApprover:false` (no coordinators linked) | pass | B/F |
| 1.5 | `/dashboard/leave/me` | form renders; chain "Vice Principal → Principal → School Administrator" | pass | F |
| 1.6 | `GET /api/school/chat/grants` | `yourRank: 45` | pass | F |
| 1.7 | Ban a named person (`scopeType: school_user`, `effect: deny`) | **403 refused** | pass | F |
| 1.8 | `leave/requests?scope=all`, `leave/settings` GET/PUT, `chain/section-heads` PUT, `hr/leave-requests`, `hr/staff` | 403 each | pass | F |
| 1.9 | Section Heads on the Principal's KPI board | listed, `canRate: true` | pass | F |

## 2. B2 — one Principal and one Vice Principal per campus

| # | Case | Expected | Result | How |
| --- | --- | --- | --- | --- |
| 2.1 | School admin PATCHes Rukhsana (Section Head) to `principal` at Main | **409 head_exists** naming Imran Qureshi | pass | F |
| 2.2 | PATCH Tariq to `vice_principal` at Main | 409 naming Kamran Baig | pass | F |
| 2.3 | `POST /api/school/invitations` for a new Principal at Main | 409 naming Imran Qureshi | pass | F |
| 2.4 | `POST /api/school/users` for a new Principal at Main | 409 naming Imran Qureshi | pass | F |
| 2.5 | Principal where none exists (school-wide), **not saved** | passes the head check; stopped by the phone-number conflict (409) — no row written | pass | F + DB |
| 2.6 | `/dashboard/hr/chain` | no duplicate-head warning; `duplicateHeads: []` | pass | B/F |
| 2.7 | The error message shown in the users UI | readable sentence on screen | not tested in the UI (API only) | — |

## 3. B3 — self-service leave and the chain

| # | Case | Expected | Result | How |
| --- | --- | --- | --- | --- |
| 3.1 | Adnan opens `/teacher/leave` | quotas, form, "Goes to: Coordinator → Vice Principal → Principal → School Administrator" | pass | B |
| 3.2 | Range 9–10 Nov (first day is Iqbal Day), Main set to `include` | 201, **2 days** | pass | B |
| 3.3 | Same shape with Main set to `skip` (Nasreen, 24–25 Dec, filed by HR) | 201, **1 day**, `holidayDays 1`, `skipped true` | pass | F |
| 3.4 | Request appears in Bilal's queue | `canDecide: true`, chain shown | pass | B/F |
| 3.5 | Request absent from Mehwish's queue (Junior) | empty | pass | F |
| 3.6 | Bilal approves with the button | 200; `decided_by` Bilal Hussain | pass | B + DB |
| 3.7 | Outside the chain, same campus: Farah / Wajahat on Adnan's request | **403 not_in_chain** naming the chain | pass | F |
| 3.8 | Outside the chain, same campus: Mehwish on Aqsa Mumtaz (Junior) | 403 not_in_chain | pass | F |
| 3.9 | Campus-bound approver at the other campus: Mehwish on Adnan; Imran and Wajahat on Aqsa | **403 wrong_campus** | pass | F |
| 3.10 | Teacher calls the decision endpoint or the approvals queue | 403 forbidden | pass | F |
| 3.11 | Teacher files leave for another staff member | 403 | pass | F |
| 3.12 | Teacher withdraws someone else's request | 409, nothing changed | pass | F |
| 3.13 | Withdraw own request | 200, row kept as `cancelled` | pass | F + DB |
| 3.14 | A teacher with two coordinators goes to the Vice Principal and above | — | not tested (no fixture) | — |
| 3.15 | Junior teacher (no login) filed by HR | — | not tested | — |

## 4. Refusals

| # | Case | Expected | Result | How |
| --- | --- | --- | --- | --- |
| 4.1 | Single day on Iqbal Day | **422** "closed that day for Iqbal Day", shown on screen | pass | B |
| 4.2 | Range touching a holiday | accepted (see 3.2 and 3.3) | pass | B/F |
| 4.3 | Overlap with existing leave (10 Nov) | **409**, names the existing range | pass | B |
| 4.4 | 11 days of Casual with 10 left | Apply disabled on screen; server **422** "allows 10 days… leaves 10 days, and this request is 11 days." | pass | B + F |
| 4.5 | The error clears when the dates change | the old holiday error stayed on screen | **fail (F5)** | B |
| 4.6 | "Days used" fills from the dates | field stays empty | **fail (F5)** | B |
| 4.7 | Old `POST /api/school/hr/leave-requests`: single day on a holiday | refused | **201 — fail (F1)** | F |
| 4.8 | Old route: filing for staff at another campus | 403 | reaches leave-type validation — **fail (F1)** | F |

## 5. Branch Admin decides leave for non-teaching staff

| # | Case | Expected | Result | How |
| --- | --- | --- | --- | --- |
| 5.1 | Nasreen's request in Wajahat's queue | chain "Branch Administrator → Principal → School Administrator", Approve shown | pass | B |
| 5.2 | Wajahat approves with the button | 200; `decided_by` Wajahat Ali | pass | B + DB |
| 5.3 | Reject with no note | 400 | pass | F |
| 5.4 | HR (no `leave.approve`) on the decision endpoint | 403 forbidden | pass | F |
| 5.5 | HR decides the same request via old `PATCH /api/school/hr/leave-requests/[id]` | refused | **200 — fail (F1)** | F |

## 6. HR screens

| # | Case | Expected | Result | How |
| --- | --- | --- | --- | --- |
| 6.1 | "Create both calendars" as campus-bound HR | two calendars created | **403 — fail (F2)** | B |
| 6.2 | `POST staff-calendars {branchId: Main}` | 201, teaching + non-teaching | pass | F |
| 6.3 | Calendars or settings for the other campus or school-wide, as campus-bound HR | 403 | pass | F |
| 6.4 | Override: cancel Iqbal Day on the Main teaching calendar for Section Heads only, notify off | saved, listed "Does not apply · Section Head" | pass | B + DB |
| 6.5 | The override applies to the chosen role | Farah single day on Iqbal Day → 201, `holidayDays 0` | pass | F |
| 6.6 | The override does not apply to other roles | Adnan (teacher) single day on Iqbal Day → 422 | pass | F |
| 6.7 | Notify | — | **skipped** (no role at Askari reaches only QA) | — |
| 6.8 | Holiday span setting: set Main to `skip`, then back to `include` | 200 each; takes effect (see 3.3) | pass | B + F |
| 6.9 | Leave types: create, edit and retire in the UI | controls exist | **fail (F3)** — read-only list | B |
| 6.10 | Save a reporting line | — | not tested (avoided a write) | — |

## 7. B4 — probation

| # | Case | Expected | Result | How |
| --- | --- | --- | --- | --- |
| 7.1 | Add-staff form, full time, 181 days | "Probation cannot run longer than 180 calendar days." | pass (form cancelled) | B |
| 7.2 | 180 days from 2026-09-16 | "Ends 2027-03-14" | pass (not saved) | B |
| 7.3 | Server PATCH with 181 days | 400, nothing written | pass | F + DB |
| 7.4 | Server PATCH with 120 days + 61-day extension | 400 naming 181 | pass | F |
| 7.5 | Extension entered on the form | field exists | **fail (F4)** — no field | B |
| 7.6 | End-of-probation email sweep | — | not testable in one session | — |

## 8. KPIs after the data step

| # | Case | Expected | Result | How |
| --- | --- | --- | --- | --- |
| 8.1 | Imran opens performance, KPIs and My performance | 200 each | pass | F |
| 8.2 | Faisal Mehmood, Lubna Arif, Yusra Kamal | `principalName: Imran Qureshi`, `canRate: true` | pass | F |
| 8.3 | Old `teacher_principals` rows | Rukhsana ×2 and Tariq ×1 ended; Imran's rows current | pass | DB |

## 9. Console, network and regressions

| # | Case | Expected | Result | How |
| --- | --- | --- | --- | --- |
| 9.1 | No 5xx on any request touched | none | pass | B (network) |
| 9.2 | Console | only the tester's own deliberate 4xx requests | pass | B |
| 9.3 | Part A overlap panel | "176 clashes across 41 teachers", Fauzia Sattar listed | pass | F |
| 9.4 | Chat pages and conversations API | 200 | pass | F |
| 9.5 | Responsive and dark mode | — | not tested | — |

## QA round 1 findings

| # | Severity | Finding |
| --- | --- | --- |
| F1 | high | `/dashboard/hr/leave` still uses `/api/school/hr/leave-requests` (checks only `hr.write`). HR can file and decide leave without the chain, the campus check, or the holiday, overlap and quota refusals. |
| F2 | medium | Campus-bound HR cannot create staff calendars from the screen (button sends `{}` → 403). The "every campus" rule dropdown is shown to campus-bound HR but can only fail. |
| F3 | medium | Leave types have no create, edit or retire controls. The routes are gated on `hr.*` rather than `leave.manage`. |
| F4 | low | The probation extension has no field on the HR staff form. |
| F5 | low | On the self-service form, an error stays after the dates change, and "Days used" never fills in. |

## Data written to Askari by QA round 1

| Table | Row | Detail | State |
| --- | --- | --- | --- |
| `leave_requests` | `b42a59f7` | Adnan Sheikh, Casual, 2026-11-09 to 11-10, 2 days | approved by Bilal Hussain |
| `leave_requests` | `ebd887b6` | Nasreen Akhtar, Casual, 2026-12-24 to 12-25, 1 day (filed by Rizwan under `skip`) | approved by Wajahat Ali |
| `leave_requests` | `c35609db` | Nasreen Akhtar, Casual, 2026-11-09, 1 day (old-route test for F1) | cancelled by Rizwan Shaikh |
| `leave_requests` | `d474abfc` | Farah Siddiqui, Unpaid, 2026-11-09, 1 day (override test) | cancelled (withdrawn by Farah) |
| `staff_calendars` | `fdbcccbd`, `4d006157` | Main Campus, teaching and non-teaching | kept |
| `staff_calendar_overrides` | `68cb5048` | Main teaching calendar: Iqbal Day cancelled for `section_head` only; notify off | **kept, still in force** |
| `branch_leave_settings` | +1 | Main Campus, ended on `include` (same answer as the default) | kept |
| `emergency_login_tokens` | +10 | all consumed | — |

Nothing else was written, and nothing was deleted.

---

# QA round 2 — against live build `90311989dbd6`

Run 17 September 2026, after the round-1 fixes merged as PR #99. The build id
was confirmed twice through `/api/internal/build`; no local server was used, so
the verdict is about the code the school is actually running. Seven emergency
links, `used_at` checked before each, all consumed: Rizwan Shaikh (HR, Main),
Uzma Tariq (HR, Junior), Adnan Sheikh (teacher, Main), Bilal Hussain
(coordinator, Main), Farah Siddiqui (section head, Main), Asad Mahmood (school
admin), Imran Qureshi (principal, Main).

**Verdict: do not ship until N1 is fixed.** F1–F5 are all fixed and none of them
could be broken. N1 is the read half of F2's own contract.

The Iqbal Day override (`staff_calendar_overrides` row `68cb5048`) was left
alone by the product owner's instruction, so cases 6.5 and 6.6 were not re-run.
It is still in force on the Main teaching calendar.

## F1–F5

| | Finding | Status |
| --- | --- | --- |
| F1 | high — the legacy HR leave door | **fixed.** `POST` and `PATCH` on `/api/school/hr/leave-requests` both **410 `moved`**, including the two shapes that succeeded in round 1. `/dashboard/hr/leave` calls `GET /api/school/leave/requests?scope=all` and `POST /api/school/leave/requests` and **never** the old path; with Show = All there is no Approve/Reject column at all. Holiday (422), overlap (409) and quota (422) all arrive on the new path |
| F2 | medium — campus-bound HR calendars | **fixed** for the write. The button names the campus — *"Create both calendars for Askari Junior Campus"* — and the school-wide option renders as read-only text for a campus-bound caller. **See N1** for the read |
| F3 | medium — leave-type CRUD | **fixed.** Created, edited and retired one in the UI; a retired row shows struck-through with a **Retired** badge and an **Offer again** button, and drops out of both forms' dropdowns. `leave.read` without `leave.manage`: 200 on read, 403 on write |
| F4 | low — probation extension | **fixed.** A *"Probation and leave entitlement"* card with **Extended by**; 2026-09-16 + 120/60 → *"Ends 2027-03-14"*; 120 + 61 refused on screen and **400** on the server, both naming 181 |
| F5 | low — the self-service form | **fixed.** "Days used" fills from `GET /api/school/leave/count`, and the stale error clears the instant a date changes, on both forms |

## Re-tested from round 1

| # | Case | Result |
| --- | --- | --- |
| 1.1–1.9 | Section Head role, sidebar, redirects, rank 45, the six 403s, KPI board | pass. **1.7 refined:** the ban is **400 `invalid_body`** without a `reason` and **403 `refused`** with one — round 1's "403" needed the reason field to be reached |
| 2.1–2.4, 2.6 | one head per campus, the four 409s, no duplicate warning | pass |
| 2.7 | the 409 as a sentence in the users UI | **now pass** (untested in round 1). Pink banner above Save: *"Askari Main Campus already has a Principal, Imran Qureshi…"*; the DB role is unchanged |
| 3.1, 3.4, 3.6 | teacher form and chain, approver's queue, approve by button | pass — `5480bbb9` approved, `decided_by` Bilal Hussain |
| 3.5, 3.8–3.12 | out-of-chain, wrong-campus and teacher refusals | pass — 403 `wrong_campus` for Bilal **and** Imran on a Junior request; 409 on withdrawing somebody else's, nothing changed |
| 4.1, 4.3, 4.4 | holiday, overlap, quota | pass on both forms; Apply disabled with the arithmetic on screen |
| 5.4, 5.5 | HR on the decision endpoint; HR via the old PATCH | pass — 403 and **410** |
| 6.1, 6.3 | campus-bound calendars; cross-campus and school-wide writes | pass — see N1 for the read |
| 8.1–8.3 | KPIs after the data step | pass — Imran 30 current rows, Rukhsana 2 and Tariq 1 ended |
| 9.1–9.4 | 5xx, console, Part A overlap panel, chat | pass — 487 requests, **zero 5xx**; 61 console errors, every one a deliberate 4xx |

## New this round

| # | Case | Expected | Result | How |
| --- | --- | --- | --- | --- |
| 5.6 | what `/dashboard/hr/leave` actually calls | the new path | pass — `hr/leave-types`, `leave/requests?scope=all&status=pending`, `hr/staff?status=active`. Zero calls to `hr/leave-requests` | B |
| 5.7 | the legacy `GET` after the 410s | — | collection → 200, campus-scoped; `GET /[id]` on another campus → **404**; `DELETE` → 405. No caller anywhere in `app/` or `components/` | F |
| 6.3b | the "every campus" option offered to somebody who cannot use it | not offered | **fixed** — read-only text for both HR members; the only `<select>` is their own campus | B |
| 7.7 | a valid probation save computes the end date | on write | pass — 120 + 60 from 2026-09-16 → `probation_ends_on 2027-03-14`, exactly +180. Reverted afterwards | B + DB |
| 9.5 | `GET /api/school/leave/count` and `useLeaveCount` | exercised, no 42702/42703 | pass — self 200; on a holiday 200 with `holidayProblem`; **another campus's staff 403 `wrong_campus`**, so the counter cannot be used to read another campus's calendar; another person as a teacher 403; bad dates 400 | F + B |
| 9.6 | responsive, 1440 / 1280 / 1024 / 375 | — | **N3** | B |
| 9.7 | dark mode | — | **not tested.** The theme is not driven by `prefers-color-scheme`, so pane emulation does nothing; the real control is in Settings and would have written to the school | — |

## Round 2 findings — all three fixed in this round

### N1 — medium — a campus-bound HR manager could read the other campus's staff calendar and its overrides

As Uzma Tariq (`hr_manager`, bound to Junior Campus), pressing **Create both
calendars** made the Calendar dropdown gain Main Campus's two calendars, and
selecting one rendered Main's private override — *"Iqbal Day · Does not apply ·
Section Head"*. At the API:

```
GET  /api/school/staff-calendars                       -> 200, Junior only      (correct)
GET  /api/school/staff-calendars/fdbcccbd-.../overrides -> 200, Main's override (leak)
POST /api/school/staff-calendars/fdbcccbd-.../overrides -> 403                  (correct)
```

Two read-side causes, both confirmed in the source before anything was changed:

- `lib/staff-calendar-queries.ts` — `ensureStaffCalendars` ended
  `return listStaffCalendars(locationId);` with no branch argument, so the
  **POST response** handed a campus-bound caller every campus's calendars and
  their ids. A reload cleared them again, which is what made it easy to miss.
- `app/api/school/staff-calendars/[calendarId]/overrides/route.ts` — the `GET`
  checked the tenant and stopped there. The `POST` beside it has called
  `calendarWriteRefusal` since round 1.

**Fixed.** A new `calendarIsVisible(scope, branchId)` states the read rule once —
the same rule `listStaffCalendars` filters on, so the list and the detail cannot
drift apart — and the GET answers **404, not 403**, so a campus-bound reader
does not learn that the other campus's calendar exists. `ensureStaffCalendars`
now takes `visibleBranchIds` and the route passes `effectiveBranchIds(scope)`.
`check-sprint33b` gained two assertions for it.

### N2 — medium — a refused filing showed nothing where the person was looking

Filing Adnan for 10–11 Nov (overlapping his approved 9–10 Nov) returned a good
409 sentence and **nothing changed on screen**. Measured in the live page
immediately afterwards:

```
alert.getBoundingClientRect().top  =  -552   // the error, off-screen
button.getBoundingClientRect().top =   396   // "File request", in view
innerHeight                        =   768
```

The self-service form is the same shape (`top: -285`, Apply at `472`). The
holiday case was masked because `holidayProblem` already paints beside the
button; the overlap and the server-side quota refusal had no such preview, so
the screen simply went quiet — and the obvious response to that is to press the
button again.

**Fixed.** Both forms now carry their own refusal beside their own button —
`fileError` in `LeaveManager`, `applyError` in `LeaveSelfService` — while the
page-level banner keeps what is genuinely about the page: loading, and
withdrawing. Both clear when the dates change, alongside the F5 clearing.

### N3 — low — "Add a leave type" was clipped below ~1300px

| Viewport | Button width | Content vs box | What you saw |
| --- | --- | --- | --- |
| 1440 | 130px | 32 / 32 | fine |
| 1280 | 115px | **36** / 32 | two lines, spilling |
| 1024 | 83px | **46** / 32 | a blue pill reading only **"leave"** |
| 375 | 57px | **56** / 32 | three lines, overlapping *Seed defaults* while loading |

`CardTitle` lays its action out beside the description with no `flex-shrink` of
its own, so the button is what gives. **Fixed** at the call site, with
`shrink-0` on the row and `whitespace-nowrap` on both buttons.

## Not tested, and why

- **6.5 / 6.6** — the override applying to one role and not another: excluded by
  the product owner's instruction about row `68cb5048`.
- **6.7 Notify** and **7.6 the end-of-probation sweep** — both need a timer or a
  mail sink.
- **3.14 / 3.15** — no fixture (a teacher with two coordinators; a junior
  teacher with no login).
- **6.10** — a reporting-line save; the screen was read, the write avoided.
- **The permission matrix** — all four `leave.*` keys were confirmed in
  `PERMISSIONS`, in `DEFAULT_ROLE_PERMISSIONS` and in the live
  `role_permissions_permission_check`, but the matrix was not saved at Askari:
  that is a real school-wide write.
- **Dark mode** — see case 9.7.

## Data written to Askari by QA round 2

| Table | Row | Detail | Final state |
| --- | --- | --- | --- |
| `leave_types` | `9199ac23` | "QA Round 2 Study Leave", 7 days, unpaid | **retired** (`is_active false`). Left behind — retiring is the product's own answer and there is deliberately no delete |
| `leave_requests` | `5480bbb9` | Adnan Sheikh, Casual, 2026-11-16 → 11-17, 2 days | approved by Bilal Hussain; kept as the case 3.6 evidence |
| `staff_calendars` | `ba98fe0b`, `29edf250` | Askari **Junior** Campus, teaching and non-teaching | kept |
| `staff` | `84264968` (Adnan Sheikh) | probation set to 120 + 60, then turned off | **restored exactly** — all six columns back to their prior values |
| `emergency_login_tokens` | +7 | seven sessions | all consumed |

**Nothing was deleted.** `staff_calendar_overrides` is unchanged — one row,
`68cb5048`, `applies_to_roles ['section_head']`, `is_cancelled true`,
`notify false`, `notified_at null`. `branch_leave_settings` is unchanged (Main,
`include`). No new `school_users`, no new `school_invitations`.

Refused writes that wrote nothing, each verified by reading the table back:
2× legacy POST (410), 1× legacy PATCH (410), 2× holiday (422), 1× overlap (409),
2× quota (422), 6× cross-campus or school-wide (403), 1× probation ceiling
(400), 4× duplicate head (409), 1× invitation (409), 1× chat ban (403).
