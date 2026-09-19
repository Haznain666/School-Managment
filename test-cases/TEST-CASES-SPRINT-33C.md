# Test cases — Sprint 33c: the portal work

Requirement: `SPRINT-33-SPEC.md` Part C (items C1–C4). STATE.md §5ci is the handover entry.
Tenant used for QA: **Askari School System** (`askari-school-system`), two campuses — Askari Main
Campus (21 sections) and Askari Junior Campus (8 sections).

**QA round 1** was run against the **live deployed build `44a4ad50668d`**, confirmed through
`GET /api/internal/build`. Migration `0049` was applied before the run.
Verdict: **do not ship until F1–F4 are fixed.** The findings are at the end of this file.

**Sessions are real members**, opened with `scripts/qa-emergency-link.mjs` and `QA_BASE_URL` set to
the **subdomain** `https://askari-school-system.schoolhub.codexmill.com`. Nine links were minted,
each navigated once. The apex answers "School not found" — schools are
`<slug>.schoolhub.codexmill.com`.

Where the Browser pane would not composite, page content was read with `javascript_tool`
(fetch, innerText, querySelectorAll) rather than screenshots.

Legend: **B** = browser (UI), **F** = browser fetch against the live API, **DB** = read back through
an authenticated API that reports the stored row.

Fixtures:
- Asad Mahmood — School Administrator, school-wide (`schooladminall1`)
- Imran Qureshi — Principal, Main (`principalmain2`); Kamran Baig — Vice Principal, Main (`viceprincipalmain1`)
- Farah Siddiqui — Section Head, Main (`principalmain1`); Bilal Hussain — Coordinator, Main (`coordinatormain1`)
- Hina Aslam — teacher, **Junior** (`teacherjunior1`); Bushra Latif — teacher, Main (`teachermain21`)
- Aftab Awan — parent (`parentjunior18`), two children on **different campuses**:
  Faizan Awan (Year 7 A · Main) and Zainab Awan (Nursery A · Junior)
- Aiza Memon — student, Year 3 — A · Main (`asst-2026-0279@students.askari-school-system.invalid`)
- Year 3 — A, Main: section `cb664160-…`, year 2026-2027 `8df7b9de-…`, 40 live entries
- Laraib Ahsan — approved Casual Leave 2026-10-05 → 2026-10-09; Iqbal Day 2026-11-09 (gazetted)

---

## 1. C1a — the parent's timetable

| # | Case | Expected | Result | How |
| --- | --- | --- | --- | --- |
| 1.1 | Sidebar carries **Timetable** between Results and Fees | entry present, links `/parent/timetable` | pass | B |
| 1.2 | Hard-load `/parent/timetable` | 200, header + child switcher render | pass | B |
| 1.3 | **The grid renders for a child with a placement** | Faizan Awan's Year 7 A week | **FAIL — F1.** "No class placement is recorded for Faizan Awan this year" | B |
| 1.4 | Same for the second child | Zainab Awan's Nursery A week | **FAIL — F1.** same card | B |
| 1.5 | Child switcher changes the child | `?child=` changes, heading and body follow | pass (body is the F1 card either way) | B |
| 1.6 | Parent with two children at **different campuses** renders something honest | no throw, both children offered | pass — no throw, both chips present | B |
| 1.7 | A parent with **no enrolled child** | honest empty card, switcher kept | **not exercised** — all 55 Askari parent accounts have an enrolled child | — |
| 1.8 | `?child=` naming a student the parent does not own | "That student is not linked to your account." | **not exercised** — F1 returns first | — |
| 1.9 | **The loader** — shape, not a spinner | SkeletonPageHeader + SkeletonTable streamed ahead of content | pass — `animate-shimmer` at byte 18205, content at 32881; 49 shimmer shapes, one `rounded-card border border-line` table, **zero** `animate-spin` | F |
| 1.10 | The grid uses the child's own grade's schedule | `listSlotsForSection` | pass by reading; **not exercised** in the browser (F1) | — |
| 1.11 | Console / network on the route | no app errors, no failed requests | pass | B |
| 1.12 | 375 px width | no page-level horizontal overflow | pass — `scrollWidth` 375 at `clientWidth` 375 | B |
| 1.13 | Contrast: `/student/timetable` for a pupil in the same section | full grid | pass — Year 3 — A week renders in full | B |

