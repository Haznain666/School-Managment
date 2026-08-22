# Sprint 14 — Exam Terms, Schedules, Promotion Criteria & Result Visibility

**Branch:** `claude/exam-term-schedule-config-4966ec`
**Migration number:** `0029` (next free — STATE.md says 0027 and 0028 are applied)
**Status:** spec agreed with the product owner on 2026-08-22, three rounds of
questions. Every decision below is an *answer*, not a proposal.

---

## 0. What already exists, and why this sprint is a layer and not a rewrite

Sprint 9 shipped a complete exam module. Read these before writing anything:

| Table | Holds |
| --- | --- |
| `exam_terms` | the assessment window a report card is issued for |
| `exams` | **one term's exam for one section**, with `grade_id` denormalised |
| `exam_subjects` | one paper — `max_marks`, `passing_marks`, date, slot, status |
| `exam_results` | one student's mark for one paper, `attempt` 1 or 2, `remarks` |
| `grading_schemes` / `grading_bands` | percentage → letter, per school |
| `promotion_runs` / `promotion_decisions` | rolling a grade into the next year |

`lib/exam-queries.ts` (1202 lines), `lib/grading.ts`, `lib/portal-results.ts`,
`lib/exam-print.ts` and `components/exams/*` are the surfaces. **Nothing here is
deleted.** Everything this sprint adds sits above or beside it.

Note the distinction that runs through the whole sprint: **`promotion_runs` is
enrolment plumbing** (which section is this child in next September).
**`student_term_results.final_status` is the academic judgement** (did this child
pass). They are different facts and this sprint does not merge them.

---

## 1. The two mechanisms

A school picks, **per grade, per academic year**, one of:

| Mechanism | Teacher enters | Result sheet columns | Promotion decided by |
| --- | --- | --- | --- |
| `marks_grades` | marks only | Subject / Marks % / Grade / Comment | percentage rules |
| `descriptors` | a sub-category + comment, **no marks** | Subject / Sub-Category / Comment | descriptor rules |

These are alternatives. A `descriptors` grade has no marks, no percentages and
no letter grades anywhere — not on screen, not on the printed card. A
`marks_grades` grade has **no sub-category column at all**.

This was settled explicitly: *"Two separate sheets — descriptors have no
marks."* The example sheet in the original brief which showed marks, grades and
a sub-category on the same row was illustrative and is **not** the target.

---

## 2. Schema — migration `0029_sprint14_exam_terms_promotion.sql`

Hand-write the SQL. Do not trust `drizzle-kit generate` to produce the partial
unique indexes or the CHECK relaxations below; generate, then read every line.

### 2.1 `exam_terms` — sequence, soft delete, 50-char name

```sql
ALTER TABLE exam_terms ADD COLUMN sequence_order integer NOT NULL DEFAULT 0;
ALTER TABLE exam_terms ADD COLUMN archived_at timestamptz;
ALTER TABLE exam_terms ADD COLUMN archived_by uuid REFERENCES school_users(id) ON DELETE SET NULL;
ALTER TABLE exam_terms ALTER COLUMN start_date DROP NOT NULL;
ALTER TABLE exam_terms ALTER COLUMN end_date   DROP NOT NULL;
ALTER TABLE exam_terms ADD CONSTRAINT exam_terms_name_length_check
  CHECK (char_length(btrim(name)) BETWEEN 1 AND 50);
DROP INDEX IF EXISTS exam_terms_location_year_name_idx;
CREATE UNIQUE INDEX exam_terms_location_year_name_idx
  ON exam_terms (location_id, academic_year_id, name) WHERE archived_at IS NULL;
```

Backfill `sequence_order` from `start_date` so existing terms keep their order:
`UPDATE exam_terms SET sequence_order = t.rn FROM (SELECT id, row_number() OVER
(PARTITION BY location_id, academic_year_id ORDER BY start_date, created_at) rn
FROM exam_terms) t WHERE exam_terms.id = t.id;`

**Why the term dates become nullable:** the authoritative dates now live on the
schedule instance, because they differ per grade. A term-level window is still
offered as an optional envelope for calendar views, and where it is blank the UI
shows the min start / max end across the term's schedules.

