# SPRINT-23-SPEC.md — the principal's grades, the class teacher, and the discount that would not come off

**Written:** 2026-09-03
**Migration:** `0039` — next free (`STATE.md` §5bl confirms `0038` is the last applied).
**Spec agreed with the product owner** on 2026-09-03 over one round of questions.
The four answers are recorded in §0 and are **binding** — they were chosen against
stated alternatives and must not be re-litigated by whoever builds this.

---

## 0. The four decisions, and what they exclude

| # | Question | **Answer** | What this rules out |
| --- | --- | --- | --- |
| 1 | Removing a discount: does a *part-paid* voucher reprice? | **No. "Unpaid" means no payment recorded at all.** | Repricing the unpaid balance of a part-paid voucher. A voucher with any money against it is treated like a settled one. |
| 2 | Is the principal's grade scope an authorization boundary? | **No — it stays a visibility filter.** | Returning 403 from write routes. See §3's warning, which states the consequence plainly. |
| 3 | How wide does the grade filter go? | **All four surfaces**: students/staff/fees, timetable/sections, exams/results, attendance/reports/dashboards. | Nothing. This is the whole sprint's weight. |
| 4 | Who may be a section's class teacher? | **Any active staff member, and one person may hold several sections.** | The `staff.is_class_teacher` flag as a gate, and any uniqueness rule on the teacher. |

---

## 1. Removing a discount reprices unpaid vouchers

### The mechanism, established by reading the code rather than the note

`STATE.md` §5bj records this as "applying a discount reprices an already-issued
open voucher; removing one does not". That is the symptom. The cause is more
specific, and the fix follows from it:

`closeStudentConcession` (`lib/student-discounts.ts`) **already calls**
`repriceOpenChallans`. It does not appear to do anything because:

1. Closing a grant sets `valid_until` to **yesterday** (`closingDate`).
2. `repriceOneChallan` prices each voucher against **the voucher's own due
   date** — `listActiveConcessions(locationId, studentProfileId, challan.dueDate)`.

So a voucher due on the 10th, with the grant removed on the 27th, is priced as
at the 10th, when the grant was still live. It keeps its discount and the
reprice is a no-op. The existing docblock even argues for this — *"A voucher
already issued keeps its discount, which is right: it was raised for a period
the child held the grant in."* That reasoning is correct for the **passage of
time** and wrong for a **correction**, and the product owner has now separated
the two.

### What to build

**On removal only, price the voucher as at today rather than as at its due
date — and only for vouchers with no payment against them.**

- `repriceOpenChallans` gains explicit options rather than a boolean trap.
  Suggested shape, which the builder may improve on but must keep explicit:

      repriceOpenChallans(db, {
        locationId,
        studentProfileId,
        actorUid,
        // 'due-date' (default, existing behaviour) | 'today'
        priceAsOf?: 'due-date' | 'today',
        // ['unpaid','partial'] by default; removal passes ['unpaid']
        statuses?: readonly ChallanStatus[],
      })

- `closeStudentConcession` calls it with `priceAsOf: 'today'` and
  `statuses: ['unpaid']`.
- **Every other caller is untouched and keeps today's behaviour.** Granting a
  discount still reprices both `unpaid` and `partial` against the due date.
  Find every caller and say so in the commit; a silent widening here changes
  what parents owe.

### The reporting is the feature

The clerk is told, on the screen, what moved and what did not. The response
already returns `repricedVouchers`; extend it so the panel can say:

- *n vouchers repriced* — as now.
- **and, new:** *n left unchanged because a payment has been recorded against
  them.* A discount removed from the wrong child, where this month's voucher is
  already part-paid, must not look like it worked. The count of
  skipped-because-paid vouchers is the thing that prevents a silent half-
  correction, so it is returned and rendered, not logged.

`repriceOpenChallans` already returns `skipped[]` with a reason string. Use it —
add the reason "A payment has been recorded against it." and surface the list.

### Do not

- Do not touch the ledger. Nothing that has reached `ledger_transactions` moves;
  a voucher with no payment has posted nothing, which is exactly why this
  decision is safe under `CLAUDE.md`'s append-only rule. **No reversing entry is
  needed and none may be written.**
- Do not change `DELETE /api/school/fees/concessions/[id]`. It has a narrower
  job — a grant that never should have existed — and it stays as it is.
