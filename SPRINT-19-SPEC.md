# SPRINT-19-SPEC.md — the branch is the unit, and the owner sees across them

Reported by the product owner on 2026-08-29 against a live multi-branch school.
Four architecture decisions were taken with the product owner before any code
was written; they are recorded in §0 and are **not** to be re-litigated
mid-sprint.

Delivered in **two phases**, each merged, migrated and QA'd on its own:

| Phase | Items | Migration |
| --- | --- | --- |
| **19a** — the branch boundary | 1–13 | `0035` |
| **19b** — admissions, documents, history | 14–19 | `0036` |

---

## §0. The four decisions

**D1 — A catalogue row belongs to one branch, or to none.**
`subjects`, `fee_types`, `grading_schemes`, `exam_terms`, `concession_schemes`,
`leave_types`, `salary_components`, `result_subcategories` and `late_fee_rules`
gain a **nullable** `branch_id`. `NULL` means *shared by every branch* and is
what every existing row is, so nothing changes for any school on the day this
deploys. A value means *this campus only*.

Rejected: a `NOT NULL` backfill to the main branch. A three-campus school would
have to re-create the same grading scheme three times, and the backfill cannot
be undone.

**D2 — Cross-branch access is granted per person, not per role.**
New table `school_user_branches`. The school owner ticks which *additional*
campuses a branch admin or principal may see. A role-level permission would
grant it to every holder of that role at once, which is not what was asked.

**D3 — The owner is `school_admin` with `branch_id IS NULL`. Extra hats are
assignments, not accounts.**
One person, one login, many scopes. When the branch form's *Branch Principal*
toggle is answered "the school owner", it writes a `principal_assignments` row
for that branch — **no invitation, no password email**, exactly as asked. When
*Branch Admin* is answered the same way it writes a `school_user_branches` row.
A second `school_users` row per hat is refused: it breaks the
one-membership-per-person unique index and puts the owner in Users & Staff
twice.

**D4 — Two phases.** 19a fixes the data leak and ships the owner dashboard.
19b is admissions. Each gets its own migration, PR, QA pass and release note.

---

# PHASE 19a

## Item 1 — "Principal name" becomes "Head of School"

`components/school/SchoolProfileForm.tsx` — the field label and its hint.
`app/(super-admin)/super-admin/schools/[schoolId]/page.tsx:102` — the `Field`
label. `components/super-admin/SchoolForm.tsx` — the same field on the create
form.

**The column stays `schools.principal_name`.** A column rename is 1,200 lines
of unreviewable diff for a caption. `lib/global-search.ts:915` searches it and
keeps working untouched.

Note the interaction with Item 10: this field is the *school group's* head — the
person whose name prints on a group letterhead. The per-campus principal is a
`principal_assignments` row and is set on the branch, which is why the Settings
page loses its principal card and this field survives.

## Item 2 — The branch boundary, enforced

### 2a. `lib/branch-scope.ts` — one resolver, and every read goes through it

```ts
export interface BranchScope {
  /** null = every branch of this school. Otherwise the ids this caller may read. */
  branchIds: string[] | null;
  /** What the branch selector offers. Empty when the school has one branch. */
  options: { id: string; name: string }[];
  /** The branch the caller asked for, once validated against `branchIds`. */
  selected: string | null;
  /** True when the school has exactly one branch: pin it, hide the selector. */
  pinned: boolean;
}

export async function resolveBranchScope(
  locationId: string,
  claims: SchoolSessionClaims,
  requested?: string | null,
): Promise<BranchScope>;
```

Rules, in order:

1. `claims.branchId === null` **and** the role is `school_admin` →
   `branchIds: null`. Every campus. This is the owner.
2. `claims.branchId !== null` → `branchIds = [claims.branchId, ...extras]`,
   where `extras` are this person's `school_user_branches` rows. A branch admin
   with nothing granted gets exactly one id.
3. `claims.branchId === null` and the role is *not* `school_admin` (a principal
   appointed across the whole school) → `branchIds: null`, narrowed further by
   `resolvePrincipalScope` as it already is.