## 2. C1b — the supersede, and what it must not do

| # | Case | Expected | Result | How |
| --- | --- | --- | --- | --- |
| 2.1 | Read Year 3 — A's week before the change | 40 entries; Mon Period 1 = English · Tooba Ansari, entry `43194881…` | pass | F |
| 2.2 | Builder refuses a teacher already in an overlapping period | named refusal | pass — "That teacher already takes Year 6 — A in Period 1 (7:45 AM – 8:25 AM), which overlaps this period." | B |
| 2.3 | **Change the teacher** on Mon Period 1 to Amna Zaheer, save | cell shows the new teacher **exactly once** | pass — one row, Amna Zaheer | B + F |
| 2.4 | The cell is not doubled | entry count unchanged | pass — still 40 | F |
| 2.5 | The old teacher is gone from that cell | Tooba Ansari no longer drawn there | pass — admin grid and `/student/timetable` both show Amna Zaheer once | B |
| 2.6 | **The supersede actually fires** (old row closed, new row opened) | a second row, new id | **not exercised.** Same row id `43194881-4687-42bb-bc38-beb10ee1c0ac` came back — an in-place correction. `0049` gives every existing row `effective_from = CURRENT_DATE` = today, and the route supersedes only when `standing.effectiveFrom < today`. Reachable from 2026-09-19 | F |
| 2.7 | A **room** change is a correction, never a second row | one row, new room | pass — Mon Period 2 room set to "Lab B (QA 33c)"; id `2fe539b1…` unchanged, count still 40 | B + F |
| 2.8 | The pupil's own view agrees | Amna Zaheer once, "Lab B (QA 33c)" | pass | B |
| 2.9 | The parent's view agrees | same grid | **not exercised** — F1 | — |
| 2.10 | The partial unique index under a real second row, and `ON CONFLICT … targetWhere` | no 23505, no "no unique or exclusion constraint matching" | **not exercised** — needs 2.6 | — |

## 3. C2 — the receipt

| # | Case | Expected | Result | How |
| --- | --- | --- | --- | --- |
| 3.1 | Parent portal, **paid** voucher (Faizan Awan, ASST-2026-09-0153) | **Print receipt** only, no voucher print | pass | B |
| 3.2 | Parent portal, **partially paid** (Zainab Awan, ASST-2026-08-0450, 4,072 of 7,225) | **both**, named and distinguishable | pass — "Print voucher" and "Print receipt", plus the bank hint | B |
| 3.3 | Parent portal, **unpaid** | voucher only | pass | B |
| 3.4 | Admin detail page, partially paid (ASST-2026-09-0203) | both buttons | pass | B |
| 3.5 | Admin detail page, paid (ASST-2026-08-0002) | receipt only; no Record payment / Send reminder / Waive | pass | B |
| 3.6 | Admin detail page, unpaid (ASST-2026-09-0171) | voucher only | pass | B |
| 3.7 | **Exactly one PrintSheet is mounted, ever** | 1 | pass — one `[data-print-root]` before the click, after the click, and after a second click | F |
| 3.8 | Pressing the button prints once | one `window.print()` per press | pass — stub counter 1 then 2 | F |
| 3.9 | No `print:hidden` ancestor above the sheet (STATE §5bd) | none | pass — chain is `bg-white text-black` then `main` then body; exactly one element on the page carries `print:hidden` and the sheet is not inside it | F |
| 3.10 | The receipt reads **RECEIPT** | header "Fee Receipt", badge "RECEIPT · STUDENT COPY" / "· SCHOOL COPY" | pass | F |
| 3.11 | **No bank block** | no IBAN, no A/C, no "How to pay" | pass — regex over the sheet text: false | F |
| 3.12 | **No "valid upto"** | absent | pass — regex false; header carries Issue date / Due date / **Paid on** instead | F |
| 3.13 | Outstanding 0 | "Outstanding 0" | pass | F |
| 3.14 | Every payment with date and mode | "Received on / Mode / Reference / Amount" | pass — "12-Aug-2026 · Cash · — · 4,072" | F |
| 3.15 | **The month is on both documents** | yes | pass — voucher "Fee for: August 2026", receipt "Payment for: August 2026" | F |
| 3.16 | The receipt fits one sheet at A4 | one page | pass — `@page size A4 landscape, margin 8mm`; one `.print-document` measuring 1062 x 358 px against 1062 x 733 px of printable area, two copies side by side in `grid-cols-2` | F |
| 3.17 | **The bulk run** with `document=receipt` | one kind of document, one sheet per voucher | pass — 9 selected gives 1 print root, **6** `.print-document`, **5** `.print-break-after`, 0 vouchers; "Ready to print 6 receipts, one per sheet, two copies each — student and school. 3 were unpaid, cancelled or waived and had nothing to receipt." | F |
| 3.18 | The bulk run is offered from a screen | a link exists | pass — ChallanTable renders "Print vouchers (9)" and "Print receipts"; the second carries `&document=receipt` | B |
| 3.19 | Background graphics are called for | the print-dialog note | pass — "choose A4 landscape and enable Background graphics — without it the table rules and cut lines do not appear on the page." | F |
| 3.20 | A real print dialog / PDF | — | **not exercised** — `window.print()` was stubbed to keep the session alive; layout checked structurally instead | — |
| 3.21 | 375 px width, parent fees | no page-level overflow | pass — the voucher-history table is 550 px inside an overflow-x container; `scrollWidth` stays 375 | B |

