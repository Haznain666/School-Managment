# Sprint 27 — the pre-paid voucher, the duplicate that could not happen, and the school's own calendar

**Migration number: `0043`.** `0042` is the last applied (Sprint 26, `chat.oversight`). Nothing else is pending.

**Branch:** `feature/sprint-27-vouchers-holidays` off `main`.

This sprint is three parts. They ship together because two of them meet in the payroll run: a holiday is what stops a teacher being docked, and the payroll approval is who says so.

---

## Part A — vouchers

### A0. The model, stated once

A school here is **pre-paid**. October's fee is billed during September and falls due on the 10th of October.

| Fact | Value |
| --- | --- |
| Billing month | `M` — the month the fee is *for* |
| Generation happens | during month `M − 1` |
| Due date | `dueDay` of month `M` — the 10th unless `late_fee_rules.due_day` says otherwise |

`defaultDueDate(billingMonth, billingYear, dueDay)` in `lib/fee-calculator.ts` already produces exactly that and **must not change**. What changes is *when* the run happens and *which month it defaults to*.

### A1. One live voucher per student per month — enforced by Postgres

The rule the product owner asked for, in one sentence:

> A student has **at most one live billing document** for a month, and it is either their own voucher or their row inside a family voucher — never both.

That invariant is already half-built and nobody noticed: a family voucher is a *wrapper* over the same `fee_challans` rows, not a second charge (`db/schema/family-challans.ts`). So there is no shape of the data in which a child is billed twice for October — **provided the per-student row is unique per month.** It is, but the index is too strong in one direction and too weak in another.

**Today:** `fee_challans_student_month_year_idx`, a plain UNIQUE on `(student_profile_id, billing_month, billing_year, academic_year_id)`.

That index counts **cancelled** rows. So a school that cancels October's vouchers in order to raise a family voucher — the exact flow the product owner described — is then refused, with a unique-violation naming nothing a clerk can act on.

**Change, in `0043`:** drop it and re-create it **partial on `status <> 'cancelled'`**.

```sql
DROP INDEX IF EXISTS fee_challans_student_month_year_idx;
CREATE UNIQUE INDEX fee_challans_student_month_year_idx
  ON fee_challans (student_profile_id, billing_month, billing_year, academic_year_id)
  WHERE status <> 'cancelled';
```

This is strictly weaker than what it replaces — it covers a subset of the rows — so **no existing row can violate it** and the migration cannot fail on data. Prove that anyway (see Gates): count the rows either side.

`waived` deliberately still occupies the month, exactly as `fee_challans_admission_once_idx` decided for admission vouchers: waiving is a decision a human made, and re-billing the month would undo it silently.

Mirror it on `family_challans` so a family cannot hold two live vouchers for one month either:

```sql
CREATE UNIQUE INDEX family_challans_guardian_month_idx
  ON family_challans (guardian_id, billing_month, billing_year, academic_year_id)
  WHERE status <> 'cancelled';
```

⚠ Check for existing violations **before** creating this one — unlike the first, it is new and can fail on data. If a school already holds two live family vouchers for one guardian and month, the migration must say which.

### A2. Generation refuses rather than duplicates, and says who

Neither generator may quietly bill a child twice, and neither may fail with a `23505` a clerk cannot read.

- `listBulkCandidates` already reports `existingChallanNumber`. Widen it to say **why** the month is taken: the voucher's number *and*, when the row carries a `family_challan_id`, the family voucher's number and the words *"on family voucher …"*. A clerk looking at "already billed" with no idea where needs one more click than the screen should cost.
- `bulkGenerateChallans` keeps **skipping** the already-billed — that is what makes an interrupted run of two hundred safely re-runnable — and returns them named, not counted.
- `generateChallan` (the single-student path) **refuses with 409** naming the existing voucher. A single generate is a deliberate act about one child, and silently doing nothing is the wrong answer to it.
- Catch the unique violation as well as reading before the insert. The read is the message; the constraint is the guarantee.

### A3. The family voucher: raised, not assembled

**Today** `createFamilyChallan` takes ≥2 *existing open* vouchers and links them. That path is safe and stays.