4. `requested` is honoured only when it appears in `branchIds`, or when
   `branchIds` is null and it is a real branch of this school. **An unknown or
   out-of-scope id resolves to `selected: null`, never to a 500 and never to
   somebody else's campus.**
5. One branch in the school → `pinned: true`, `selected` is that branch,
   `options` is empty. Item 13.

`resolveBranchScope` is `server-only` and request-cached with React `cache()`,
because a page and its layout will both ask.

### 2b. `school_user_branches`

```
id                uuid pk
location_id       text not null -> schools.location_id  on delete cascade
school_user_id    uuid not null -> school_users.id      on delete cascade
branch_id         uuid not null -> branches.id          on delete cascade
granted_by_uid    text
created_at        timestamptz not null default now()

unique (school_user_id, branch_id)
index  (location_id, school_user_id)
```

`granted_by_uid` is kept because "who gave this principal the Karachi campus"
is a question a school group gets asked, and a deleted grant answers it with
silence.

### 2c. The nullable `branch_id` columns

Nine tables, all the same shape:

```sql
ALTER TABLE subjects ADD COLUMN branch_id uuid
  REFERENCES branches(id) ON DELETE SET NULL;
CREATE INDEX subjects_location_branch_idx ON subjects (location_id, branch_id);
```

`subjects`, `fee_types`, `grading_schemes`, `exam_terms`, `concession_schemes`,
`leave_types`, `salary_components`, `result_subcategories`, `late_fee_rules`.

**`ON DELETE SET NULL`, never `CASCADE`.** Deleting a campus must not delete
the school's grading scheme. A branch-owned row whose branch is gone becomes
shared, which is the safe direction.

**The predicate every read uses:**

```ts
// shared rows plus this scope's own
scope.branchIds === null
  ? undefined
  : or(isNull(t.branchId), inArray(t.branchId, scope.branchIds))
```

Never `eq(t.branchId, x)` on these tables — that hides every shared row.

### 2d. Every listing filters

Tables that already carry `branch_id` and must now be filtered by the resolved
scope rather than by `claims.branchId` alone: `grades` (and therefore
`sections`, `fee_structures`, `period_structure_grades`, and every student
query that joins through a grade), `students`, `staff`,
`admission_applications`, `announcements`, `expenses`, `ledger_transactions`,
`ledger_accounts`, `payroll_runs`, `payslips`, `school_users`,
`school_invitations`.

Audit every `lib/*-queries.ts` for a listing that takes `locationId` and no
branch. The known offenders as of this spec, all of which return every campus'
rows to a branch-bound caller today:

- `lib/school-queries.ts` — the user list
- `lib/academics-queries.ts` — subjects, timetable
- `lib/fee-queries.ts` — fee types, structures, the voucher register
- `lib/exam-queries.ts` — terms, exams, schemes
- `lib/hr-queries.ts` — staff, leave types, salary components
- `lib/concession-schemes.ts`
- `lib/defaulters.ts`
- `lib/global-search.ts` — **search is the widest leak of all**, because it
  crosses every module in one query

### 2e. Writes refuse an out-of-scope branch

Every POST/PATCH that accepts a `branchId` re-resolves the scope and returns
**403** with a sentence naming the campus, not a silent write. This is the same
guard `POST /api/school/timetable/entries` already applies to period structures
and for the same reason: a stale tab left open across a reassignment writes a
row that satisfies every constraint and appears in no listing.

### 2f. A check script

`npm run check-branch-scope`, added to the green build and to
`.github/workflows/ci.yml` (it needs no database). It fails when a file in
`lib/` exports a listing function whose parameters include `locationId` and
which selects from one of the branch-owned tables **without** referencing
`branchIds` or `branchScope`. Allowlist by explicit comment, the way
`check-accounting` does, so an intentional school-wide read is a decision
somebody wrote down.

## Item 3 — One way to create a branch, everywhere

`components/super-admin/BranchForm.tsx` is already shared between the Super
Admin wizard and the Super Admin branch pages. It gains two toggle groups and
becomes the *only* branch form in the product.

**Branch Admin** — toggle off by default.
On: a radio — *The school owner* / *Somebody else*.
- *The school owner* → writes `school_user_branches(owner, thisBranch)`.
  **No invite. No password email.** The screen says so in one sentence.