## 4. C3 — the recipient picker

| # | Case | Expected | Result | How |
| --- | --- | --- | --- | --- |
| 4.1 | **Admin** composer opens | chips + search + list | pass — All (586), Teacher (42), Coordinator (2), Section Head (3), Vice Principal (2), Principal (2), Branch Administrator (2), HR Manager (2), Accountant (2), Marketing (1), Student (473), Parent (55) | B |
| 4.2 | **Teacher** composer opens | same component | pass — All (586) through School Administrator (1) | B |
| 4.3 | **Parent** composer opens | parent's own reach | pass — All (40), Teacher (36), School offices (4) | B |
| 4.4 | **Student** composer opens | list empty | pass | B |
| 4.5 | A role chip filters | count and options narrow | pass — Teacher chip gives "42 of 586", 42 options | B |
| 4.6 | Search filters | client-side over the resolved list | pass — "Amna" gives "1 of 586"; "Faizan Awan" gives "2 of 586" (the parent and the child); "Zainab" gives "15 of 586" | B |
| 4.7 | Clearing both restores the full list | original count | pass — "586 of 586", 587 options including the placeholder | B |
| 4.8 | **A student target shows parent's name · class with section** | yes | pass — "Abdullah Alvi — Pervez Alvi · Pre-Nursery A · Askari Main Campus" | B |
| 4.9 | **A parent target shows their children's names** | yes | pass — "Aftab Awan — Faizan Awan, Zainab Awan" | B |
| 4.10 | Staff carry role and campus | yes | pass — "Adnan Sheikh — teacher · Askari Main Campus" | B |
| 4.11 | A desk carries no role | inboxes grouped separately, no role word | pass — parent chip "School offices (4)"; options "School Office — The school will answer", values `inbox:office` / `inbox:accounts` / `inbox:principal` | B |
| 4.12 | **A recipient filtered away is cleared** | selection reset, not hidden | pass — selected Amna Zaheer, then typed "Rukhsana"; list went to "0 of 586" and the select value became empty | B + F |
| 4.13 | **An empty portal keeps the existing copy, not an empty chip row** | copy shown, no chips | pass — student portal: 0 chips, no search box, "There is nobody you can start a conversation with right now. You can still reply to anything the school sends you." | B |
| 4.14 | **Sending still works** | thread created | pass — parent to School Office; POST then GET returns a `role_inbox` conversation, counterparty "School Office" | B + F |
| 4.15 | **`initiateProblem` still refuses an unreachable target** | 403 | pass — `targetId` all-zero UUID gives 403 `refused`, "You cannot start a conversation with them." | F |
| 4.16 | …and refuses the caller over themselves | 403 | pass — same refusal | F |
| 4.17 | Parent's reach is their own children's teachers | no other class's staff | pass — 36 teachers, every one "Teaches Year 7 A · Askari Main Campus" or "Teaches Nursery A · Askari Junior Campus" — exactly her two children's classes | F |
| 4.18 | Console / network across all four portals | clean | pass — the only console errors were the 4xx of deliberate probes | B |

