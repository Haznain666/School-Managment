# Sprint 33 — the product owner's feedback round

**Source:** `next sprint.docx` (product owner, 2026-09-16), read in full — two
tables, two screenshots, fourteen items.
**Decisions:** taken with the product owner on 2026-09-16, recorded in §0.
**Status:** specified, not built. `STATE.md` §5cf is the handover entry.

`STATE.md` is the truth and this file is the plan. Where they disagree,
`STATE.md` wins and this file gets corrected.

---

## 0. Decisions taken 2026-09-16

Nine questions were put to the product owner and all nine are answered. Three
further decisions were taken on the shape of the work.

| # | Question | Answer |
| --- | --- | --- |
| 1 | The document ends "One very important update." with nothing after it | A typo. Nothing is missing. |
| 2 | One principal per school, or per branch? | **Per branch.** One Principal and one Vice Principal each. |
| 3 | What does Branch Admin approve? | Everything for **non-teaching** staff; ranks equal to Vice Principal. The **Principal holds every approval permission** at their branch and can always act. The Principal approves the Branch Admin's own leave. |
| 4 | "Extend probation up to 180 days" | **180 is the total length**, counted in plain calendar days **including holidays**. An extension may not push past it. |
| 5 | How is the first year's quota calculated? | **Pro-rated from the date the person is marked Permanent**, against the **school's academic year**. |
| 6 | Junior teachers with no portal | **HR files their leave for them.** It still travels up the same approval chain. |
| 7 | Is Section Head permission-bearing? | **Yes**, with its own portal surface. |
| 8 | Holidays inside a leave span | **An HR setting, per branch**, with two options: *skip holidays from the span* or *include holidays in the span*. Applies to everyone at that branch. |
| 9 | A parent's timetable history | **No history view.** Past weeks must simply not be rewritten. |
| 10 | Carry-forward of unused leave | **None. It lapses** at the end of the academic year. |
| 11 | A leave request landing on a holiday | **Block only a single-day request** whose one day is a gazetted holiday. A **date range** whose first or last day is a holiday is **accepted, and the holiday counts** as leave. |
| 12 | How to ship fourteen items | **Three parts, in order.** Each is merged, migrated, deployed and QA'd before the next begins. |
| 13 | The Section Head portal's shape | **The administrative dashboard with scoped navigation**, exactly as Coordinator and Vice Principal work today. No new route group. |
| 14 | Section Head's rank | **Below Branch Admin.** Principal 80 > Vice Principal 60 > Branch Admin 50 > **Section Head 45** > Coordinator 40 > Teacher 20. A Section Head may **not** ban a named person from chat. |
| 15 | Askari runs four principals on Main Campus (Sprint 32's division model). How does that fit "one per branch"? | **Retire divisions inside a campus, everywhere.** One Principal and one Vice Principal per campus. Per-campus heads keep working as Sprint 32 built them. (2026-09-16) |
| 16 | Which Askari Main Campus principal stays? | **Imran Qureshi.** Farah Siddiqui, Rukhsana Bano and Tariq Jameel become **Section Heads**. Nadia Hameed (Junior Campus) is already compliant. (2026-09-16) |

### The standing rule this round establishes

**Every approval-type setting lives in the Permissions section** — leave,
payroll, and every approval built from here on. An approval right is a key in
`PERMISSIONS`, a default in `DEFAULT_ROLE_PERMISSIONS`, a row on the matrix, and
a migration widening `role_permissions_permission_check`. It is never a
hard-coded role list. Recorded in memory as
`approvals-live-in-the-permissions-section`.

---

## Part A — the three defects, the campus gap, and the two notification faults

**Migration:** `0046`. **Ships first**, because three of these are live faults.

### A1. A teacher is booked into two overlapping periods

**The report.** The teacher portal shows 8:40–9:20 (Nursery A, period 2)
followed by 9:05–9:45 (Year 1 A, period 3). *"This should never be the case."*

**Root cause, confirmed by reading.** `POST /api/school/timetable/entries`
refuses a teacher clash only when the two lessons share the same **`slot_id`**:

```ts
eq(timetableEntries.teacherId, teacherId),
eq(timetableEntries.slotId, slotId),          // ← the whole test
eq(timetableEntries.dayOfWeek, dayOfWeek),
```

Nursery period 2 and Year 1 period 3 are **different slots in different
`period_structures`**, so nothing compares their minutes. Both rows are legal
today and the grid is drawn from them correctly.
`listSlotsForTeacher` then unions the two schedules and orders them by the
clock, which is what puts the overlap on screen.

**The fix.**

1. A pure helper, `slotsOverlap(aStart, aEnd, bStart, bEnd)`, in
   `db/schema/timetable-slots.ts` beside `minutesFromTime` — free of the
   database, so the form and the route ask the same function.
2. The clash check in the route becomes a **time-overlap** test across every
   structure: join `timetable_slots`, and refuse any active entry for this
   teacher on this day whose `[start, end)` intersects the new slot's. Keep the
   existing same-slot test as the fast path; the message names the other class,
   the other period **and its times**.
3. `TimetableBuilder` shows the same refusal before the request, from the same
   helper, so the clerk is not told after the fact.
4. **Existing overlaps are reported, never deleted.** A read-only
   `listTeacherOverlaps(locationId, academicYearId)` and a panel on
   `/dashboard/academics/timetable` naming every teacher already double-booked.
   Deleting one silently would remove a lesson a class is sitting in.

**Acceptance.** Placing an overlapping lesson is a `409` naming both classes.
The Askari overlap in the screenshot appears in the report panel. A school with
one bell schedule sees no change whatever.

### A2. A teacher-to-parent attachment did not arrive the first time

**Root cause, confirmed by reading.** In
`POST /api/school/chat/conversations/[id]/messages` the message and its
attachment are **two separate writes**:

```ts
const posted = await postMessage({ … });   // commits: message + signals + bell
if (upload !== null) {
  await db.insert(chatAttachments).values({ … });   // a second, later commit
}
```

`postMessage` writes the message, bumps `last_message_at`, and writes the
`chat_signals` rows **inside one transaction**. The recipient's client is woken
by that signal and fetches `/messages`, which returns `{ messages, attachments }`
from `attachmentsForMessages`. A fetch landing between the two commits returns
the message **with no attachment** — exactly "it did not go the first time, and
it went the next time", because the next fetch sees the row.

**The fix.** One transaction: the message, the conversation bump, the
attachment row and the signals commit together, signals last. `postMessage`
takes an optional `attachment` and builds it on `tx`. The upload to storage
still happens first — an orphaned object is harmless, a message without its file
is not.

**Acceptance.** A message with an attachment is never visible without it. Sent
from a teacher to a parent, the attachment is present on the parent's very first
fetch.

### A3. The notification sound rings for messages already read

**Root cause, confirmed by reading.** The chime is driven by the **signal row**,
never by unread state:

- `ChatStreamProvider.onSignal` calls `play()` **unconditionally** — the
  docblock argues the sender is already excluded, which is true and is a
  different question.
- Nothing deletes a `chat_signal` when its conversation is read.
  `markConversationRead` moves `last_read_at` only; signals live for 24 hours
  until the digest sweep prunes them.
- `listSignalsSince` filters on recipient and `created_at >= since` and
  **nothing else**. Every catch-up that reaches back over a read message rings
  for it again — and `ChatStreamProvider` is mounted in **every portal layout**,
  so each page load re-arms the catch-up.

**The fix, server-side so it holds on every device.**

1. `markConversationRead` **deletes that person's signals for that
   conversation**, in the same transaction that moves `last_read_at`. A signal
   is worthless once delivered; its own schema says so.
2. `listSignalsSince` joins `chat_participants` and excludes signals for
   conversations where `last_read_at >= chat_signals.created_at`. Reading on a
   phone silences the laptop.
3. The client rings **once per delivered batch**, and never for the conversation
   currently open on screen.

**Acceptance.** Read a conversation, reload any portal page: silence. A genuinely
new message still rings, once, on every portal.

### A4. Unread-message emails: once a day, at most five, with a link

**Today.** `lib/chat-digest.ts` mails every **60 minutes**, for ever, with no
link — *"Sign in to read and reply."*

**The fix.**

- `DIGEST_INTERVAL_MINUTES` → **1440**.
- `chat_participants.digest_count integer NOT NULL DEFAULT 0` (`0046`), raised
  by the claim and **reset to 0 when the conversation is read**. The candidate
  query refuses anybody at 5.
- The email carries a **deep link** to the conversation, built from
  `schools.slug` and the recipient's role home route —
  `https://<slug>.<origin>/<portal>/chat?c=<conversationId>`. The chat screens
  already select from a conversation id; they gain a `?c=` reader.
- The claim stays a conditional `UPDATE … RETURNING` and still reverts on
  failure. Seven scheduler processes, one email.

**Acceptance.** One email per person per day while something is unread, five at
most, each linking straight to the thread. Reading it resets the count.

### A5. The campus gap on leave approval — **a real hole, confirmed**

`GET /api/school/hr/leave-requests` narrows to the caller's campus:

```ts
branchId: auth.branchId ?? undefined,     // a branch admin sees their own
```

`PATCH /api/school/hr/leave-requests/[requestId]` **checks nothing**. A
campus-bound approver cannot see another campus's request on screen and can
approve it by calling the endpoint with its id.

**The fix.** `getLeaveRequest` returns `branchId: staff.branchId` (it does not
today), and the `PATCH` refuses with `403` when
`auth.branchId !== null && row.branchId !== auth.branchId`. Part B replaces this
with the full approval chain; this lands now because it is live.

**Acceptance.** A Branch Admin at campus A `PATCH`ing a campus B request gets
`403`, proved by attempt against a real session, not by reading.

### A6. Days used is calculated

The screenshot shows **Days used: 0** under "Half days allowed. Defaults to the
whole range." `LeaveManager` has `spanDays()` and never writes the result into
the draft, so the field starts empty and the API's `Number(body.totalDays) || span`
fallback is what saves it.

**The fix.** The field fills from the dates the moment both are set, stays
editable for half days, and shows what it counted — *"5 days (2–6 March)"*.
Part B replaces the counter with the holiday-aware one.

### Part A gates

`typecheck`, `lint`, the ten CI checks, `check-sprint24` (chat, executed),
`check-sprint33a` (new — executes every widened statement against the real
schema, per CLAUDE.md), `build`.

---

## Part B — Section Head, the chain of command, and HR leave management

**Migration:** `0047`. The largest part. Nothing here ships until Part A is live.

### B1. `section_head` becomes a role

Adding a value to `USER_ROLES` makes the compiler find every site, because six
maps are `Record<UserRole, …>`: `ROLE_HOME_ROUTES`, `ROLE_LABELS`,
`ROLE_DESCRIPTIONS`, `DEFAULT_ROLE_PERMISSIONS`, `GRANT_RANKS`, and
`saturday_duty_policies`' CHECK. That is the safety net — follow it.

| Thing | Value |
| --- | --- |
| `types/school-auth.ts` | `section_head` in `USER_ROLES`, `ADMIN_PORTAL_ROLES`, `INVITABLE_ROLES`; home `/dashboard`; label *Section Head*; description *"Runs a section. The coordinators under them report here."* |
| `db/schema/school-users.ts` | the CHECK is rewritten in `0047` — `0010` is the migration that last defined `school_users_role_check` |
| `db/schema/chat-grants.ts` | `GRANT_RANKS.section_head = 45` — below Branch Admin (50), above Coordinator (40) |
| `lib/kpis.ts` | `RATER_SENIORITY.section_head`, ranked under `branch_admin` |
| `db/schema/staff-kpis.ts` | `section_head` joins `STAFF_KPI_TARGET_ROLES`; new key `kpis.rate.section_head` |
| `scripts/check-branch-scope.ts` | the expected seniority string gains it; the "exactly four heads may ban" assertion stays **four** — a Section Head ranks below the threshold |

⚠ `RANK_TO_BAN_A_PERSON` is `GRANT_RANKS.branch_admin` (50) and must stay so.
45 < 50, so a Section Head cannot ban. That is the intent; assert it.

### B2. The chain of command

Per **branch**: Principal (one) → Vice Principal (one) → Section Heads →
Coordinators → Teachers → Junior Teachers. **Branch Admin ranks with the Vice
Principal** and heads every non-teaching role.

- **One Principal and one Vice Principal per branch** — enforced by a partial
  unique index on `school_users (location_id, branch_id)` where
  `role = 'principal' AND is_active`, and its twin for `vice_principal`. A
  school that already has two gets a **report**, never a silent deletion.
- `section_head_coordinators (section_head_user_id, coordinator_user_id, branch_id)`
  — one-to-many, the shape `coordinator_teachers` already has.
- Coordinator → teacher reuses **`coordinator_teachers`** from Sprint 32
  unchanged. Do not build a second table.
- **A missing level is skipped.** `lib/approval-chain.ts` resolves upwards:
  teacher → coordinator → section head → vice principal / branch admin →
  principal, returning the first level that exists at that branch.
- **A teacher supervised by several coordinators** — including every junior
  teacher — routes to **Vice Principal and above**. That is what
  `coordinator_teachers` returning two rows means; it is a rule, not an error.
- **Junior teacher** is not a role: it is a `staff` row with no
  `school_user_id`. HR files their leave. No schema change.

### B3. Leave, end to end

**Permission keys** (with `0047` widening the CHECK — CLAUDE.md's rule, and the
standing rule from §0):

| Key | Grants | Default holders |
| --- | --- | --- |
| `leave.read` | see leave, within scope | every approving role, HR |
| `leave.request` | apply for your own | every staff role |
| `leave.approve` | decide a request from someone below you | Coordinator, Section Head, Vice Principal, Branch Admin, Principal, School Admin |
| `leave.manage` | leave types, quotas, the staff calendars, the holiday-span setting | HR, School Admin |

`hr.read` / `hr.write` keep working; these narrow what was one key over
everything.

**Leave types.** `leave_types` already exists with `annual_quota_days`,
`is_paid` and `DEFAULT_LEAVE_TYPES` (10 casual, 8 sick, 14 annual, unpaid). HR
gets full CRUD plus a **seed** button — it is already wired, and it is what
"auto seed the current leave types" asks for.

**Quota.** New on `staff`: `permanent_from date`. The entitlement is pro-rated
from it against the school's **academic year**, and **lapses** at year end.
`lib/leave-quota.ts` is the one place that computes
`{ entitled, taken, pending, remaining }`; the form, the API and the check
script all call it. A request exceeding `remaining` is refused with the numbers
in the sentence.

**Two staff calendars.** `staff_calendars (location_id, branch_id, category)`
where category is `teaching` | `non_teaching`, plus
`staff_calendar_overrides` for a gazetted holiday HR has moved or cancelled,
carrying the roles it applies to and whether to notify.

- Gazetted holidays appear on **both** calendars automatically — that is
  `lib/pakistan-holidays.ts` and the existing seed, unchanged.
- HR overrides one, multi-selecting the roles it applies to.
- *Notify* reuses **`POST /api/school/holidays/[holidayId]/notify`** — which
  already builds an announcement with `audience: { kind: 'roles', roles }` and
  sends it through `sendAnnouncement`. **Do not write a second delivery path.**
- June–July off for teaching staff only is expressible as a school holiday on
  the teaching calendar.

**Refusals.** A request is refused when the person already has leave on a day in
the range, and — per decision 11 — when a **single-day** request lands on a
gazetted holiday. A **range** touching a holiday is accepted; whether the
holiday is counted is the branch setting from decision 8, stored as
`branch_leave_settings.holiday_span` = `skip` | `include`, and consumed by the
day counter in `lib/leave-quota.ts`.

**Self-service.** Every staff portal user applies from their own portal:
`/teacher/leave` gains a form (it is read-only today and its docblock says why —
that reasoning is now answered), and the administrative portal gains
`/dashboard/leave/me` for the roles that live there.

**Approval.** `POST /api/school/leave/requests/[id]/decision` resolves the
chain with `lib/approval-chain.ts`, re-checks it **on the write**, and enforces
the campus. A Principal may decide anything at their branch.

### B4. Probation

New on `staff`: `is_on_probation boolean`, `probation_days integer`,
`probation_started_on date`, `probation_ends_on date` (generated on write, not
by a trigger), `probation_extended_days integer`.

- The checkbox appears on the HR staff form when employment type is full time.
- **180 calendar days is the ceiling**, including holidays (decision 4). The API
  refuses a longer total.
- A sweep in `instrumentation.ts` emails HR when probation ends. **Claimed, not
  checked** — a conditional `UPDATE … RETURNING` on a
  `probation_notified_at` column, because production runs seven schedulers.
- Leave accrues only from `permanent_from`, which is what the probation flow
  eventually sets.

### Part B gates

Everything in Part A's list, plus `check-sprint33b` executing every new
statement against the real schema, and `check-branch-scope` (which now guards
the seniority order including `section_head`).

---

## Part C — the portal work

**Migration:** `0048` if the timetable history needs one (see C1); otherwise
none.

### C1. A parent sees their child's timetable

Add `/parent/timetable` and a sidebar entry, modelled on
`/student/timetable`, reading `listSlotsForSection` — **never** the unscoped
`listTimetableSlots` (CLAUDE.md).

**"Do not change legacy data."** Today `timetable_entries` has no dates: changing
`teacher_id` rewrites who taught last Tuesday. Two honest options, and the second
is the recommendation:

1. Date-scope the entry — `effective_from` / `effective_to`, superseding rather
   than updating on a teacher change. Correct, and it touches every timetable
   read in the product.
2. **No history view is needed** (decision 9). So: keep the current week
   forward only, and make a teacher change **supersede** rather than overwrite —
   the existing row is closed and a new one opened. `0048` adds the two dates;
   every current read filters on "live today", which is one predicate in
   `listTimetableEntries` and `listSlotsForTeacher`.

### C2. A paid voucher prints a receipt

`app/(parent)/parent/fees/page.tsx` builds `printData` **only** for `unpaid` or
`partial` — the Sprint 20 decision that a paid slip must not read as a demand.
That decision stands; what is missing is the receipt.

- A paid or partially-paid voucher offers **Print Receipt**.
- `buildReceiptPrintData` reuses `getChallanDetail`, whose `payments` array is
  already there, and renders a `ChallanPrintView` variant headed **RECEIPT**:
  status **Paid**, outstanding **0**, every payment with its date and mode, no
  bank block and no "valid upto".
- **The month is on both documents.** `periodLabel()` already computes it from
  `billing_month` / `billing_year`; it goes in the print header.

### C3. The recipient picker

`GET /api/school/chat/reachable` returns `{ kind, id, name, detail }` and the
composer renders a bare `<select>`. Both change, for **every portal** — it is one
component.

- **Role chips** filter the list. `ReachableTarget` gains `role` and `branchName`.
- **Search** in the To field, filtering client-side over the resolved list —
  the list is already derived per caller and is small.
- **A student** shows *parent's name · class with section*.
- **A parent** shows *their children's names*.

`resolveReachable` supplies all of it; `initiateProblem` still re-derives on the
write, so the labels are a courtesy and the server stays the rule.

### C4. Teacher availability and quick substitutes

A new section on the dashboards of **Principal, Vice Principal, Section Head and
Coordinator** (decision: Section Head is included).

- `lib/teacher-availability.ts` — for a date and a period, who is free: every
  teacher at the branch, minus those timetabled in an overlapping slot (the A1
  helper), minus approved leave (`teacher-calendar.ts` already reads it), minus
  anyone the Saturday roster or a holiday says is not in.
- Pick a period from the timetable → the free teachers appear → **Send as
  substitute** writes a cover row and notifies the teacher through the chat and
  bell paths that already exist.
- Scoped: a Coordinator sees their own teachers, a Section Head their
  coordinators' teachers, a head their branch.

### Part C gates

Everything in Part A's list, plus `check-loaders` for the new routes (each new
`page.tsx` that fetches gets a `loading.tsx` with the right skeleton **shape**),
`check-portals`, and `check-sprint33c`.

---

## What this sprint deliberately does not do

- **It does not touch `lib/payroll-approval.ts`.** Payroll still unions campus
  and grades and still disagrees with the KPI resolver about a teacher
  timetabled across two divisions. `STATE.md` §5cc item 4 is waiting on the
  product owner and this round does not settle it.
- **It does not fix the 35 stale-list screens** (§5cc item 3). That is its own
  sprint and it needs the root cause first.
- **It does not delete existing overlapping timetable rows.** A1 reports them.
