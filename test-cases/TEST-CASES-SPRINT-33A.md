# Test cases — Sprint 33a: the three defects, the campus gap and the two notification faults

Requirement: `SPRINT-33-SPEC.md` Part A; STATE.md §5cg is the handover entry.
Tenant used for QA: **Askari School System** (`askari-school-system`, two
campuses, five principals, two branch admins, two HR managers).
Run against the **live deployed build `f649ee5a18e6`**, confirmed through
`/api/internal/build`, not against a local server.

**Sessions are real members**, opened with `scripts/qa-emergency-link.mjs`.
`QA_BASE_URL` must be the **subdomain** — `https://askari-school-system.schoolhub.codexmill.com`.
The apex host answers "School not found" by design: `slugForRequest` returns
`null` on the platform host, so `?school=` is never consulted there.

**Every browser case is run on a hard-loaded page** — type the URL, then act.
Where the Browser pane would not paint, page truth was read with
`javascript_tool` (`fetch`, `innerText`, DOM queries) rather than screenshots.

Legend: **A** = automated (`check-sprint33a`), **B** = browser.

## 1. A1 — a teacher in two overlapping periods

| # | Case | Expected | How |
| --- | --- | --- | --- |
| 1.1 | `slotsOverlap` boundary cases (touching, nested, disjoint) | half-open `[start,end)` | A |
| 1.2 | `listTeacherBusySlots` / `listTeacherOverlaps` execute against the real schema | no 42703/42702 | A |
| 1.3 | Cross-schedule overlap: teacher takes Year 1 A P3 (09:05–09:45, Standard); place her in Nursery A P2 (08:40–09:20, Early Years) | **409**, message names the other class, both period names and both clock times | B (fetch) |
| 1.4 | Same-slot clash (identical `slot_id`) | 409, short form naming class and period | B (fetch) |
| 1.5 | A refused placement writes nothing | `timetable_entries` unchanged | B + DB |
| 1.6 | Builder shows the clash **before** Save, from the same helper; Save disabled | inline warning, button disabled | B — **not exercised**, see note |
| 1.7 | `/dashboard/academics/timetable` overlap panel lists existing clashes | "Teachers booked twice at the same time", count of clashes and teachers, current year only | B |
| 1.8 | The product owner's pair appears | `Fauzia Sattar · Monday — Nursery A P2 (8:40–9:20)` vs `Year 1 A P3 (9:05–9:45)` | B |
| 1.9 | Panel is silent when there is nothing to report | no card | A (code) / not reproducible at Askari |
| 1.10 | Panel scoped to the grades the caller may see | a head sees only their own | not tested |

Note on 1.6: Askari's grid is 100 % dense (1025/1025 cells), and the pane would
not paint for clicking, so the dialog was not driven. The server refusal (1.3)
and the shared helper were verified instead. **This is the one A1 clause still
unproved in a browser.**

## 2. A2 — the lost attachment

| # | Case | Expected | How |
| --- | --- | --- | --- |
| 2.1 | Teacher posts multipart with a PNG to a parent thread | 201 | B (fetch) |
| 2.2 | Parent polls `/messages` every 35 ms from a separate live session; first response containing the message | **carries the attachment in the same payload** | B (network) |
| 2.3 | Message and attachment commit together | no fetch ever returns the message alone | B (2.2) |
| 2.4 | Parent's rendered thread shows the file | `qa-sprint33a.png · 1 KB` | B |
| 2.5 | A file with no words stores "Sent a file." | body never empty | not tested |
| 2.6 | A parent may not attach (`staffOnlyProblem`) | 403 | not tested |

## 3. A3 — the chime

| # | Case | Expected | How |
| --- | --- | --- | --- |
| 3.1 | Unread thread: `GET /chat/signals?since=` | returns the signal | B (fetch) |
| 3.2 | `POST /read`, then the same signals query | returns **nothing** for that thread | B (fetch) |
| 3.3 | Reading deletes the signal rows | row count drops | DB |
| 3.4 | Hard-load a portal page after reading, audio armed | **no chime** | B (oscillator counter) |
| 3.5 | A genuinely new message arrives while on a non-chat page | **exactly one** chime | B |
| 3.6 | A burst of signals | one chime, not one per id | not tested |
| 3.7 | Message into the thread already open on screen | **no chime**, message still appears | B |
| 3.8 | `markConversationRead` also resets `digest_count` | 0 after read | DB |