**New, and it is the one the product owner described:** *Generate family voucher* for a guardian and a month raises the month's charge for every enrolled sibling **and** the family wrapper, in one transaction.

```
POST /api/school/family-challans/generate
  { guardianId, academicYearId, billingMonth, billingYear, dueDate? }
```

1. Resolve the family — `lib/siblings.ts` / the guardian CNIC grouping the module already uses. Refuse below two enrolled children.
2. **Refuse up front, 409, naming them**, if any sibling already holds a live voucher for that month. The message names each child and their voucher number, and the screen offers *Cancel these and continue* — which is the flow the product owner asked for, made one click instead of three screens.
3. Otherwise raise each sibling's voucher through the **same** `generateChallan` used everywhere else — same pricing, same concessions, same credit, same numbering — and then the family wrapper over them.
4. One email to the guardian, as `createFamilyChallan` already sends.

Add `family_challans.origin text NOT NULL DEFAULT 'combined'`, values `'combined' | 'generated'`, with a CHECK. Existing rows are `combined`, which is what they are.

**Cancelling follows origin.** `cancelFamilyChallan` today releases its members back to being billed individually — right for a `combined` voucher, wrong for a `generated` one, whose members exist only because it does. So:

| origin | cancel does |
| --- | --- |
| `combined` | release members (`family_challan_id` → null), status → cancelled |
| `generated` | cancel members **and** the wrapper, in one transaction |

A member carrying any payment is **released, never cancelled**, and the response says so. A cancelled voucher with money against it is a receipt pointing at nothing.

### A4. A family payment posts to the ledger — it never has

🔴 **This is a live defect, found while reading for this sprint.** `recordFamilyPayment` in `lib/family-challans.ts` writes a `fee_payments` row per child and updates every balance, and **posts nothing to the ledger.** `.../challans/[challanId]/payments/route.ts` posts; the family path does not.

CLAUDE.md: *"taking money in code — post it in the same transaction as the record of it"*, and *"A fee payment recorded without its posting understates the school's income, and understates it silently — nothing on any screen would ever say so."* That is exactly what has been happening to every family payment ever taken.

**Fix it here.** `recordFamilyPayment` opens one transaction; inside it, before the `fee_payments` inserts:

- resolve the posting accounts the same way the single-challan route does — `requireSystemAccount('fee_income')`, `landingAccountFor(paymentMethod)`, and `cashAccountForStaff` for cash so it lands in the clerk's own drawer;
- `postTransaction(tx, …)` **once** for the whole family payment, memo `Fee received — <guardian name> (<family voucher number>)`, source `fee_payment`;
- set `fee_payments.ledger_transaction_id` on **every** child row it wrote, so each child's receipt names the posting that carries it;
- set `ledger_transactions.source_id` to the first payment row, as the single route does, so the day book's "what caused this" link resolves.

One posting, not one per child: the money arrived once. The per-child detail is in `fee_payments`, which is where a parent's question is answered.

Same degradation as the single route: a school with no chart of accounts logs a warning and records the payment un-posted rather than refusing money at a counter.

### A5. Automatic generation, on a day the school picks

New columns on `late_fee_rules` (`0043`):

| Column | Type | Default | Meaning |
| --- | --- | --- | --- |
| `auto_generate_vouchers` | boolean NOT NULL | **false** | off until a school asks |
| `auto_generate_day` | integer NOT NULL | 25 | day of month `M−1` the run fires; CHECK 1–28 |
| `auto_generate_last_run_on` | date | null | the **claim** column |
| `auto_generate_family_vouchers` | boolean NOT NULL | true | group siblings into one voucher |

**Off by default and it must stay off.** Same reasoning as `auto_send_vouchers` beside it, and worse in one respect: an email cannot be recalled, and neither can a voucher a parent has already been shown.

`lib/voucher-auto-generate.ts`, modelled line for line on `lib/voucher-auto-send.ts`:

- **claimed, not checked** — `UPDATE late_fee_rules SET auto_generate_last_run_on = today WHERE auto_generate_vouchers AND auto_generate_day = <today's day> AND (auto_generate_last_run_on IS NULL OR auto_generate_last_run_on < today) RETURNING location_id`. Production runs seven schedulers; a read-then-`if` bills every school seven times.
- **claim first, release on throw** — `releaseClaim` sets the column back to null, exactly as the send sweeper does and for the same reason.
- Target month = the month **after** the run date's month, with year rollover: a run on 28 Dec 2026 bills January 2027.
- Academic year = `getActiveAcademicYear(locationId)`. **No active year is not an error and not a claim to retry**: log it and leave the claim, because re-trying every minute until midnight fixes nothing.
- For every actively-enrolled student in every grade that has a fee structure:
  - group by family when `auto_generate_family_vouchers` and the family has ≥2 enrolled children → one family voucher through A3's generator;
  - otherwise one individual voucher through `generateChallan`;
  - **skip anyone already holding a live voucher for the target month**, and count them.
- One school's failure never abandons the rest — per-school try/catch, as the send sweeper has.
- Started from `instrumentation.ts` beside `startVoucherAutoSend`.

Log one line per school: `N raised, M families, K already billed, S skipped`.

### A6. The screens

**`/dashboard/fees/settings`** gains a *Voucher generation* card above the late fee card:

- switch: *Generate next month's vouchers automatically*
- day picker 1–28, with the sentence that makes it legible: *"On the 25th of each month, raise every student's voucher for the following month. A voucher raised on 25 September is for October and falls due on 10 October."* — the due day in that sentence is the school's own.
- switch: *Raise one voucher per family where a guardian has more than one child here*
- the settings PATCH reads all four fields **explicitly**, absent meaning off, for the reason the file already gives about `autoSendVouchers`.

**`/dashboard/fees/challans/generate`** (`components/fees/ChallanGenerator.tsx`):

- the billing month defaults to **next month**, not this one, and the year rolls with it;
- under the month, one line: *"Due 10 October 2026 — fees are billed a month ahead."*;
- the preview lists the already-billed with the voucher number **and** the family voucher when there is one.

**`/dashboard/fees/family`** gains the *Generate family voucher* action described in A3, with the refusal dialog that names the siblings and offers to cancel their vouchers.

---

## Part B — the holiday calendar

### B1. What a holiday is

`holidays` — one row per holiday, not per day:

| Column | Notes |
| --- | --- |
| `id` uuid pk | |
| `location_id` text NOT NULL → `schools` cascade | the tenant key |
| `branch_id` uuid → `branches` **set null** | null = every campus |
| `name` text NOT NULL | "Eid-ul-Fitr", "Independence Day" |
| `starts_on` date NOT NULL | |
| `ends_on` date NOT NULL | equal to `starts_on` for a one-day holiday; CHECK `ends_on >= starts_on` |
| `holiday_type` text NOT NULL | `public` \| `religious` \| `school`; CHECK |
| `is_tentative` boolean NOT NULL default false | true for every lunar-dated holiday |
| `source` text NOT NULL default `'manual'` | `manual` \| `seed`; CHECK |
| `notes` text | |
| `created_by`, `updated_by` uuid → `school_users` set null | |
| `created_at`, `updated_at` | |

A **range and not one row per day** because Eid is one holiday of three days, and a school editing it moves one row. The calendar expands the range on read.

Weekends are **never rows**. Saturday and Sunday are derived — see B3 — because a table holding 104 rows a year per school that say the same thing is a table that will disagree with itself.

Indexes: `(location_id, starts_on)`, `(location_id, branch_id)`. Two partial unique indexes so a seed cannot run twice, one for the branch case and one for the null-branch case (Postgres treats every NULL as distinct — the pattern `payroll_runs` already uses):

```sql
CREATE UNIQUE INDEX holidays_school_wide_idx
  ON holidays (location_id, starts_on, name) WHERE branch_id IS NULL;
CREATE UNIQUE INDEX holidays_branch_idx
  ON holidays (location_id, branch_id, starts_on, name) WHERE branch_id IS NOT NULL;
```

### B2. Pakistan's holidays, and why every Islamic one is tentative

`lib/pakistan-holidays.ts` — **dependency-free of the database and of `server-only`**, like `lib/academic-year-runs.ts`, so the seed dialog previews exactly the rows the route will write.

Fixed-date national holidays, `holiday_type = 'public'`, `is_tentative = false`:

| Date | Name |
| --- | --- |
| 5 Feb | Kashmir Solidarity Day |
| 23 Mar | Pakistan Day |
| 1 May | Labour Day |
| 14 Aug | Independence Day |
| 9 Nov | Iqbal Day |
| 25 Dec | Quaid-e-Azam Day & Christmas |

Islamic holidays, `holiday_type = 'religious'`, **`is_tentative = true` without exception**:

| Islamic date | Name | Days |
| --- | --- | --- |
| 12 Rabi al-Awwal | Eid Milad-un-Nabi | 1 |
| 9–10 Muharram | Ashura | 2 |
| 1–3 Shawwal | Eid-ul-Fitr | 3 |
| 10–12 Dhu al-Hijjah | Eid-ul-Adha | 3 |

Derived in `lib/islamic-calendar.ts` — the **tabular (arithmetical) Islamic calendar**, a pure function of the Julian day number, no table of years to go stale and no network call. Ship it with a handful of assertions against known Gregorian dates so a wrong constant is caught by `npm run check-sprint27` rather than by a school.

⚠ **The tabular calendar is an approximation and the real dates are decided by moon sighting**, typically ±1–2 days. That is not a defect to hide — it is the whole reason the product owner asked for HR and the Branch Administrator to be able to move them. So:

- every religious holiday is written `is_tentative = true`;
- every screen that shows one badges it **Tentative — confirm the date**;
- editing a date clears the flag, because a human has now said what it is;
- the seed **never overwrites** a row a school has edited.

`POST /api/school/holidays/seed { year, branchId? }` writes the year's catalogue, skipping anything already present, and answers `{ created, alreadyPresent }` — never refusing the whole run because one row exists, for the reason `lib/academic-year-runs.ts` gives at length.

### B3. Saturdays are a duty roster, not a holiday

The product owner's requirement, exactly: *teachers and coordinators are called every Saturday while the principal comes in on 2*, and *four coordinators each come on one distinct Saturday*. So the answer has to be per role **and** per person, and it has to name **which** Saturdays, not how many.

**`saturday_duty_policies`** — the school's default for a role:

| Column | Notes |
| --- | --- |
| `location_id` text NOT NULL | tenant |
| `role` text NOT NULL | a `USER_ROLES` value; CHECK against the same list |
| `ordinals` integer[] NOT NULL default `'{}'` | subset of 1–5: which Saturday of the month |
| unique `(location_id, role)` | one policy per role per school |

**`staff.saturday_ordinals integer[]`**, nullable — the per-person override. `NULL` means *use the role policy*; `'{}'` means *no Saturdays*, which is a real and different answer. Say so in the column comment, because the two are one character apart and opposite.

Effective policy = `staff.saturday_ordinals ?? role policy ?? []`.

`lib/holiday-calendar.ts` — again free of the database, so the browser and the server agree:

```ts
saturdayOrdinal(date): 1..5          // which Saturday of its own month
isWorkingDay(date, holidays, ordinals): boolean
expandHolidays(rows, from, to): Map<isoDate, Holiday[]>
mergeConsecutive(rows): Block[]      // adjacent or overlapping ranges → one block
```

Sunday is always off. Saturday is off unless its ordinal is in the effective set. A holiday date is off for everyone.

⚠ `mergeConsecutive` is what makes *"30 Oct, 31 Oct and 1 Nov → one notification"* work, and it must merge **across a month boundary and across two different holidays**, because that is the example given.

### B4. Who may change it

New permission key **`calendar.manage`** — *"Add a holiday, move one, and load the year's public holidays"*.

`DEFAULT_ROLE_PERMISSIONS`: `school_admin` (holds `[...PERMISSIONS]`, so no entry needed), `branch_admin`, `principal`, `hr_manager`.

⚠ **CLAUDE.md's rule: a new permission key needs a migration.** `0043` must drop and re-add `role_permissions_permission_check` with the **full** list — every existing key plus `calendar.manage` and `payroll.approve` (Part C). Prove it by attempt, not by reading: try a key outside the list and require `23514`, try each new key and require acceptance, both inside transactions that are rolled back. `scripts/apply-0042.mjs` is the pattern.

**Reading needs no key.** Every portal user sees the calendar; that is the requirement. The read routes are gated on being signed in and nothing else.