- *Somebody else* → full name, mobile (`PhoneField`), email. Creates a
  `school_users` row with `role: 'branch_admin'`, `branch_id: thisBranch`, and
  sends the password-creation email through the existing invite sender.

**Branch Principal** — identical shape, `role: 'principal'`, and additionally
writes a `principal_assignments` row scoped to this branch with
`starts_on = today`.

Both are optional and both may be on at once. Validation is server-side in
`app/api/school/branches/route.ts` and
`app/api/super-admin/schools/[schoolId]/branches/route.ts` — **the same
validator module**, not two copies.

The existing `inviteAsBranchAdmin` boolean is replaced by this, not kept beside
it. Migrate its one call site.

**Where the form now appears, all rendering the same component:**

| Screen | Route |
| --- | --- |
| Super Admin wizard step 2 | existing |
| Super Admin branch create/edit | existing |
| School portal branch create | `/dashboard/branches/new` — existing |
| School portal branch **edit** | `/dashboard/branches/[branchId]/edit` — **new** |

## Item 4 — The owner dashboard

### The branch selector

A `Select` at the top of `/dashboard`, above the exception strip.
- Owner: `All branches` + one entry per campus. Default `All branches`.
- Branch-bound with no grants: hidden, pinned to their campus.
- Branch-bound with grants: their campus + granted ones, no `All branches`
  unless every campus is granted.
- School with one branch: hidden entirely (Item 13).

It writes `?branch=<id>` and the page is already `force-dynamic`, so this costs
no new render mode. An unknown id falls back to `All branches` rather than
erroring — Item 2a rule 4.

### What the owner sees that a principal does not

The gap, stated plainly, because it is what decides the tile list:

| Question | A principal asks | The owner asks |
| --- | --- | --- |
| Money in | Did we collect this month? | **Which campus is behind, and by how much?** |
| Money out | *(not their screen)* | **What does each campus cost against what it brings in?** |
| Growth | How many in my classes? | **Which campus is growing and which is shrinking?** |
| Risk | Who owes me? | **Where is the debt concentrated, and how old is it?** |
| Quality | How did 5-A do? | **Is one campus systematically below the group?** |
| Setup | Is my campus configured? | *(not the owner's job — Item 4d)* |

### 4a. Five group tiles, each with a comparison

A KPI without a benchmark is a number, not an indicator. Every tile carries
one, and when the scope is *All branches* every tile also names its worst
campus — which is the whole reason an owner opened the screen.

1. **Students enrolled** — total; vs last month; "across N campuses"
2. **Collected this month** — PKR; vs the same day last month; collection rate %
3. **Outstanding** — PKR owed; share over 90 days
4. **Net position this month** — ledger income − expense. **Owner-only.** A
   branch principal does not hold `accounting.read` by default and must not see
   this tile appear and vanish; it is gated on the permission, not the role.
5. **Attendance today** — % present; worst campus named

`settle()` wraps every one of them, exactly as the existing dashboard does: a
failed read is one absent tile with a reason, never a zero. `PKR 0` on a school
that banked three lakh this morning is confidently wrong and the reader cannot
falsify it.

### 4b. Charts — and the type chosen for each, with the reason

| # | Chart | Type | Why this and not something else |
| --- | --- | --- | --- |
| a | **Collection by campus** | `BarChart` **horizontal**, 2 series (Billed, Collected) | Campus names are words, not codes. Horizontal is the mode this repo built for exactly that (see `BarChart`'s docblock). Grouped, not stacked: the comparison is billed *against* collected, not their total. |
| b | **Income vs expense by campus** | `BarChart` horizontal, 2 series | Same reason. Never a dual y-axis — both series are PKR, so one axis is honest. |
| c | **Enrolment share** | `DonutChart` at ≤5 campuses, `BarChart` horizontal above that | Part-of-whole is a donut's one job, and a donut stops working past five slices. The switch is on `branches.length`, in the page, not in the chart. |
| d | **12-month collection trend** | `LineChart`, one line per campus | A time series is a line. **Capped at six lines**; beyond six, plot the group total plus the five largest campuses and fold the remainder into one `Other` line, named as such in the summary. Seven colours on one axis is a rainbow, and the repo's ramp has six. |
| e | **Aged debt** | *(no cross-branch chart)* | Five buckets × eight campuses is forty grouped bars. It becomes the scorecard's five money columns instead. When **one** campus is selected, the existing aging chart renders unchanged. |
| f | **Per-campus scorecard** | `DataTable` | The owner's actual working artifact, and the only form that still reads at twenty campuses. Columns: Campus · Students · Attendance · Billed · Collected · Rate · Outstanding · Over 90d. Sortable on every column. Each row links to that campus's own dashboard (`?branch=<id>`). |

When a **single branch is selected**, the dashboard renders exactly what it
renders today, scoped — no cross-branch charts, because there is nothing to
compare. `(a)`–`(d)` and `(f)` appear only under *All branches*.

### 4c. `getRecentExamOutcomes` — the label overflow

See Item 5. Same fix serves both scopes.

### 4d. `SetupProgressCard` moves off the owner's dashboard

The panel is per-campus, so it belongs to whoever runs a campus. Rendered when:
- the viewer is branch-bound (`claims.branchId !== null`), **or**
- the viewer is the owner **and** a specific branch is selected.

A one-branch school is pinned to its only campus (Item 13), so the owner of a
one-branch school still sees it — which is the case where it matters most, and
a rule that hid it from them would be worse than the bug it fixes.

## Item 5 — The exam-outcomes chart draws outside itself

`components/charts/BarChart.tsx`, horizontal branch, the category `<text>` at
`x = axisX - 10` with `textAnchor="end"`. `H_PADDING.left` is 172 units and
nothing clips or truncates, so `"Mid-Term Examination · Grade 5 - A"` runs off
the left edge of the viewBox and over the card.

Fix, all three parts:
1. Truncate the category to what fits the label column — ~26 characters at
   11px in a 162-unit budget — with a single `…`.
2. Give every truncated label an SVG `<title>` carrying the full string, so a
   hover answers it.
3. The full, untruncated string stays in the hidden data table and in
   `summary`. **The chart may abbreviate; the accessible copy may not.**

Applies to every horizontal `BarChart`, not just this one — the Super Admin
module-adoption chart has the same exposure.

## Item 6 — The sidebar collapses, and starts closed

`components/school/PortalSidebar.tsx`. Every `PortalNavSection` becomes a
disclosure: heading is a `<button aria-expanded>` with a chevron, its `<ul>` is
`hidden` when closed.

- **Closed by default**, all of them.
- The section containing the current route **opens on load**, and cannot be the
  reason a reader cannot see where they are.
- Open/closed state persists per section in `localStorage`, wrapped in
  `try/catch` — a private window must render a working sidebar.
- The flat `items` (Dashboard, Users, Branches, Communications, Reports,
  Settings, Feedback) are not in sections and do not collapse.
- Collapsed (icon-only) mode already replaces headings with a rule; disclosure
  is suppressed there and the items stay visible, because there is no heading
  left to click.

Applies to the teacher, student and parent portals too — they share
`PortalSidebar`.

## Item 7 — Users & Staff pages at 50

`/dashboard/users` currently renders every row. Move it onto `DataTable` +
`readListQuery`, `defaultLimit: 50`, with a total count query beside the page
query. Sortable on name, role, campus, status. Search on name / email / phone.

The count query must carry the **same** filters as the page query, including
the branch scope — a total that counts rows the page cannot show pages the
reader off the end of the list. (§5bf recorded this exact trap on the student
list.)

## Item 8 — A branch is editable from the school portal

New `/dashboard/branches/[branchId]` (detail) and
`/dashboard/branches/[branchId]/edit`. The list rows become links.

- Edit renders the Item 3 `BranchForm` with `initial` filled.
- Delete is a `DELETE` on `/api/school/branches/[branchId]`, gated on a new
  **`branches.manage`** permission (default: `school_admin` only), and **refuses
  with 409** when the branch still has students, staff or ledger entries. The
  message names the counts and offers *deactivate instead*. A campus with a
  child enrolled in it is not a row anybody may drop.
- The confirm modal requires the branch **code** to be typed. Every group has
  two campuses called "Main".

`branches.manage` joins `PERMISSION_GROUPS` so the permissions screen picks it
up without further work, and is added to the `role_permissions` CHECK in
`0035`.

## Item 9 — Every report offers a campus

`lib/report-catalogue.ts`. Four of the fourteen have no `branch` filter today:
`academic-results`, `account-summary`, `monthly-accounts`,
`income-expense-summary`. Add `'branch'` to each and thread it through its
query in `lib/report-queries.ts`.

`lib/report-options.ts` already suppresses the campus dropdown for a
branch-bound caller. It must now offer the *granted* set instead of nothing:
read `resolveBranchScope`, not `sessionBranchId`.

The dropdown's first option is **All branches** for anyone whose scope is
`null`, and the printed sheet's header line must say which — `describeScope`
already names the term the dropdown was showing, and it must name this too. A
printout captioned with the wrong scope is worse than an uncaptioned one.

## Item 10 — Settings loses the principal card

Remove `<PrincipalAssignments />` from
`app/(school-admin)/dashboard/settings/page.tsx`. The component is **not**
deleted — it is rendered on the branch detail page (Item 8) filtered to that
campus, which is where the question "who runs this campus" actually gets asked.

`principals.manage` keeps its meaning and its default grants.

## Item 11 — Admissions Overview takes a campus

`/dashboard/admissions` gains the same selector as Item 4, at the top, above
the funnel. Same `?branch=` parameter, same resolver, same pinning rule.

## Item 12 — Branch-bound users see one campus

This is Items 2d and 2e, and it is listed separately because it is the
acceptance criterion QA drives: **sign in as a branch admin of campus B and
confirm that no screen, report, search result or export in the product returns
a row belonging to campus A** — unless campus A appears in their
`school_user_branches`.

## Item 13 — One branch means no question

Every branch selector in the product — dashboard, admissions, reports,
announcements, expenses, the voucher generator, the enrolment form — checks
`scope.pinned` and, when true, renders no control and applies the one branch.
A dropdown with one option is a question with one answer.

---

# PHASE 19b

## Item 14 — Academic years belong to campuses, and are created in runs

### 14a. `academic_year_branches`

```
academic_year_id uuid not null -> academic_years.id on delete cascade
branch_id        uuid not null -> branches.id       on delete cascade
unique (academic_year_id, branch_id)
```

A year with no rows is school-wide, which is every existing year. The listing
gains a **Campus** column and a campus filter.

### 14b. Creating a run

The create form asks: **start month**, **end month**, **start year**, **number
of years**, and **which campuses** (multi-select; pinned when the school has
one). *N* years produces *N* rows: year *k* starts `startMonth`/`startYear + k`
and ends `endMonth` of the following year when `endMonth <= startMonth`, the
same year otherwise.

**A run never duplicates.** A candidate whose (start month, start year, end
month, campus set) already exists is **skipped silently and counted**, and the
result says "7 created, 3 already existed". Refusing the whole run because one
year exists is how a school ends up with a half-built calendar.

The same rule guards the single-year form: creating a second identical year for
a campus is refused with the existing year named and linked.

### 14c. The active year follows the calendar

Exactly one year is active — unchanged. What changes is the default: on read,
when no year is marked active, the year whose span contains `current_date` is
offered as the active one, **decided in the database**, so there is one clock.
A year the user has explicitly marked active is never overridden.

## Item 15 — Promote students

Two defects on `/dashboard/admissions/promote`:

**15a. No campus selector.** Add one (Item 4's, pinned per Item 13). Grades are
already narrowed by `claims.branchId`; they must be narrowed by the resolved
scope and by the selection.

**15b. "Goes to" is always empty.**
`components/admissions/PromotionRunner.tsx:118` filters
`section.academicYearId === toYear`. When the receiving year has no sections,
that is correctly empty — and the screen says nothing, so it reads as a broken
dropdown. It is not: the school has not built next year's classes yet.

Fix:
- When the receiving year has no sections at all, replace the table's *Goes to*
  column with one explanatory row and a link to Grades & Sections, naming the
  year: *"Nursery 2027–28 has no sections yet. Create them before promoting."*
- Offer **Copy this year's sections into 2027–28** on that message — one button
  that clones each active section of the sending year's grades into the
  receiving year. This is the actual task, and making the operator do it by
  hand across twelve grades is why the screen looked broken.
- **A student may only be promoted into a section of their own campus.** Filter
  the destination list on the sending grade's `branch_id` and re-check it in
  `POST /api/school/promotions/[runId]/apply` — a cross-campus move is a
  *transfer*, which has its own screen, its own fee split and its own record.
  Refuse with 422 naming both campuses.

## Item 16 — Student documents

### 16a. `student_documents`

```
id                 uuid pk
location_id        text not null -> schools.location_id  on delete cascade
student_profile_id uuid not null -> student_profiles.id  on delete cascade
title              text not null            -- the school's own words
storage_path       text not null
download_url       text not null
content_type       text not null            -- image/png | image/jpeg
size_bytes         integer not null
uploaded_by_uid    text
created_at         timestamptz not null default now()

index (location_id, student_profile_id)
check (content_type in ('image/png','image/jpeg'))
check (char_length(title) between 1 and 120)
```

**Ten documents per student, 5 MB each**, both enforced in the route and stated
on the form. PNG / JPG / JPEG only, checked by sniffing the magic bytes as well
as reading `Content-Type` — a renamed `.exe` presents as `image/png` to a
browser. Stored through `lib/storage.ts` at
`/{locationId}/{branchId}/student-documents/{studentProfileId}/{uuid}.{ext}`,
which is the convention that module already documents.

### 16b. On the enrolment wizard

A new step between **Academic placement** and **Review & confirm**:
*Documents*. Title + file, add another, remove. Entirely skippable — an
admissions desk with a queue in front of it must never be blocked by a birth
certificate that is at home, and a required field there produces an invented
answer rather than a document.

### 16c. On the student profile

A **Student documents** card: one chip per title, chip opens the image in a new
tab, plus **Add document** inline. Gated on `students.update` for adding and
`students.read` for seeing. Delete is `students.update` and asks first.

## Item 17 — Academic history

New `/dashboard/admissions/students/[studentId]/history`, linked from the
profile.

One row per term exam and final exam the student has a published result for:
term · exam · percentage · pass/fail · the descriptor comment
(`result_subcategories` already holds *Exceeding* / *Needs improvement* and the
school's own criteria — `lib/result-subcategories.ts`).

Clicking the percentage **or** the comment opens that result in a **new tab** —
`target="_blank" rel="noopener"` onto the existing report-card print route.

Reads only published results. An unpublished mark is not a fact about the child
yet, and a history that shows one is a history that changes after a parent has
read it.

## Item 18 — The guardian gets a full address

`components/admissions/…` guardian step: add `AddressAutocomplete` — the same
component the branch form uses, so Mapbox absence degrades to a text box
exactly as it does everywhere else. Column `student_guardians.address`
(nullable text) plus latitude/longitude, matching `branches`.

Never required. §"Blank is always allowed" in `CLAUDE.md` is about the CNIC and
the reasoning transfers whole.

## Item 19 — "Enrol" becomes "Enroll"

212 occurrences. **String literals and JSX text only** — the same restriction
Sprint 18's Challan→Voucher rename used, and for the same reason:
`const enrolment = …` is code.

`enrol` → `enroll`, `enrolment` → `enrollment`; `enrolled` / `enrolling` are
already doubled and need no change. Skip any match touching `/`, `-`, `.` or
`_` — those are routes, CSS classes and type keys, and a route rename breaks
every bookmark a school has.

`lib/enrollment.ts` and `lib/enrolment-fee-gate.ts` keep their filenames.

---

## Green build

The ten in `CLAUDE.md`, plus the new `check-branch-scope`, plus
`check-reports`, `check-dashboard` and `check-portals` — all three of which this
sprint touches directly.

`npm run build` is **not** optional. §5bg: it is the only gate with a bundler in
it, and this sprint moves constants between server and client modules in at
least three places.

## Migration numbers

`0035` — phase 19a. `0036` — phase 19b. `0034` was Sprint 18; check
`db/migrations/` before trusting either number, per the standing warning in
`STATE.md`.