- Do not touch family vouchers. `repriceOpenChallans` already skips them with a
  reason, and that stays.

### Acceptance

1. Grant a sibling discount to a child, raise a monthly voucher, confirm the
   discount is on it. Remove the discount. **The voucher's total goes up by the
   discount and `concessionAmount` returns to 0.00.**
2. Repeat, but record a part payment before removing. **The voucher does not
   move**, and the panel says one voucher was left alone because a payment is
   recorded against it.
3. Repeat, but let the voucher be `paid`. Unchanged, and reported.
4. A grant that simply *expires* (its `valid_until` passes naturally) still
   leaves issued vouchers alone. This is the behaviour §5bj called correct and
   it must survive.

---

## 2. Distinct grades per principal, and the toggle that relaxes it

### Today

`principal_assignments.grade_ids` is a `text[]`. Nothing stops two principals at
one school holding grade 1. The assignment screen is on the **branch detail
page** (`app/(school-admin)/dashboard/branches/[branchId]/page.tsx`), rendering
`components/school/PrincipalAssignments.tsx`.

### What to build

**A new school setting: may a grade have more than one principal? Default false.**

- `schools.allow_shared_principal_grades boolean NOT NULL DEFAULT false` in
  `0039`. Default false is the product owner's instruction and it is also the
  safe default for existing rows: it changes nothing until somebody tries to
  create an overlap.
- **The toggle lives in School Admin → Settings**, per the requirement — not on
  the branch page where the assignments are. Add it to
  `app/(school-admin)/dashboard/settings/page.tsx` in a *Principals* card, and
  extend `PATCH /api/school/settings` (the route that already refuses to change
  the subdomain, code and billing state — read its docblock before adding a
  field).
- When the setting is **off** (the default), `POST /api/school/principals` and
  `PATCH /api/school/principals/[assignmentId]` refuse an assignment whose
  `grade_ids` intersect the grades of **another principal's assignment that is
  in force**, and name the clash: *"Grade 3 is already assigned to Ayesha Khan.
  Turn on 'Allow a class to have more than one principal' in Settings, or remove
  it from her assignment first."*
- The picker greys out and labels the taken grades rather than letting the
  clerk select one and then be refused. Server refuses regardless — the UI is
  the courtesy, the API is the rule. (This is `CLAUDE.md`'s guardian-relationship
  posture, applied here.)

### Three rules the builder must get right

1. **Only assignments *in force* conflict.** The resolver's own definition:
   `starts_on <= today AND (ends_on IS NULL OR ends_on >= today)`. A former head
   of grade 1 whose assignment ended is not a clash — refusing on their row
   would make a handover impossible.
2. **A person does not clash with themselves.** Editing Ayesha's own assignment
   to keep grade 3 must not be refused because Ayesha holds grade 3.
3. **Grades are already per-branch** (`grades.branch_id`, Sprint 19a), so
   distinctness falls out per campus without a special rule. Do not add one.

### Existing overlaps are grandfathered

A school may already have two principals on one grade. **The migration does not
delete or alter any assignment**, and the default false applies only to writes
from the day it ships. The assignment screen shows an existing overlap with a
warning chip — *"Also assigned to X"* — so an administrator can see and fix it
deliberately. Silently unassigning a head is not a migration's business.

### Acceptance

1. Two principals, setting off. Assign grades 1–3 to Principal 1. Opening
   Principal 2's editor shows 1–3 as taken; selecting one and saving is refused
   with a message naming Principal 1.
2. Turn the setting on. The same save succeeds.
3. Turn it off again. Existing overlap stays, is shown with the warning chip, and
   nothing was deleted.
4. End Principal 1's assignment. Grade 1 becomes assignable to Principal 2 with
   the setting off.

---

## 3. A principal sees only their grades

### The boundary, stated exactly — read before building

The product owner chose **filter reads only; do not refuse writes**. So:

> **This is a visibility filter, not an authorization boundary.** A principal's
> screens show only their grades and every grade/section dropdown offers only
> their grades. **A crafted API request outside their scope still succeeds.**
> That is a deliberate, recorded product decision and not an oversight — it must
> be written into the release note and `STATE.md` in these words, because the
> next person to read the code will otherwise "fix" it.

`lib/principal-resolver.ts` already says this is the posture the module was
designed for. Nothing about the resolver changes.

### Today, only four surfaces read the scope