### B5. The screens

| Route | Who | What |
| --- | --- | --- |
| `/dashboard/calendar` | any admin-portal role | month grid + list, with add/edit/delete and *Load public holidays* gated on `calendar.manage` |
| `/teacher/calendar` | teacher | read-only month grid, their own Saturday duty marked |
| `/parent/calendar` | parent | read-only |
| `/student/calendar` | student | read-only |

Every one of them fetches on the server, so **every one needs a `loading.tsx`** using `SkeletonPageHeader` + `SkeletonTable` (list) — `npm run check-loaders` is a green-build gate and will say so if you forget. Do **not** add a `loading.tsx` to a route that does not fetch.

Nav: a *Calendar* entry in the admin sidebar (`components/school/school-nav.ts`, not module-gated — every school has holidays), and one in each of the three portal navs.

Saturday duty lives at **`/dashboard/hr/saturday-duty`**, gated on `hr.read`, written with `hr.write`: the role defaults as five checkboxes each, and a staff table with a per-person override.

### B6. Presence on a day off

The product owner: *HR and Principal / Principals (for their own respective grades) should be able to [record] the presence of each teacher, coordinator and Principal on a day off.*

`/dashboard/hr/attendance` (the staff register) already writes `staff_attendance`, whose `STAFF_ATTENDANCE_STATUSES` already contains `holiday`. Extend it rather than build a second screen:

- the date picker accepts a holiday or a non-duty Saturday, and the screen **says which it is** — *"Saturday 10 October — a day off for Coordinators"*;
- the default status offered on such a day is `holiday`, and `present` is one click away for whoever actually came in;
- **past dates are markable** — the requirement says so explicitly for holidays, and the register already allows it;
- a **principal** may mark only staff their `PrincipalScope` admits (`lib/principal-visibility.ts`), and the page prints the scope note so a narrowed list is not read as a broken one.

### B7. The timetable and the payroll sync with it

**Teacher calendar.** `lib/teacher-calendar.ts`'s own docblock says: *"this calendar knows the teaching week and nothing about the school's holidays, because no holiday table exists yet… When a school calendar arrives, it subtracts here and nowhere else."* Do exactly that: a date inside a holiday yields no lessons and carries the holiday's name. Update the docblock — it is now wrong, and a stale comment here is worse than none.

The weekly timetable **grid** carries no dates and needs no change. Resist adding one, and keep obeying CLAUDE.md's rule: a grid resolves its period schedule through `listSlotsForSection` / `listSlotsForTeacher`, never the unscoped `listTimetableSlots`.

**Payroll.** Two changes, and the second is the one that matters.

1. `workingDays` on a run is **computed** from the calendar rather than defaulting to 26: the days in the month that are neither Sunday, nor a non-duty Saturday, nor a holiday. The form still lets a school override it — the number is theirs — but it arrives correct.
2. `attendanceTallyByStaff` in `lib/hr-queries.ts` counts every `absent` row in the month regardless of date. **Exclude dates that were not working days for that staff member**, using their effective Saturday policy. Without this a school that marks a register on a holiday docks its teachers for the school being shut, which is the exact thing `staff_attendance`'s docblock says must never happen.

### B8. Notifications

**Automatic, the day before.** `lib/holiday-notifier.ts`, swept from `instrumentation.ts`:

- find every consecutive holiday **block** (B3's `mergeConsecutive`) whose first day is tomorrow, excluding weekend-only stretches;
- **claim it** — `INSERT INTO holiday_notifications (location_id, block_start, block_end) … ON CONFLICT DO NOTHING RETURNING id`. Unique on `(location_id, block_start)`. Seven schedulers, one insert wins; the other six get nothing back and do nothing. This is CLAUDE.md's rule in the one shape that suits an insert;
- create an announcement addressed `{kind: 'all'}` and send it through `sendAnnouncement`, which already claims, delivers and logs;
- record `holiday_notifications.announcement_id` and `sent_at`;
- **on a throw, delete the claim row** so tomorrow's tick retries — the same contract `releaseClaim` has in the send sweeper.

One notice for the block: *"The school will be closed from Friday 30 October to Sunday 1 November for Eid Milad-un-Nabi and Kashmir Day. Classes resume Monday 2 November."*

**Explicit, to chosen roles.** `POST /api/school/holidays/[holidayId]/notify { roles: string[] }` — gated on `comms.send`, available to HR and the Branch Administrator by their existing defaults. It creates and sends an announcement with `audience: { kind: 'roles', roles }`, so it reuses the whole `lib/announcement-audience.ts` path and nothing new decides who gets what.

**The bell.** `sendAnnouncement` writes `announcement_recipients` and the notice board — and writes **nothing** to `notifications`, so the bell in every portal header never moves for an announcement. Fix it: `deliverAnnouncement` writes one `notifications` row per recipient, `kind: 'announcement'`, `href` pointing at that portal's notices. Add `announcement` to `NOTIFICATION_KINDS`.

`components/ui/NotificationBell.tsx` already renders the count and polls; every portal layout already passes `unreadNotifications`. Nothing there changes — the bell has been correct and empty.

---

## Part C — payroll goes to the principal

### C1. The rule

The product owner, exactly: *only teachers' and coordinators' payroll comes to the principal. A principal assigned a whole campus approves every teacher and coordinator at it. Where a school runs several principals, each approves those that fall under their own grades.*

So approval is **per principal over a slice of the run**, and the run advances when every slice is signed.

### C2. Schema

`payroll_runs.status` gains **`pending_approval`**. The CHECK is rewritten in `0043`. Transitions become:

```
draft            → pending_approval, cancelled
pending_approval → approved, draft (rejected), cancelled
approved         → paid, cancelled
paid             → —
cancelled        → —
```

`payroll_run_approvals`:

| Column | Notes |
| --- | --- |
| `location_id` text NOT NULL | tenant |
| `payroll_run_id` uuid NOT NULL → cascade | |
| `principal_user_id` uuid NOT NULL → `school_users` cascade | |
| `status` text NOT NULL default `pending` | `pending` \| `approved` \| `rejected`; CHECK |
| `staff_count` integer NOT NULL default 0 | how many of the run this person covers |
| `note` text | a rejection has to be able to say why |
| `decided_at` timestamptz | |
| unique `(payroll_run_id, principal_user_id)` | |

`payslips` gains the override:

| Column | Notes |
| --- | --- |
| `loss_of_pay_override` numeric(12,2) | null = no override; the **replacement** loss-of-pay amount, not a delta |
| `override_reason` text | required whenever the override is set |
| `overridden_by` uuid → `school_users` set null | |
| `overridden_at` timestamptz | |

`net_payable` is recomputed from the override and stays `>= 0` — the existing CHECK still holds. The original `loss_of_pay_amount` is **kept**, never overwritten: a teacher asking why they were paid more than the register implies is owed both numbers.

### C3. Who covers whom — `lib/payroll-approval.ts`

`resolveRunApprovers(locationId, runId)`:

1. A payslip needs principal approval when its staff member's role is **`teacher` or `coordinator`** — read from `school_users.role` through `staff.school_user_id` (Sprint 22's link), falling back to `staff.designation` when the record has no login. Everyone else — accountants, drivers, the office — does not go to a principal.
2. `principal_model = 'single'`: the school's one `principal` user covers all of them. **If the school has no principal at all, no approval is required** and the run behaves exactly as it does today. A school that has never appointed one must not find its payroll frozen by a sprint.
3. `principal_model = 'multiple'`: for each **live** assignment (`starts_on <= today`, `ends_on` null or future), it covers a staff member when either
   - the assignment's `branchIds` contain the staff member's `branch_id`, or
   - the assignment's `gradeIds` intersect the staff member's **teaching grades**.
4. A staff member's teaching grades: the distinct `grades.id` of the sections they are timetabled in (`timetable_entries.teacher_id = staff.school_user_id` → `sections` → `grades`) plus sections where `sections.class_teacher_id = staff.id`. A coordinator with no timetable is reached by the branch axis only, which is correct — a coordinator belongs to a campus.
5. Staff covered by **nobody** are returned as `uncovered`, named. The screen says so and `payroll.write` may sign that slice itself. Silently blocking a run because an assignment is missing is a payroll nobody can run and no screen explaining why.