### 2.2 `exam_schedules` — the per-grade instance

```
exam_schedules
  id             uuid pk default gen_random_uuid()
  location_id    text not null -> schools.location_id  ON DELETE CASCADE
  term_id        uuid not null -> exam_terms.id        ON DELETE CASCADE
  name           text not null            -- "Schedule A"; 1..50 chars
  start_date     date not null
  end_date       date                     -- optional, per spec
  archived_at    timestamptz
  archived_by    uuid -> school_users.id  ON DELETE SET NULL
  created_at, updated_at timestamptz not null default now()

  index  exam_schedules_location_id_idx    (location_id)
  index  exam_schedules_term_id_idx        (term_id)
  unique exam_schedules_term_name_idx      (term_id, name) WHERE archived_at IS NULL
  check  exam_schedules_dates_check        (end_date IS NULL OR end_date >= start_date)
  check  exam_schedules_name_length_check  (char_length(btrim(name)) BETWEEN 1 AND 50)
```

### 2.3 `exam_schedule_grades` — multi-class assignment

`term_id` is denormalised here **on purpose**: rule 4 says *a class/grade can
belong to only one schedule instance per term*, and that is a uniqueness
constraint spanning the term, not the schedule. Without the column it is an
application-level check that two concurrent requests both pass.

```
exam_schedule_grades
  id, location_id
  schedule_id  uuid not null -> exam_schedules.id ON DELETE CASCADE
  term_id      uuid not null -> exam_terms.id     ON DELETE CASCADE
  grade_id     uuid not null -> grades.id
  archived_at  timestamptz
  created_at

  index  exam_schedule_grades_schedule_idx (schedule_id)
  unique exam_schedule_grades_term_grade_idx (term_id, grade_id) WHERE archived_at IS NULL
```

Archiving a schedule **must** set `archived_at` on its grade rows in the same
transaction, or the grade stays locked out of every future schedule in that term
by an index nobody can see.

### 2.4 `exam_schedule_subjects` — the subject timetable, and where max marks live

The product owner added this late and it matters: *"when exams / terms are being
set by the School Admin, Branch Admin and Principal users, they will also enter
the maximum marks for each subject, each class. This is only applicable for the
% + Grades based promotion criteria."*

```
exam_schedule_subjects
  id, location_id
  schedule_id      uuid not null -> exam_schedules.id ON DELETE CASCADE
  subject_id       uuid not null -> subjects.id
  exam_date        date not null
  start_time       text                 -- "09:00". Free text; only ever printed.
  duration_minutes integer
  max_marks        numeric(6,2)         -- NULL in descriptor mode
  passing_marks    numeric(6,2)         -- NULL in descriptor mode
  order_index      integer not null default 0
  archived_at      timestamptz
  created_at, updated_at

  index  exam_schedule_subjects_schedule_idx (schedule_id)
  unique exam_schedule_subjects_schedule_subject_idx (schedule_id, subject_id)
         WHERE archived_at IS NULL
  check  exam_schedule_subjects_duration_check
         (duration_minutes IS NULL OR (duration_minutes > 0 AND duration_minutes <= 600))
  check  exam_schedule_subjects_marks_check
         ((max_marks IS NULL AND passing_marks IS NULL)
          OR (max_marks > 0 AND passing_marks >= 0 AND passing_marks <= max_marks))
```

A schedule groups grades that sit the same paper on the same day, so they share
max marks. A school needing different maxima for Grade 4 and Grade 5 puts them in
different schedules — which is also what its two datesheets say.

### 2.5 Linking generated exams back

```sql
ALTER TABLE exams ADD COLUMN schedule_id uuid REFERENCES exam_schedules(id) ON DELETE SET NULL;
ALTER TABLE exams ADD COLUMN archived_at timestamptz;
CREATE INDEX exams_schedule_id_idx ON exams (schedule_id);
ALTER TABLE exam_subjects ADD COLUMN schedule_subject_id uuid
  REFERENCES exam_schedule_subjects(id) ON DELETE SET NULL;
ALTER TABLE exam_subjects ADD COLUMN archived_at timestamptz;
```