`app/(school-admin)/dashboard/admissions/students/page.tsx`,
`app/api/school/students/route.ts`,
`app/(school-admin)/dashboard/page.tsx`, and `lib/portal-search.ts`.
**Everything else shows a head the whole school.** This item is wiring, applied
to four groups of surfaces:

| Group | What narrows |
| --- | --- |
| **Students, staff, fees** | Student lists, profiles and the enrolment wizard's grade picker; staff lists and the invite form's grade/section pickers; voucher lists, generation, the fee counter's student picker, defaulters and concessions |
| **Timetable, sections** | The grade and section pickers on the timetable builder, the class-teacher control from item 4, and the section list |
| **Exams, results** | Exam terms, datesheets, marks entry, tabulation sheets, report cards and position holders |
| **Attendance, reports, dashboards** | Attendance registers and their class pickers; the nine report types (`lib/report-queries.ts` — note it has its own scope plumbing already, reuse it); the school-admin dashboard tiles and charts |

### How to do it, and the traps

Read the scope with `resolvePrincipalScope(locationId, role, schoolUserId)` and
narrow with `scopeAdmitsGrade` / `scopeAdmitsBranch`, or push the grade id list
into the query's `WHERE` with `inArray`. **Do not write a second resolver.**

**`scopeAdmitsGrade` admits a null grade on purpose** — a school-wide
announcement, a student not yet placed. Do not "tighten" that; hiding
grade-less records from every head is nobody's reading of "runs the O-Levels".

**`unassigned` is a real state and must not render as an empty page.** A head
at a `multiple` school with no assignment sees nothing; `describeScope()`
already writes the sentence that says who to ask. Every screen this item touches
renders it.

**A single-principal school must be untouched.** `resolvePrincipalScope`
returns `UNSCOPED` for `principal_model = 'single'` and for every non-principal
role. Every narrowing added here must be a no-op in that case — verify it by
signing in as a school admin and confirming the screens are identical.

**Every new or widened query is executed, not read.** `CLAUDE.md` is explicit
and it has been paid for three times: add `npm run check-sprint23` on the
pattern of `check-sprint20`/`21`/`22`, executing each new statement against the
real schema with a tenant id matching no row.

### Acceptance

Signed in as a principal assigned grades 1–3 at a `multiple` school:
1. Students list shows only grades 1–3; the enrolment wizard offers only 1–3.
2. Staff list and the invite form's section picker offer only 1–3's sections.
3. Voucher list, generation and defaulters cover only 1–3.
4. Timetable, exams, attendance and reports likewise.
5. The same school switched to `single`: the principal sees everything again.
6. A school admin at the same school sees everything throughout.

---

## 4. The class teacher moves to the timetable

### The bug, precisely

`sections.class_teacher_id` (Sprint 14) points at `staff.id` and
`listClassTeacherCandidates` offers **only staff with `is_class_teacher = true`
and `status = 'active'`**. Sprint 22 made it ordinary to create a teacher from
the invite path, which writes a `staff` row without that flag — so the picker on
`GradeSetupGrid` is empty at a school whose teachers all arrived that way, and
the option looks removed.

### What to build

- **Offer any active staff member.** Drop `eq(staff.isClassTeacher, true)` from
  `listClassTeacherCandidates`. Keep the column and keep the HR control — it
  stays a useful label — but it is no longer a gate.
- **Put the control on the timetable screen**, per the requirement: the
  timetable is built per section, which is where a class teacher belongs. Keep
  the existing control on `GradeSetupGrid` as well rather than moving it — two
  doors to one column is right here, and removing the old one would break a
  workflow schools already have. Both write the same column through the same
  route (`PATCH /api/school/sections/[sectionId]`).
- **One class teacher per section is already structural** — one column. Nothing
  to add. State this in the release note rather than inventing a constraint.
- **One teacher may hold several sections** (decision 4). Add no uniqueness
  index, and if a teacher already holds another section, show it as a note next
  to their name in the picker — *"also class teacher of 4-B"* — so it is a
  choice rather than a surprise.

### Acceptance

1. A teacher invited through Users & Staff (no HR flag) appears in the picker.
2. Setting a class teacher on the timetable screen shows on `GradeSetupGrid`
   and vice versa.
3. Assigning a second teacher to one section replaces the first; the section
   never has two.
4. One teacher set on two sections is allowed and both show the note.

---