## 5. C4 — availability and substitutes

| # | Case | Expected | Result | How |
| --- | --- | --- | --- | --- |
| 5.1 | "Cover for the day" on the **School Administrator**'s dashboard | present | pass | B |
| 5.2 | …on the **Vice Principal**'s | present | pass | B |
| 5.3 | …on the **Section Head**'s | present | pass | B |
| 5.4 | …on the **Coordinator**'s | present | pass | B |
| 5.5 | …on the **Principal**'s | present | **inferred, not visually confirmed** — GET answers 200 and the role holds the key; the panel was seen for the four roles above and the gate is one shared line | F |
| 5.6 | **Not** on the **Branch Administrator**'s | absent | pass — absent, and GET **and** POST both 403 `forbidden` | B + F |
| 5.7 | A **Teacher** reaching the route | 403 | pass — GET and POST both 403 `forbidden` | F |
| 5.8 | `timetable.substitute` on the permissions matrix | one row, right defaults | pass — "Arrange a substitute teacher for one day": School Admin yes, Branch Admin no, Principal yes, Vice Principal yes, Section Head yes, Coordinator yes, Teacher no, Accountant no, HR no, Marketing no | B |
| 5.9 | **The CHECK admits the new key by attempt** | a saved override, not a 23514 | pass — granted it to Branch Administrator on `/dashboard/settings/permissions` and saved: `PATCH /api/school/permissions` gives **200**. Reverted; `GET /api/school/permissions` then reports `overrides: []`, so the school is back to the platform default exactly | B + F |
| 5.10 | Pick a date and a period, free teachers appear | a list | pass — Year 3 — A, 2026-09-21, Period 1: 16 free, 26 busy, 42 candidates | B + F |
| 5.11 | **A teacher in an overlapping slot from another period structure is excluded** | excluded, clash named | pass — Period 1 is 07:45–08:25; busy reasons include "Teaching Nursery — A, Period 1 (8:00 AM – 8:40 AM)" and "Teaching Prep — A, Period 1 (8:00 AM – 8:40 AM)" — different structures, overlapping minutes. Part A's `slotsOverlap` | F |
| 5.12 | **A teacher on approved leave is excluded** | excluded, leave named | pass — 2026-10-05, Laraib Ahsan: free false, reason "On Casual Leave"; free count drops 16 to 15 | F |
| 5.13 | **A holiday is handled** | nobody free | pass — 2026-11-09 (Iqbal Day): free **0**, and the 16 who would have been free read "Iqbal Day". See F6 for the other 26 | F |
| 5.14 | **A weekend is refused with a 422**, not an empty list | 422 | pass — Sat 2026-09-19 and Sun 2026-09-20 both 422 `not_a_school_day`, "Nothing is timetabled at the weekend, so there is no period to arrange cover for." POST refuses the same way | F |
| 5.15 | A malformed date | 400 | pass — 400 `invalid_query`, "Choose a date." | F |
| 5.16 | A section id outside the caller's reach | 404 | pass — 404 `not_found`, "That class is not one you can see." (GET and POST) | F |
| 5.17 | A slot id that does not exist | 404 | pass — 404 `not_found`, "That period does not exist." | F |
| 5.18 | A busy teacher named in the POST body | 409, re-derived server-side | pass — 409 `not_free`, "Adnan Sheikh is not free in Period 1 on that date. Teaching Year 4 — A, Period 1 (7:45 AM – 8:25 AM)" | F |
| 5.19 | The cell's own teacher named in the POST body | refused | pass — 409 `not_free` naming Amna Zaheer. The `already_theirs` 422 is unreachable for the standing teacher, who is always "teaching" that period — a dead branch, not a defect | F |
| 5.20 | **Send as substitute records the cover** | a row, shown against the period | pass — substitution `90f26c75-c838-40e6-ac6e-464be9a4d9da`; the panel then reads "Covered by Hina Aslam" and the button becomes "Change cover" | B + DB |
| 5.21 | **The teacher gets the bell notification** | yes | pass — "You are covering Year 3 — A / You have been asked to cover Year 3 — A on 18-Sep-2026, Period 1 (7:45 AM – 8:25 AM). Arranged by Asad Mahmood." | B |
| 5.22 | **The teacher gets the chat message** | yes | pass — thread from Asad Mahmood, subject "You are covering Year 3 — A", same body | B |
| 5.23 | **A substitution never touches `timetable_entries`** | grid unchanged | pass — Year 3 — A still 40 entries; Friday Period 1 still `5e7a893c…` · Amna Zaheer | F |
| 5.24 | …and never appears on the teacher's own grid | absent | pass — `/teacher/timetable` for Hina Aslam shows nothing at Friday Period 1. Which also means the covering teacher has **no screen** showing her cover — STATE §5ci names this as an open item | B |
| 5.25 | **A head sees their branch** | one campus | pass — Principal Imran Qureshi (Main): 30 candidates, every one Askari Main Campus | F |
| 5.26 | **A Coordinator sees their own teachers** | the chain, not the campus | pass — Bilal Hussain: 2 candidates, both Main Campus, and he is not in his own list | F |
| 5.27 | **A Section Head sees their coordinators' teachers** | the chain | **not exercised** — Farah Siddiqui's candidate list is empty (0 free, 0 busy): no coordinators are linked to any Section Head at Askari, the same data gap Part B's case 1.4 recorded | F |
| 5.28 | **Reach beyond scope — the teacher pool** | refused | **FAIL — F2.** A school-wide caller is offered every campus's teachers for a class at one campus, and the write is accepted | B + F |
| 5.29 | **Reach beyond scope — the class list** | refused | **FAIL — F3.** Vice Principal, Section Head and Coordinator, all campus-bound, each see 29 sections (both campuses) and can read the other campus's day | F |
| 5.30 | The class picker names the campus | disambiguated | **FAIL — F4.** Six identical pairs of labels | B + F |
| 5.31 | Console / network on the dashboard | clean | pass — one POST to the substitutes route, 200; no app-level JS errors | B |