Existing exams carry `schedule_id IS NULL` and keep working unchanged.

### 2.6 `result_subcategories` — the performance descriptors

```
result_subcategories
  id, location_id
  label       text not null            -- 1..40 chars
  color_hex   text                     -- '#22C55E'; NULL = no colour chosen
  sort_order  integer not null default 0
  archived_at timestamptz
  created_at, updated_at

  index  result_subcategories_location_idx (location_id)
  unique result_subcategories_location_label_idx (location_id, lower(btrim(label)))
         WHERE archived_at IS NULL
  check  result_subcategories_color_check
         (color_hex IS NULL OR color_hex ~ '^#[0-9A-Fa-f]{6}$')
  check  result_subcategories_label_length_check
         (char_length(btrim(label)) BETWEEN 1 AND 40)
```

Seed the four defaults for **every existing school** in the migration, and add
the same seed to `lib/school-bootstrap.ts` so a new school gets them:

| label | color_hex | sort_order |
| --- | --- | --- |
| Exceeding | `#22C55E` | 0 |
| Satisfactory | `#3B82F6` | 1 |
| Emerging | `#F59E0B` | 2 |
| Needs Improvement | `#EF4444` | 3 |

### 2.7 `school_exam_settings` — the two institution-wide toggles

One row per school; a **missing row means the defaults below**, so no read may
assume the row exists.

```
school_exam_settings
  location_id  text primary key -> schools.location_id ON DELETE CASCADE
  color_coding_enabled              boolean not null default true
  teachers_can_view_legacy_results  boolean not null default false
  created_at, updated_at
```

`color_coding_enabled = false` renders every sub-category as **plain text with no
colour styling, everywhere** — result sheets, dashboards, reports, print. It is
retroactive by construction: it is read at render time, never copied onto a row.

`teachers_can_view_legacy_results` defaults to **false** — the restrictive
default. School Admin, Branch Admin and Principal are exempt and always have
full legacy access.

### 2.8 `grade_promotion_criteria` — which mechanism, and the rules

```
grade_promotion_criteria
  id, location_id
  academic_year_id  uuid not null -> academic_years.id
  grade_id          uuid not null -> grades.id
  mechanism         text not null   -- 'marks_grades' | 'descriptors'
  -- marks_grades only:
  grading_scheme_id        uuid -> grading_schemes.id ON DELETE SET NULL  -- null = school default
  min_overall_percentage   numeric(5,2)   -- promoted when overall >= this
  max_failed_subjects      integer        -- null = no limit
  -- descriptors only:
  failing_subcategory_id   uuid -> result_subcategories.id ON DELETE SET NULL
  max_failing_subjects     integer        -- not promoted when count(failing) > this
  -- both:
  min_attendance_percentage numeric(5,2)  -- null = attendance is not a promotion factor
  created_at, updated_at

  unique grade_promotion_criteria_year_grade_idx (location_id, academic_year_id, grade_id)
  check  grade_promotion_criteria_mechanism_check
         (mechanism IN ('marks_grades','descriptors'))
  check  grade_promotion_criteria_pct_check
         ((min_overall_percentage IS NULL OR (min_overall_percentage >= 0 AND min_overall_percentage <= 100))
          AND (min_attendance_percentage IS NULL OR (min_attendance_percentage >= 0 AND min_attendance_percentage <= 100)))
```

**A grade with no row falls back to `marks_grades`** with the school's default
grading scheme and no thresholds — which is exactly how the product behaves
today, so nothing changes for a school that never opens this screen.

### 2.9 `exam_results` — a descriptor and a relaxed CHECK

```sql
ALTER TABLE exam_results ADD COLUMN subcategory_id uuid
  REFERENCES result_subcategories(id) ON DELETE SET NULL;
ALTER TABLE exam_results DROP CONSTRAINT exam_results_marks_check;
ALTER TABLE exam_results ADD CONSTRAINT exam_results_marks_check CHECK (
  (marks_obtained IS NULL OR marks_obtained >= 0)
  AND NOT (is_absent AND marks_obtained IS NOT NULL)
);
```