## 4. A4 — the digest and its deep link

| # | Case | Expected | How |
| --- | --- | --- | --- |
| 4.1 | `/parent/chat?c=<id>` opens that thread | requested thread selected | B |
| 4.2 | `?c=` with the **older** of two threads | opens the older one, not the newest | B |
| 4.3 | `/parent/chat?conversation=<id>` still works (Sprint 29 bell) | same thread opens | B |
| 4.4 | `DIGEST_INTERVAL_MINUTES` is 1440 | one email per person per day | **not testable in one session** |
| 4.5 | At most five reminders per participant row | sixth is refused | **not testable in one session** |
| 4.6 | Reading resets the count | `digest_count` → 0 | DB (3.8) |
| 4.7 | The email carries the `?c=` link for the recipient's own portal | deep link in a real email | not tested |
| 4.8 | `digestCandidates` executes against the real schema | no 42703 once `0046` is applied | A |

## 5. A5 — the campus gap on leave approval

| # | Case | Expected | How |
| --- | --- | --- | --- |
| 5.1 | Campus-bound approver (`hr_manager`, Main) `PATCH`es a **Junior** request | **403 `wrong_campus`** | B (fetch) |
| 5.2 | Same person `GET`s that id | **404** (not 403 — existence is not disclosed) | B (fetch) |
| 5.3 | Same person `PATCH`es a request at **their own** campus | **200**, `approved`, `decidedAt` set | B (fetch) |
| 5.4 | The decision lands with the right author | `decided_by` = the approver | DB |
| 5.5 | The other campus's request is untouched | still `pending` | DB |
| 5.6 | Pending list for a campus-bound caller | only their own campus | B |
| 5.7 | Branch Admin `GET`s another campus's request | 404 | B (fetch) |
| 5.8 | Branch Admin `GET`s their own campus's request | 200 | B (fetch) |
| 5.9 | Branch Admin `PATCH`es any request | **403 `forbidden`** — no `hr.write` by default, so the campus guard is never reached | B (fetch) |
| 5.10 | School-wide caller (`auth.branchId === null`) reaches both campuses | both visible and decidable | B (fixtures filed by the school admin) |

Note on 5.9: `DEFAULT_ROLE_PERMISSIONS` gives `branch_admin` only `hr.read`, and
Askari has no `role_permissions` overrides. The spec's A5 acceptance is worded
around a Branch Admin; today the guard is exercised by `hr_manager`. **Part B's
decision 3 — "Branch Admin approves everything for non-teaching staff" — needs
its own approval key before that wording becomes true.**

## 6. A6 — days used is calculated

| # | Case | Expected | How |
| --- | --- | --- | --- |
| 6.1 | Only *From* set | field stays empty (span is 0) | B |
| 6.2 | Both dates set | fills with the count | B |
| 6.3 | The hint says what it counted | `Counted: 5 days (5 October – 9 October). Change it for a half day.` | B |
| 6.4 | Hand-typed half day | `0.5` is kept, not overwritten | B |
| 6.5 | Changing a date after a hand-typed value | recounts (a stale half day is not preserved) | not tested |
| 6.6 | Saving a half-day request | stored as 0.5 | not tested |

## 7. Console, network and regressions

| # | Case | Expected | How |
| --- | --- | --- | --- |
| 7.1 | Every screen touched | no 5xx (193 requests recorded) | B (network) |
| 7.2 | Console on timetable, leave, parent dashboard, parent chat | no product errors; only the tester's own 409/403/404 fetches | B (console) |
| 7.3 | Loaders on new/changed routes | `check-loaders` passes | A |
| 7.4 | Part A adds no permission key | every `PERMISSIONS` key still in `0045` | A |
| 7.5 | Responsive and dark mode where layout changed | overlap panel and leave hint | not tested |