## 6. Cross-cutting

| # | Case | Expected | Result | How |
| --- | --- | --- | --- | --- |
| 6.1 | Live build id | `44a4ad50668d` | pass | F |
| 6.2 | Console errors across every screen opened | none from the app | pass — the only errors were `ERR_BLOCKED_BY_CLIENT` on one static-asset load (the QA browser's own blocking; a reload served them) and the 4xx of deliberate probes | B |
| 6.3 | Failed network requests | none | pass | B |
| 6.4 | Tenancy — cross-school | nothing from another school | pass by probe and construction: `location_id` is taken from `auth` in every new statement; an all-zero UUID is refused 404 on section and slot and 403 on a chat target. **A second school's real id was not used** | F |
| 6.5 | Tenancy — cross-campus | see F2, F3, F5 | **FAIL** | F |
| 6.6 | 375 px on the parent screens | no page-level overflow | pass | B |
| 6.7 | Dark mode | — | **not exercised** | — |

---

## Findings

### F1 — `/parent/timetable` never renders a grid, for any child, at any school (blocker)

C1's first acceptance criterion. `app/(parent)/parent/timetable/page.tsx:112` calls
`getStudentPlacement(locationId, selected.studentProfileId, activeYear.id)`, but that function's
second parameter is a **`school_users.id`** — `lib/academics-queries.ts` filters
`eq(studentProfiles.schoolUserId, schoolUserId)`. A `student_profiles.id` can never equal a
`student_profiles.school_user_id`, so the statement returns zero rows for every child and the page
always takes the `placement === null` branch.

Both ids are `string`, so `typecheck` cannot see it, the page returns 200 and the console is clean.
`/student/timetable:40` passes `profile.id` — a `school_users` row from `getSchoolUserByUid` — and is
correct, which is why the same section draws perfectly one portal over.

**Reproduce.** Sign in as `dispatchglobally1+parentjunior18@gmail.com` (Aftab Awan).
`/parent/children` shows *Faizan Awan — Year 7 A · Roll 11 · Askari Main Campus* and
*Zainab Awan — Nursery A · Roll 10 · Askari Junior Campus*. `/parent/timetable` shows, for both:
"No class placement is recorded for … this year, so there is no timetable to show yet."
Then sign in as `asst-2026-0279@students.askari-school-system.invalid` (Year 3 — A) and open
`/student/timetable`: the full week draws.

**File:** `app/(parent)/parent/timetable/page.tsx`.

### F2 — the substitute panel offers, and accepts, a teacher from a different campus (high)

`app/api/school/timetable/substitutes/route.ts` narrows the candidate pool by the **caller's** campus
scope (`reachableTeachers(locationId, decider, effectiveBranchIds(branchScope))`) and never by the
campus of the class being covered. For a school-wide account that is every campus, and
`listFreeTeachers` is never given the section at all.

**Reproduce.** As Asad Mahmood (School Administrator): dashboard, Cover for the day, 18/09/2026,
class **Year 3 — A** (Askari **Main** Campus), Period 1, Find cover. The free list contains
**"Hina Aslam · Askari Junior Campus"**. Press *Send as substitute*:
`POST /api/school/timetable/substitutes` returns **200**. The panel then reads "Covered by Hina
Aslam" and substitution `90f26c75-c838-40e6-ac6e-464be9a4d9da` stands.

Hina's bell entry and chat message both read "You have been asked to cover **Year 3 — A** on
18-Sep-2026, Period 1 (7:45 AM – 8:25 AM)" — **with no campus named** — so nothing anywhere tells her
the class is at the other site.

**Files:** `app/api/school/timetable/substitutes/route.ts`; `lib/teacher-availability.ts`
(`listFreeTeachers` takes no section).

### F3 — a campus-bound Coordinator, Vice Principal or Section Head reads the other campus's timetable (high)

The route builds its class list from `visibleScopeFor(auth).gradeIds`, but `scopeForCaller`
(`lib/principal-visibility.ts:109`) returns `UNSCOPED` for **every role except `principal`**. So the
teacher pool is branch-scoped by `resolveBranchScope` while the class list is not scoped at all.

Askari has 21 Main sections and 8 Junior. Through `GET /api/school/timetable/substitutes?date=2026-09-21`:

| Caller (all Main Campus) | sections returned |
| --- | --- |
| Principal Imran Qureshi | **21** correct |
| Vice Principal Kamran Baig | **29** wrong |
| Section Head Farah Siddiqui | **29** wrong |
| Coordinator Bilal Hussain | **29** wrong |

As Bilal Hussain, `...&sectionId=<Junior Nursery A>` returns the other campus's day in full:
"Period 1 English · Aqsa Mumtaz / Period 2 Urdu · Fauzia Sattar / Period 3 Mathematics · Sobia
Nadeem / Period 4 General Knowledge · Aqsa Mumtaz / Period 5 Art and Craft · Fauzia Sattar".

Same shape as Part B round 2's N1, a campus-bound HR manager reading another campus's staff calendar.

**File:** `app/api/school/timetable/substitutes/route.ts` — `listSubstituteSections` should also be
narrowed by `effectiveBranchIds(branchScope)`, not only by `visibleScopeFor`.

### F4 — the class picker cannot tell the two campuses apart (medium)

`listSubstituteSections` in `lib/teacher-availability.ts` selects `branchId` and then builds `label`
from the grade and section names only. Askari has six pairs that collide — **Nursery A,
Pre-Nursery A, Prep A, Year 1 A, Year 2 A, Year 2 B** — one at each campus. Ordered by grade then
section, each pair lands adjacent, so the Cover-for-the-day select shows six pairs of identical,
indistinguishable options out of 29.

A head picks one, sees a day of lessons, names a teacher, and has no way of knowing which campus they
just committed. `branchId` is already in the payload and is unused. The free-teacher list beside it
*does* print the campus ("Hina Aslam · Askari Junior Campus"), so the omission is specifically on the
class.

**File:** `lib/teacher-availability.ts` — `listSubstituteSections`.

### F5 — a campus-bound Principal can open another campus's fee voucher (medium; pre-existing, on a screen Part C changed)

As Imran Qureshi (Principal, Askari Main Campus), `/api/school/students` returns **343** students,
every one Askari Main Campus, and admission number **ASST-2026-0006 is not among them**. Yet
`/dashboard/fees/challans/181de701-f43c-44fb-8377-184d89acf2e0` renders in full for ASST-2026-0006 —
Shahmir Awan, Pre-Nursery B, **Askari Junior Campus** — including the printable sheet carrying that
campus's address and bank details.

The guard is on the student list, not on the voucher record. Part C reworked this page's print
controls but not its access check, so this is almost certainly older than Sprint 33c. Recorded
because it is reproducible.

**File:** the challan detail page under `app/(school-admin)/dashboard/fees/challans/` — the guard,
not the print work.

### F6 — on a gazetted holiday, most teachers are labelled "Teaching ..." (low)

`GET /api/school/timetable/substitutes?date=2026-11-09` (Iqbal Day) correctly returns **free: 0**, and
the 16 who would otherwise be free carry the reason "Iqbal Day". The other 26 still carry
"Teaching Year 4 — A, Period 1 (7:45 AM – 8:25 AM)" — a lesson on a day the school is shut. Nobody
can be selected, so it cannot cause a wrong cover; it is a sentence that is not true.

**File:** `lib/teacher-availability.ts` — the holiday test should win over the timetable test.

---

## Not exercised — named, not passed

1. **The supersede itself (2.6, 2.10).** `0049` gives every pre-existing row
   `effective_from = CURRENT_DATE`, which on the day it is applied is today, and
   `POST /api/school/timetable/entries` supersedes only when `standing.effectiveFrom < today`.
   Proven by experiment rather than assumed: the teacher change at 2.3 returned the **same** row id
   and left the count at 40. So the close-and-open transaction, the partial unique index holding a
   real second row, and the `ON CONFLICT ... targetWhere` race fallback have **not run against real
   data**. They become reachable on 2026-09-19. What was proven is the outcome the criterion is
   about: the cell draws the new teacher exactly once, on three screens, with the old teacher gone.
2. **A parent with no enrolled child (1.7).** No such fixture exists at Askari.
3. **Section Head scoping (5.27).** No coordinators are linked to any Askari Section Head.
4. **The Principal's dashboard panel (5.5).** Inferred from a 200 and the permission, not seen.
5. **A real print dialog or PDF (3.20).** `window.print()` was stubbed; layout was measured instead.
6. **Cross-school tenancy with a second school's real ids (6.4).** Only an all-zero UUID was used.
7. **Dark mode (6.7).**
8. **`lib/payroll-approval.ts`** still reads both versions of a superseded cell, by instruction
   (STATE §5ci). Harmless until the first supersede, and there has not been one.

## QA side effects left on the live tenant

- Year 3 — A (Main), Monday Period 1: teacher changed **Tooba Ansari to Amna Zaheer**.
- Year 3 — A (Main), Monday Period 2: room set to **"Lab B (QA 33c)"**.
- Substitution `90f26c75-...`: Hina Aslam covering Year 3 — A Period 1 on 2026-09-18. This is F2's
  evidence and should be left until F2 is triaged.
- One chat thread from Aftab Awan to the School Office: "QA Sprint 33c — please ignore."
- The permissions override was granted and then removed; `overrides` is `[]` again.