The old check demanded a mark whenever `is_absent` was false. In descriptor mode
there is no mark and the child was present, so the old rule made the only valid
descriptor row unwritable. The relaxation keeps the fact that mattered — **an
absence never carries a mark** — and drops the one that no longer holds.

`remarks` is the subject-wise comment. It already exists; do not add a second
column for it.

### 2.10 `student_term_results` — promotion status, overall row, the override

```
student_term_results
  id, location_id
  term_id             uuid not null -> exam_terms.id ON DELETE CASCADE
  student_profile_id  uuid not null -> student_profiles.id ON DELETE CASCADE
  section_id          uuid not null -> sections.id
  grade_id            uuid not null -> grades.id
  academic_year_id    uuid not null -> academic_years.id
  mechanism           text not null   -- frozen at compute time, never re-read from criteria
  overall_percentage      numeric(5,2)   -- marks mode
  overall_grade_label     text           -- marks mode; 'U' on fail
  overall_subcategory_id  uuid -> result_subcategories.id ON DELETE SET NULL  -- descriptor mode
  computed_status  text not null   -- 'promoted' | 'not_promoted'
  final_status     text not null   -- 'promoted' | 'not_promoted'
  override_reason  text
  overridden_by    uuid -> school_users.id ON DELETE SET NULL
  overridden_at    timestamptz
  computed_at      timestamptz not null default now()
  created_at, updated_at

  unique student_term_results_term_student_idx (location_id, term_id, student_profile_id)
  index  student_term_results_location_student_idx (location_id, student_profile_id)
  index  student_term_results_term_section_idx (term_id, section_id)
  check  student_term_results_status_check
         (computed_status IN ('promoted','not_promoted') AND final_status IN ('promoted','not_promoted'))
  check  student_term_results_override_check (
           (final_status = computed_status AND override_reason IS NULL)
        OR (final_status <> computed_status
            AND override_reason IS NOT NULL
            AND char_length(btrim(override_reason)) >= 10)
         )
```

**`mechanism` is frozen on the row.** A school that switches Grade 3 from
descriptors to marks next year must not have last year's report cards silently
re-render as a marks sheet with every column empty.

**The override reason is a first-class output, not an audit note.** The product
owner: *"when any change is made by the teacher, they have to compulsorily enter
reason for making the change. That change comment must be visible to all the
relevant authorities on their portals including parents."* It prints on the
report card and shows on the parent and student portals.

### 2.11 Class teacher

```sql
ALTER TABLE staff ADD COLUMN is_class_teacher boolean NOT NULL DEFAULT false;
ALTER TABLE sections ADD COLUMN class_teacher_id uuid REFERENCES staff(id) ON DELETE SET NULL;
CREATE INDEX sections_class_teacher_id_idx ON sections (class_teacher_id);
```

The staff form gets a radio — **Class Teacher (Home Room) / None**. Confirmed as
one option, not two: *"Same thing, one option."* Only staff with
`is_class_teacher = true` are offered in a section's class-teacher picker.

### 2.12 Permissions

One new key, inserted into `role_permissions` for the roles that already hold
`results.publish`:

```
'results.promotion' — 'Set and override a student's promotion status for a term'
```

Add it to `lib/permissions.ts` — the key list, the `exams` group, the
description map, the rationale map and the role defaults. Grant it to:
`school_admin`, `branch_admin`, `principal`. **Not** to `teacher` — a teacher's
authority comes from being the section's class teacher, checked per section, not
from a role key. Follow how `0027` seeded the three accounting keys.

---

## 3. `lib/` — the rules, written once

### 3.1 `lib/grading.ts` additions

```ts
/** The grade a school gives a mark that falls under every band. */
export const FAIL_GRADE_LABEL = 'U';

export interface ResolvedGrade {
  label: string;          // band label, or 'U'
  isFail: boolean;
  band: ResolvedBand | null;
}

/** A percentage as the letter a report card prints, fail included. */
export function resolveGrade(pct: number, bands: readonly ResolvedBand[]): ResolvedGrade;

/**
 * The overall percentage: the ARITHMETIC MEAN of the subject percentages.
 *
 * Not total-obtained over total-available. The product owner asked for the mean
 * of the percentages, and the two differ whenever papers carry different
 * maxima — which is normal. Returns null for an empty list.
 */
export function overallPercentage(subjectPercentages: readonly number[]): number | null;
```

