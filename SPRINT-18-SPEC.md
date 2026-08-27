# SPRINT 18 — vouchers, concessions, student CRUD and the enrolment lock

Eighteen items reported by the product owner after driving the school-admin
portal against Lahore Grammar School. Migration number: **`0034`** (`0033` is
the last one on disk).

The through-line: **a challan is called a Voucher**, a voucher has to reach the
parent by itself, and a concession is a thing the school owns rather than
something retyped per child.

---

## Standing rules that apply to every item here

* CLAUDE.md is binding — loaders, CNIC, phone, the append-only ledger,
  operators instead of raw sql templates for comparisons, claimed background
  work.
* Money is integer paise (`lib/money.ts`). Never add two rupee strings.
* Every new permission key must be added to `PERMISSIONS` **and** widened in the
  `role_permissions_permission_check` CHECK by migration `0034`.
* Expand-only migration. No column dropped, no row rewritten.
* Green build: the nine `npm run` gates in CLAUDE.md.

---

## 1. Enrolment: a matched sibling's identity fields are read-only

`components/admissions/GuardianForm.tsx`.

When the CNIC lookup returns an existing guardian (`result.guardian !== null`),
that person already exists at this school. Their **name, email and phone are no
longer editable on this card** — they render `disabled` with a hint saying where
to change them (the guardian panel on the sibling's profile). Correcting a
father's number *during another child's enrolment* is how one person becomes two
records with two different numbers, which is exactly what splits a family.

Relationship, occupation and primary-contact stay editable — they are facts
about *this* child, not about the person.

Clearing or changing the CNIC to one that does not match unlocks them again.

## 2. Enrolment: everything except the CNIC starts locked

Same file. On a fresh guardian card every field except `CnicField` is `disabled`
until one of two things is true:

* the CNIC is **blank** and the clerk presses **"No CNIC to hand — enter by
  hand"** — an explicit escape hatch, because CLAUDE.md's rule is that blank is
  always allowed and a required field is how a clerk invents a number; or
* a complete CNIC has been entered and the lookup has returned.

Lookup returned **no match** → every field unlocks, empty.
Lookup returned **a match** → the card fills in, and per item 1 only
Relationship (plus occupation and primary contact) is active.

The lock is a client-side courtesy only. `parseGuardians` on the server is
unchanged and remains the rule.

## 3. All-students panel: Guardian phone shows the student's ID

`lib/admissions-queries.ts`, `listStudents`. `guardianPhone: schoolUsers.phone`
reads the **student's** own directory row, whose phone is the sentinel
`student:GVS-2025-0011` (see `studentDirectoryPhone` in `lib/enrollment.ts`).

Fix: read the primary guardian's phone from `student_guardians`
(`is_primary_contact = true`), falling back to the first guardian by
`created_at`. The free-text search must search that column too rather than
`school_users.phone`, which can only ever match a sentinel.

Display it through the new `formatPhoneForDisplay` (item 16).

## 4. Fee status chip on the student listing

A new column, **Fees**, on `components/admissions/StudentTable.tsx`, driven by a
new field on `StudentListRow`:

| Chip | Meaning |
| --- | --- |
| `Cleared` (success) | no open (`unpaid` / `partial`) voucher |
| `Due` (warning) | at least one open voucher, none past its due date |
| `Overdue` (danger) | at least one open voucher past its due date |
| `Admission unpaid` (danger) | an open `challan_kind = 'admission'` voucher |

Computed inside `listStudents` with one grouped query over `fee_challans` for
the page's student ids — not N queries, and not a correlated sub-select per row.
It is also offered as a filter on the listing.

## 5. Student CRUD, as four assignable permissions

Four new keys in `lib/permissions.ts`, in a new `PERMISSION_GROUPS` entry
**"Student records"**:

* `students.read` — see a student's record
* `students.create` — enrol a student
* `students.update` — edit a student's record
* `students.delete` — delete a student record

Defaults, chosen so nothing changes for any existing school on the day this
deploys:

* `students.read` → every role that holds `admissions.read` today.
* `students.create`, `students.update` → every role that holds
  `admissions.write` today.
* `students.delete` → `school_admin` only, with a `PERMISSION_DESCRIPTIONS`
  entry saying it removes the child, their guardians, enrolments and fee
  history, and that it is not an undo for a wrong enrolment — withdrawing is.

Routes:

* `GET /api/school/students` and `GET /api/school/students/[studentId]` →
  `students.read`
* `POST /api/school/students` → `students.create`
* `PATCH /api/school/students/[studentId]` → `students.update`
* **New** `DELETE /api/school/students/[studentId]` → `students.delete`

DELETE is a real delete of `student_profiles`; the FK cascades take guardians,
enrolments, concessions and credits. It **refuses** — 409, with the count in the
message — when the student has any `fee_payments` against any voucher: money
received is a fact the school cannot be allowed to erase, and withdrawing is
what that case wants. It also refuses when the actor is branch-scoped and the
student is not in their branch (404, as everywhere else).

UI: a **Delete student** control on
`components/admissions/StudentProfileCard.tsx` behind `students.delete`, in a
confirm modal that requires the student's admission number to be typed. The
permissions screen picks the new group up automatically from
`PERMISSION_GROUPS`.

## 6. The voucher email, the aged-debt quick actions, and reminder chips

**6a. A generated voucher emails the parent.** New `sendFeeVoucher` in
`lib/fee-notices.ts`: subject `Fee voucher <number> — <school>`, body naming the
child, the period, the line items, the total and the due date, and saying a
printed copy is available from the school office. Queued through `enqueueEmail`
exactly as the reminder is — never awaited inside the request, never able to
fail a generation.

Called from **every** write path that produces a voucher: `generateChallan`,
`generateAdmissionChallan`, `bulkGenerateChallans` and `createFamilyChallan`.
The bulk run fans out one email per voucher through the outbox, which is what
the outbox is for.

**6b. `fee_challan_reminders`** — a new table, one row per reminder sent:

    id, location_id, challan_id -> fee_challans(id) on delete cascade,
    sequence integer not null,          -- 1, 2, 3 … per challan
    sent_at timestamptz not null default now(),
    sent_to_email text,
    sent_by_uid text
    unique (challan_id, sequence)
    index (location_id), index (challan_id)

`POST /api/school/fees/reminders` writes one per challan it queues, taking the
sequence as `max(sequence) + 1` **inside the insert** — an
`INSERT … SELECT coalesce(max(sequence), 0) + 1 … ON CONFLICT DO NOTHING` — so
two clicks cannot produce two "Reminder 2"s.

**6c. Aged-by-debt quick actions.** On `/dashboard/fees/defaulters`, each row
gains:

* **Send reminder** — posts that student's open voucher ids to the reminders
  route, behind `fees.write`.
* **Mark as paid** — records a full payment for the remaining balance of every
  open voucher of that student, behind `fees.write`, in a confirm modal that
  names the total. It must go through
  `POST /api/school/fees/challans/[challanId]/payments` so the ledger posting
  happens in the same transaction — never a direct `UPDATE` of `status`.

**6d. Reminder chips.** Every reminder on a row renders as a small chip,
`Reminder 1 · 02-Aug-2026`, newest last, wrapping. `listDefaulters` returns them
per student.

**6e. Sorting and filters.** The defaulters screen moves onto
`components/ui/DataTable` with a sortable header on every column — student,
class, guardian, open vouchers, oldest due date, days overdue, outstanding —
and the existing branch / grade / bucket / minimum-amount filters expressed as
`DataTable` filters plus its search box.

## 7. Currency, everywhere, with thousands separators

`formatAmount` and `formatPkr` in `lib/money.ts` already do this. The defect is
the call sites that do not use them: `PKR ${row.totalAmount}`,
`Number(x).toFixed(2)`, `${paisa / 100}` and friends.

Sweep every one of them in `components/`, `app/` and `lib/` and route it through
`formatPkr` (with the prefix) or `formatAmount` (without).
`components/fees/FamilyVouchers.tsx`, `lib/family-challans.ts`'s user-facing
messages, `lib/defaulters.ts` and every print view are known offenders.

Add **`npm run check-currency`** — a script in `scripts/` that greps for those
patterns outside `lib/money.ts` and fails on a new one, wired into
`.github/workflows/ci.yml` beside `check-cnic`. A rule nobody enforces is a rule
that comes back.

## 8. Print Voucher, before Confirm the fee was paid

`components/admissions/FeeClearancePanel.tsx`. In the `billed` and `settled`
states a **Print voucher** button renders **before** *Confirm the fee was paid*,
linking to the existing single-voucher print route for that challan id.

The admission voucher is emailed to the primary contact automatically when it is
raised — that is item 6a's `generateAdmissionChallan` call site — and this panel
says so in one line under the buttons so the clerk does not send it twice.

## 9. "Challan" becomes "Voucher" — everywhere a human reads it

Every user-visible string: page titles, `metadata.title`, nav labels, buttons,
table headers, empty states, error messages, email subjects and bodies, print
copy labels, toast text. `Challan number` becomes `Voucher number`.

**Not renamed:** table names, column names, file names, function names, API
routes, permission keys, TypeScript identifiers. A database rename is a
migration nobody needs and a route rename breaks every bookmark a school has.
The nav path `/dashboard/fees/challans` stays; its label becomes *Vouchers*.

## 10. The voucher print format

`components/fees/ChallanPrintView.tsx`.

* **Landscape A4**, three copies **side by side** as three columns with cut
  lines between them — the shape a Pakistani bank counter actually takes.
  `<PrintSheet>` gains an `orientation` prop that emits
  `@page { size: A4 landscape }`.
* Each copy keeps the whole bill. Three copies stay; the labels are unchanged.
* The particulars table gains a **Details** line under each item: the fee head's
  category, the period it covers, and — per item 14 — the concession by name and
  rate. A line has to explain itself to a parent reading it once.
* Bulk printing (`ChallanCopies`, `breakAfter`) keeps working: one voucher per
  landscape sheet.

## 11. The Vouchers register hides admission vouchers

`components/fees/ChallanTable.tsx` initialises `billingMonth` to the current
month and `billingYear` to the current year. An admission voucher carries a
**null** `billing_month` by design, so it can never match and never appears.
That is the whole of the reported defect.

Fix: both filters default to **empty** (All months / All years), and a new
**Kind** filter offers *Monthly*, *One-off* and *Admission*. `listChallans`
gains a `kind` filter — `monthly` is `billing_month IS NOT NULL`, `one_off` is
`billing_month IS NULL AND challan_kind IS NULL`, `admission` is
`challan_kind = 'admission'`.

The register also gains a **Family vouchers** segmented tab listing issued
family vouchers with Record payment and Print, which is where item 18 says a
generated family voucher lives.

## 12 and 13. Concession schemes, with a multi-select of fee heads

**New tables:**

    concession_schemes
      id, location_id -> schools(location_id) cascade,
      name text not null,
      discount_type text not null check in ('percentage', 'fixed'),
      discount_value numeric(10,2) not null,
      valid_from date not null,
      valid_until date,                 -- null = open ended
      is_active boolean not null default true,
      notes text, created_by_uid text, created_at, updated_at
      unique (location_id, name)

    concession_scheme_fee_types
      scheme_id -> concession_schemes(id) cascade,
      fee_type_id -> fee_types(id) cascade,
      primary key (scheme_id, fee_type_id)

    student_concession_fee_types
      student_concession_id -> student_concessions(id) cascade,
      fee_type_id -> fee_types(id) cascade,
      primary key (student_concession_id, fee_type_id)

plus `student_concessions.scheme_id uuid null references concession_schemes(id)
on delete set null`.

**An empty fee-head set means every head**, which is the existing meaning of a
null `applies_to_fee_type_id` and must stay that way — CLAUDE.md and STATE.md
§5be record what the narrow reading cost.

**The calculator changes shape once.** `ConcessionInput` gains
`appliesToFeeTypeIds: string[] | null`, where `null` or `[]` means every head.
`concessionPaiseFor` matches on membership. `applies_to_fee_type_id` is still
read for legacy rows and folded into the array — no backfill, no rewrite.

**Screens.**

* `/dashboard/fees/concessions` becomes two tabs: **Schemes** and **Granted**.
* A scheme is created with a **`components/ui/MultiSelect`** of fee heads
  (item 13); applies-to defaults to "Every fee head".
* **Apply a scheme to students**: a picker — search by name or student ID,
  filter by grade and section, select many — that writes one
  `student_concessions` row per selected student carrying `scheme_id` and the
  scheme's values **frozen at grant time**, exactly as a voucher line freezes
  its price. It skips students who already hold that scheme and reports how many
  were skipped.
* `repriceOpenChallans` runs after applying or removing a scheme, once, for the
  affected students — and remains idempotent with respect to credit
  (`grantedOverflowPaise`, STATE.md §5be).
* The ad-hoc per-student concession form also gets the multi-select.

## 14. The voucher names the concession and its rate

`fee_challan_items` gains `concession_detail text` — persisted at generation
time like `description`, for the same reason: a scheme renamed in March must not
rewrite February's slip.

`calculateChallanLines` builds it from the concessions it actually applied:
`Sibling Discount 20%`, or `Staff Discount PKR 2,000`, several joined with a
comma. Null when nothing applied.

Shown on the voucher print view (item 10's Details line), on the voucher detail
page and in the voucher email.

## 15. Dates read DD-MMM-YYYY

New `lib/dates.ts`:

    formatDateOnly('2026-08-02')  // '02-Aug-2026'
    formatDateTime(date)          // '02-Aug-2026 14:30'
    formatMonthYear(8, 2026)      // 'Aug 2026'

Pure, dependency-free, safe on `null` and `''` (returns an em dash), and it must
parse a `YYYY-MM-DD` column value as a **calendar date** rather than through
`new Date(value)`, which reads it as UTC midnight and prints the day before in
any timezone west of Greenwich.

Applied everywhere a date is displayed: `DataTable` columns of `kind: 'date'`
render through it by default, plus the student profile card, the guardian panel,
the voucher print view and detail page, the defaulters list, the application
table, and the parent and student portals.

Every `<input type="date">` that asks for a date of birth carries the hint
`Day, month and year — shown as DD-MMM-YYYY once saved.`

## 16. The guardian relationship, and the phone that came back wrong

**16a. The relationship prefills from the existing record.** When the CNIC
lookup matches, `lookupGuardianByCnic` also returns the `relationship` that
person holds against the child they are already recorded on. The card adopts it
when it is still available for this student (per `availableRelationships`), so a
mother enrolling her second child is offered Mother rather than Father.

**16b. The phone is displayed in the format it was typed.**
`student_guardians.phone` is stored canonically as `+923211234567` and must stay
that way — it is an identity (`lib/phone.ts`). The defect is on the way **out**:
that string is fed straight into `PhoneField`, whose mask is `(0321) 123-4567`,
so `detectPhoneKind` reads twelve digits, decides landline, and the field shows
an error on a number the server itself wrote.

Add to `lib/phone-formats.ts`:

    /** `+923211234567` -> `(0321) 123-4567`. The inverse of what the mask accepts. */
    export function formatPhoneForDisplay(stored: string): string

and call it wherever a stored phone reaches a `PhoneField` or a screen —
`GuardianPanel`, the student listing, the defaulters list, the voucher detail,
the user panels. Storage is unchanged.

## 17. Auto-send the monthly voucher

`late_fee_rules` gains:

    auto_send_vouchers boolean not null default false,
    auto_send_day integer not null default 28 check (between 1 and 28),
    auto_send_last_run_on date          -- the claim column

A toggle plus a day selector on `/dashboard/fees/settings`, behind `fees.write`,
off by default — a school must never start emailing its parents because a sprint
deployed.

A new sweeper in `lib/fee-notices.ts`, started from `instrumentation.ts`
alongside the announcement scheduler, that on each tick:

1. **Claims** the school for today with a conditional update:
   `UPDATE late_fee_rules SET auto_send_last_run_on = <today> WHERE location_id = ?
   AND auto_send_vouchers AND auto_send_day = <day of month>
   AND (auto_send_last_run_on IS NULL OR auto_send_last_run_on < <today>)
   RETURNING location_id`. Seven server processes, one claim. CLAUDE.md's rule.
2. Emails the current month's open vouchers to each student's primary contact,
   through the outbox.
3. On a throw, hands the claim back (`auto_send_last_run_on` to its previous
   value) so a transient failure is not recorded as a send.

It **never generates** vouchers. It sends what the school has already raised —
raising money demands on a timer is not a thing to ship without being asked.

## 18. Family vouchers, as three steps

`/dashboard/fees/family` is rebuilt.

**The listing above the wizard**: families that could take one voucher this
month, **most children first**, then largest total. That is the whole reason the
screen exists and it should be the first thing on it.

**Remove the Children column** from the group table — the names belong in the
step-3 selection, not in a list of families.

**The wizard.**

*Step 1 — find the family.* A real search box **with a Search button** — it is a
server round trip, and a debounce firing on every keystroke against a
cross-table match is what "the search does not work" describes — posting to a
new `GET /api/school/family-challans/search?q=`. It matches a **guardian or a
child** by name, admission number or phone, case-insensitive and partial, and
returns only guardians with **more than one child enrolled**: the exact-or-
similar list the item asks for. Each result shows the guardian, their contact,
and the children's names.

*Step 2 — choose the month.* Selecting a family opens a modal listing the months
that family has anything open in, with the count and the total per month.

*Step 3 — choose what to club.* The unpaid and part-paid vouchers for that month
across all of that family's children, every one selectable, with a running
total. **Generate family voucher** issues over the selected ids only.

`listFamilyGroups` keeps its union-find identity rule unchanged. The new search
uses the same rule so the two agree.

**Where it lives afterwards.** The issued voucher appears on the **Family
vouchers** tab of the Vouchers register (item 11), and payment is recorded
there.

**Partial payment is spread evenly, not oldest-first.** `recordFamilyPayment`
currently retires the oldest child voucher completely before touching the next.
The rule is now an equal share per child, capped at what each child actually
owes, with anything a capped child could not absorb redistributed over the rest,
repeated until the money is placed or nothing is left owing. Remainder paise go
to the largest outstanding balance so the sum is exact to the paisa. Each child
still gets its own `fee_payments` row and its own status recomputation, and the
message on screen says "spread evenly" rather than "oldest first".