## 5. Staff photographs

### Students are already done

`student_profiles.photo_url` exists, `POST /api/school/students/[studentId]/photo`
uploads through the server (path decided from verified claims, never trusted
from the client), and the enrolment wizard's last screen shows it.
**Verify the student photo also renders on the student detail screen** for any
user with `students.read`; if it does not, that is a two-line fix in this sprint.

### Staff have nothing

- `staff.photo_url text` in `0039`.
- `POST /api/school/hr/staff/[staffId]/photo` — **copy the student route
  exactly**: 2 MB cap, `image/png|jpeg|webp` only, `uploadBuffer` +
  `buildStoragePath` from `lib/storage.ts`, path keyed by the staff id inside
  the school's own prefix. Do not invent a second upload posture.
- Show it on `components/hr/StaffDetailPanel.tsx` and as an `Avatar` in the
  staff list, gated on the same permission that already shows the record
  (`hr.read`). Use `components/ui/Avatar.tsx`, which exists.
- A staff member with no photo gets the existing initials avatar. **No
  placeholder silhouette.**

**Keep `school_users.avatar_url` out of this.** It is the account's avatar and
is unused; conflating the two would mean a staff photo changing somebody's
sign-in identity. Different fact, different column.

---

## 6. Designation defaults to the role

On `components/school/InviteForm.tsx`, when the role changes and the
**designation is empty or still holds the previous role's label**, set it to
`ROLE_LABELS[role]` from `types/school-auth.ts`.

- Never overwrite something the user typed. The "still holds the previous
  role's label" clause is what makes changing the role twice behave, without
  clobbering a real edit.
- It is a default, not a constraint: the field stays free text.

---

## 7. The date field that loses its month

**Reported:** on a 15.6" laptop the date input reads `dd------yyyy` — the month
segment is missing. Correct on a larger screen.

This is a **width** fault, not a format one. A native `input[type="date"]`
renders `dd/mm/yyyy` plus a picker icon; when the box is too narrow for its own
intrinsic width the browser clips a segment rather than shrinking. There are
**43** `type="date"` inputs across `app/` and `components/`, so this is fixed
once, in the shared layer, not per screen.

- Give `input[type="date"]` a `min-width` sufficient for the widest rendering
  plus the indicator, in `app/globals.css` or the `Input` primitive.
- **Verify at the reported width.** Use `resize_window` at 1366×768 — the
  standard 15.6" laptop viewport — and confirm on the invite form, the enrolment
  wizard, the voucher screens and the HR forms. A fix verified only at desktop
  width is not verified.
- Check the field inside narrow containers — a date in a two-column grid inside
  a modal is the worst case.

---

## 8. Date of joining cannot be more than a year ahead

On the invite form and `POST /api/school/invitations`:

- `joined_on` may not be more than **one year after today**. Refuse on the
  server with a message naming the limit; set `max` on the input as the
  courtesy.
- **A past date stays legal and unlimited.** Schools enter staff who joined
  years ago; this rule is about a typo in the year, not about backdating.
- Apply the same rule to the HR staff form (`POST /api/school/hr/staff`) if it
  takes a joining date — the two halves of Sprint 22 disagreeing about one
  person is the mistake this sprint must not repeat.

---

## 9. Definition of done

- Migration `0039` written, applied to the live database by DevOps, and
  **verified against the catalogue rather than the exit code** — the
  `SAVEPOINT`-per-refusal pattern from §5be, rolled back, row counts identical.
- `SPRINT-23-DDL-NOTES.md` at the repo root: what `0039` does, how to verify it,
  how to undo it, and **what breaks if the code deploys ahead of it**.
- New permission keys, if any, added to `PERMISSIONS` **and**
  `DEFAULT_ROLE_PERMISSIONS`. (This sprint is not expected to need any — it
  narrows sight and adds two columns.)
- `npm run check-sprint23` executing every new and widened statement.
- All ten `CLAUDE.md` gates green, plus `check-portals`, `check-dashboard`,
  `check-reports` and `check-branch-scope`, which this sprint's item 3 touches.
- `test-cases/TEST-CASES-SPRINT-23.md` and
  `release-notes/RELEASE-NOTES-SPRINT-23.md`.
- `STATE.md` §5bm, in the file's existing voice, recording the four decisions,
  the visibility-not-authorization boundary in item 3, and anything found by
  clicking.