`resolveBand` keeps its current behaviour exactly — returning `null` below every
band. `resolveGrade` is the layer that turns that null into `'U'`, so the
existing "a school that configured nothing grades nothing" rule survives: check
`bands.length === 0` first and return `{ label: '—', isFail: false, band: null }`.

Absent papers do not contribute a percentage to the mean, matching the existing
policy in `lib/exam-queries.ts` that an absence takes no position in class.

### 3.2 `lib/result-subcategories.ts` (new)

Dependency-free, like `lib/grading.ts`, because the settings editor previews in
the browser and the report card renders on the server:

- `subcategoryProblem(label, colorHex, existingLabels): string | null`
- `normalizeHex(value): string | null` — accepts `#22C55E`, `22c55e`,
  `rgb(34,197,94)`; returns canonical uppercase `#RRGGBB` or null
- `subcategoryStyle(sub, colorCodingEnabled)` — returns
  `{ backgroundColor, color }` or `{}`. Text colour is auto-contrasted; reuse
  `lib/color-contrast.ts`, which already exists.
- `SUBCATEGORY_EMPTY = '—'`

### 3.3 `lib/promotion-criteria.ts` (new)

The mechanism resolver and the two rule engines. Pure functions, no database:

```ts
export type PromotionMechanism = 'marks_grades' | 'descriptors';
export type PromotionStatus = 'promoted' | 'not_promoted';

export interface CriteriaRow { … }               // mirrors grade_promotion_criteria
export const DEFAULT_CRITERIA: CriteriaRow;      // marks_grades, no thresholds

/** marks mode. */
export function computeMarksPromotion(input: {
  overallPercentage: number | null;
  failedSubjectCount: number;
  attendancePercentage: number | null;
  criteria: CriteriaRow;
}): { status: PromotionStatus; reasons: string[] };

/** descriptor mode. */
export function computeDescriptorPromotion(input: {
  failingSubjectCount: number;
  attendancePercentage: number | null;
  criteria: CriteriaRow;
}): { status: PromotionStatus; reasons: string[] };
```

`reasons` is shown to the class teacher beside the computed status — a teacher
asked to override needs to see what they are overriding.

**When a criterion is null it is not applied.** A grade whose criteria row sets
only `min_overall_percentage` is judged on that alone. A grade with every field
null computes `promoted` — the product has never withheld promotion by itself
and this sprint must not start doing so silently.

### 3.4 `lib/exam-queries.ts` additions

New functions — do not rewrite the existing ones:

- `listExamSchedules(locationId, termId)` → schedules with their grades and subject rows
- `getExamSchedule(locationId, scheduleId)`
- `gradesTakenInTerm(locationId, termId, exceptScheduleId?)` → for rule 4
- `resolveGradeCriteria(locationId, academicYearId, gradeId)` → row or `DEFAULT_CRITERIA`
- `listResultSubcategories(locationId)` → active, in `sort_order`
- `getExamSettings(locationId)` → `{ colorCodingEnabled, teachersCanViewLegacyResults }`, defaulted
- `getSectionTermResults(locationId, termId, sectionId)` → the class-teacher screen
- `listStudentTermHistory(locationId, studentProfileId)` → every year, newest first
- `isClassTeacherOfSection(locationId, staffId, sectionId)`
- `computeSectionTermResults(...)` → recompute and upsert `student_term_results`,
  preserving any existing override whose `final_status` still differs

**Academic year date bounds.** `academic_years` stores `start_month/start_year`
and `end_month/end_year`, not dates. Add
`academicYearBounds(year): { start: string; end: string }` to
`lib/academics-queries.ts` — first day of the start month to the last day of the
end month — and validate every schedule date against it (rule 5).

### 3.5 `lib/portal-results.ts`

Extend the parent/student payload with: promotion status, override reason,
the overall row (percentage + grade, or overall descriptor), per-subject
descriptors and comments, and the historical list. Respect the mechanism frozen
on each `student_term_results` row.

---

## 4. API routes