### C4. Routes

- `PATCH /api/school/payroll/runs/[runId]` — `status: 'pending_approval'` requires `payroll.write`, and creates the approval rows in the same transaction as the status change. Refuses when the run has no payslips.
- `GET  /api/school/payroll/runs/[runId]/approvals` — the slices and their states. `payroll.read`.
- `POST /api/school/payroll/runs/[runId]/approvals` `{ decision: 'approved' | 'rejected', note? }` — requires the **new** `payroll.approve` **and** that the caller is one of this run's approvers. Writes their own row only, with `WHERE status = 'pending'` in the SQL so two clicks cannot both land. When the last pending row turns `approved`, the run moves to `approved` in the **same** statement chain, claimed: `UPDATE payroll_runs SET status='approved' … WHERE status='pending_approval' RETURNING id`. A rejection returns the run to `draft` and clears the approval rows, so the next submission is a clean sheet.
- `PATCH /api/school/payroll/payslips/[payslipId]` `{ lossOfPayOverride, overrideReason }` — allowed to `payroll.write` while the run is `draft`, and to a **covering principal holding `payroll.approve`** while it is `pending_approval`. Recomputes that payslip's `net_payable` and the run's three totals in one transaction. Refused on an `approved` or `paid` run, which is the existing rule and the right one.

New permission **`payroll.approve`** — *"Approve a payroll run for the staff you are responsible for, and override a deduction"*. Defaults: `school_admin`, `principal`. Deliberately **not** `hr_manager`: the person who computes the payroll is not the person who signs it off, which is the same control `accounting.settle` exists to draw.

### C5. The screen

`/dashboard/payroll/approvals` — gated on `payroll.read`; the buttons on `payroll.approve` and on being an approver of that run.

- runs awaiting this person, each with the staff they cover and the total;
- per payslip: gross, loss of pay, net, and an *Override deduction* action that asks for the amount and a reason — the reason is required and stored, because a waived deduction with no reason is a figure nobody can defend;
- *Approve* and *Reject with a reason*.

`/dashboard/payroll/runs/[runId]` gains a *Submit for approval* action and an approvals panel showing every principal's state.

---

## Gates

All twelve of CLAUDE.md's green-build list, plus `check-portals`, `check-dashboard`, `check-reports` (screens and nav changed) and a new **`npm run check-sprint27`**.

`check-sprint27` follows `check-sprint20`'s pattern and CLAUDE.md's rule — **execute the statements, do not print them**:

- read from `pg_constraint` / `information_schema` whether `0043` is applied, rather than being told;
- run every new or widened statement against the real schema with a tenant id matching no row: the partial unique indexes' `WHERE`, the family generator's reads, `resolveRunApprovers`' four-table join, the holiday expansion, the approvals join;
- before `0043`: the migration-dependent ones must fail with **exactly** `42P01` / `42703`, and **any other error is a real defect wearing a predicted failure's clothes**;
- the SQLSTATE is on the error's **`cause`**, not on the error;
- a read that short-circuits before reaching the new column is reported **not exercised**, never passed;
- prove the widened permission CHECK **by attempt**: a key outside the list must raise `23514`; `calendar.manage` and `payroll.approve` must be accepted. Both inside transactions that are rolled back, with row counts read back after.

Pure assertions with no database, in the same script: `islamicToGregorian` against known dates, `saturdayOrdinal` across a month starting on each weekday, `mergeConsecutive` across a month boundary and across two different holidays, and `defaultDueDate` for a December run rolling into January.

Add `check-sprint27` to `package.json`. It needs a database, so it stays out of `.github/workflows/ci.yml`, exactly as `check-sprint20`..`26` are.

⚠ Delete `D:\School-Management-System\.claude\worktrees\node_modules` before every build. STATE.md §5f.

---

## Deviations to record rather than take silently

If any of the following is not built, say so in the release notes in plain words rather than letting it look done:

1. The migration is unapplied — every A1 index, the `pending_approval` status and the two permission keys are inert without it, and five screens are a 500.
2. Anything in Part C, which is the largest and the least like anything already in the codebase.
3. The Islamic dates for any year beyond the ones asserted in `check-sprint27`.