All under `app/api/school/`. Every one uses `requireSchoolPermission` and scopes
every query by `locationId`. Follow the shapes in `lib/api-response.ts`.

| Route | Methods | Permission |
| --- | --- | --- |
| `exam-terms/route.ts` *(exists)* | add `sequenceOrder`, 50-char name | `exams.write` |
| `exam-terms/[termId]/route.ts` *(exists)* | `DELETE` becomes **archive**, cascading to schedules, schedule grades, schedule subjects and generated exams | `exams.write` |
| `exam-terms/reorder/route.ts` | `PATCH` — `[{id, sequenceOrder}]` in one transaction | `exams.write` |
| `exam-terms/[termId]/schedules/route.ts` | `GET`, `POST` | `exams.read` / `exams.write` |
| `exam-schedules/[scheduleId]/route.ts` | `GET`, `PATCH`, `DELETE`(archive) | `exams.read` / `exams.write` |
| `exam-schedules/[scheduleId]/generate/route.ts` | `POST` — create `exams` + `exam_subjects` for every active section of every assigned grade | `exams.write` |
| `result-subcategories/route.ts` | `GET`, `POST` | `exams.read` / `exams.write` |
| `result-subcategories/[id]/route.ts` | `PATCH`, `DELETE` | `exams.write` |
| `result-subcategories/reorder/route.ts` | `PATCH` | `exams.write` |
| `exam-settings/route.ts` | `GET`, `PATCH` (the two toggles) | `exams.read` / `exams.write` |
| `promotion-criteria/route.ts` | `GET`, `PUT` (upsert per grade+year) | `exams.read` / `exams.write` |
| `terms/[termId]/sections/[sectionId]/results/route.ts` | `GET`, `POST` (recompute), `PATCH` (override / overall descriptor) | see below |
| `exam-subjects/[examSubjectId]/results/route.ts` *(exists)* | accept `subcategoryId` and `remarks`; refuse marks in descriptor mode and refuse a descriptor in marks mode | `results.enter` |

### 4.1 The generate endpoint

For each grade on the schedule, for each **active section of that grade in the
term's academic year**, create one `exams` row (`schedule_id` set, `exam_date` =
schedule `start_date`, title = `<term name> — <schedule name>`) and one
`exam_subjects` row per `exam_schedule_subjects` row, copying `exam_date`,
`slot` (from `start_time`), `order_index`, `max_marks` and `passing_marks`.

**Idempotent.** Re-running updates dates and maxima on papers that already carry
a `schedule_subject_id` and creates only what is missing. It never deletes a
paper that has marks against it; if a subject is removed from the schedule and
its paper has results, archive the paper and say so in the response.

In descriptor mode `max_marks`/`passing_marks` are null on the schedule, but
`exam_subjects.max_marks` is `NOT NULL` with a `> 0` CHECK. Write `1` and
`0`, and never read them in descriptor mode. *(Do not relax that CHECK — the
marks path depends on it.)*

### 4.2 The override endpoint

`PATCH .../results` with `{ studentProfileId, finalStatus, overrideReason?,
overallSubcategoryId? }`.

Authorised for: a holder of `results.promotion`, **or** the staff member who is
`sections.class_teacher_id` for that section. Nobody else, including a subject
teacher timetabled to the section.

`overrideReason` is **required and at least 10 characters** whenever
`finalStatus` differs from `computed_status`. Reject with a 422 and a message
naming the requirement — the database CHECK is the backstop, not the error
message the clerk reads.

Setting `finalStatus` back to equal `computed_status` clears `override_reason`,
`overridden_by` and `overridden_at`. Half an override left behind is a comment on
a parent's portal explaining a decision that was reversed.

---

## 5. Screens

### 5.1 School Admin / Branch Admin / Principal

Everything under `app/(school-admin)/dashboard/exams/`. **Every server-fetching
page needs a `loading.tsx` with the right `Skeleton` shape — see CLAUDE.md.**

| Route | Contents |
| --- | --- |
| `terms/page.tsx` | term list in `sequence_order`, reorder, create, edit, archive. Name field capped at 50 with a live counter. |
| `terms/[termId]/page.tsx` | the term's schedule instances: name, assigned grades (`MultiSelect`), start/end date, and the subject timetable — subject, date, start time, duration, max marks, passing marks. "Generate exams" button. |
| `settings/page.tsx` | sub-category CRUD, drag-to-reorder, colour picker, **Enable Color Coding** toggle, **Allow Teachers to View Student Legacy Results** toggle. |
| `criteria/page.tsx` | one row per grade for the active year: mechanism radio and the fields that mechanism uses. |
| `report-cards/*` *(exists)* | render both mechanisms; show promotion status and the override reason. |

The `exams/layout.tsx` module gate already covers all of these. Add the new
routes to the exams sub-navigation.

Sub-category deletion follows option **(a)** from the brief: **block with a
warning** that names how many student records use it, and offer archive instead.
Archiving hides it from the pickers and leaves every historical sheet rendering
exactly as it was issued.

### 5.2 Teacher

| Route | Contents |
| --- | --- |
| `teacher/exams/page.tsx` *(new)* | the terms and schedules **for the teacher's own sections only** — term name, start/end, and the subject-wise timetable rows for the subjects they teach. |
| `teacher/marks/[examSubjectId]/page.tsx` *(exists)* | in `marks_grades` mode: marks + a comment per student. In `descriptors` mode: **no marks column at all** — a sub-category picker and a comment per student. |
| `teacher/promotions/page.tsx` *(new)* | class teachers only. Their section(s), each student's computed status with its reasons, the override control with a compulsory reason, and — in descriptor mode — the overall sub-category picker. |
| Legacy results | gated by `teachers_can_view_legacy_results`. When off, the teacher sees the **current academic year only** and the history section is absent, not disabled-with-a-tooltip. |

A teacher who is not a class teacher of any section gets `teacher/promotions`
hidden from the nav **and** refused by the page.

### 5.3 Parent / Student

`app/(parent)/parent/results` and `app/(student)/student/results` gain, per term:
Promotion Status, the override reason when there is one, the overall row, and
per-subject descriptors and comments. Plus the full historical list — every
academic year the child has results for, newest first. Print output matches.

### 5.4 Rendering a sub-category

One shared component, used everywhere a descriptor appears —
`components/exams/SubcategoryBadge.tsx`:

```tsx
<SubcategoryBadge subcategory={sub} colorCoded={settings.colorCodingEnabled} />
```

Colour on → a chip with the sub-category's background and an auto-contrasted
foreground. Colour off → the plain label, no styling, no chip. Null → `—`.
There must be exactly one implementation, or the toggle will be honoured on
three screens out of five.

---

## 6. Validation rules — the complete list

1. Term name unique within the academic year, among **unarchived** terms. 1–50 characters.
2. Term `sequence_order` unique within the year; the reorder endpoint rewrites the whole list in one transaction.
3. A grade belongs to **at most one unarchived schedule per term**. Enforced by the partial unique index *and* checked in the route so the user gets a sentence rather than a constraint violation.
4. Every schedule date falls inside the term's academic year bounds.
5. `end_date >= start_date` on a schedule; every `exam_schedule_subjects.exam_date` falls within its schedule's window.
6. Deleting a term, a schedule or a sub-category **archives**. Nothing in this sprint issues a `DELETE`.
7. `max_marks` / `passing_marks` are required in `marks_grades` mode and refused in `descriptors` mode.
8. An override without a reason of 10+ characters is refused.
9. Marks are refused for a `descriptors` grade; a sub-category is refused for a `marks_grades` grade.

---

## 7. Green build

All nine must pass, plus `check-portals`:

```
npm run typecheck
npm run lint
npm run check-loaders
npm run check-forms
npm run check-address-phone
npm run check-cnic
npm run check-sprint-periods
npm run check-accounting
npm run build
```

**Delete `D:\School-Management-System\.claude\worktrees\node_modules` before
every build** — STATE.md §5f.

---

## 8. Out of scope, said explicitly

- Merging `promotion_runs` with `student_term_results`. Two different facts.
- Re-sit handling for descriptor mode. A descriptor is not re-sat.
- Changing how `resolveBand` treats a score under every band. `resolveGrade`
  wraps it; the old function is untouched and its callers keep their behaviour.
