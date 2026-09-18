-- Sprint 33c — the portal work. `SPRINT-33-SPEC.md` Part C, STATE.md §5ci.
--
-- `0047` and `0048` are Part B's and are already applied to the live database,
-- so **this is `0049`**, not the `0048` the spec named. STATE.md settles that
-- and it is not to be renumbered again.
--
-- Two things, and only two:
--
--   1. `timetable_entries` learns two dates, so that changing who takes a
--      period stops rewriting who took it last Tuesday (C1, decision 2 —
--      "do not change legacy data");
--   2. `timetable_substitutions` — one day's cover, which is deliberately not
--      a timetable change (C4);
--
-- plus the CHECK rewrite that CLAUDE.md requires of any sprint adding a
-- permission key.
--
-- ══ Is there an ordering trap, as Part B had? ═══════════════════════════
-- **No.** Part B's order mattered because `0047` had to widen a role CHECK
-- before an account could hold the new role, and `0048`'s unique indexes could
-- only be created after a data script had removed the duplicates. Nothing here
-- depends on data and nothing here is a narrowing:
--
--   · the two new columns arrive with a DEFAULT that makes every existing row
--     read exactly as it read before (see below), so the **old** code running
--     against the **new** schema behaves identically — it simply never selects
--     the new columns;
--   · the new table is empty and nothing reads it until the new code is live;
--   · the CHECK rewrite is strictly wider than the list it replaces.
--
-- So `0049` may be applied **before or after** the code deploy. Applying it
-- first is preferred only because the new code's reads name `effective_from`,
-- and a code deploy that lands first would throw `42703` on every timetable
-- screen until the migration caught up. **Apply `0049`, then deploy the code.**
--
-- ══ Step 1. The two dates, and why every existing row is untouched ══════
-- `effective_from date NOT NULL DEFAULT CURRENT_DATE` and `effective_to date`
-- (nullable, null = still in force). `ADD COLUMN … NOT NULL DEFAULT` has been
-- metadata-only since Postgres 11, so no row is rewritten: the existing rows
-- read their value through `pg_attribute.attmissingval`, and every one of them
-- is therefore live from the day this runs with no end date. That is the whole
-- of the compatibility claim — `liveTimetableEntries()` matches exactly the set
-- the old code matched — and `scripts/check-sprint33c.ts` proves it against the
-- real schema rather than leaving it as a sentence here.
--
-- ⚠ The DEFAULT is `CURRENT_DATE` rather than a literal, which means the
-- **date the migration is applied** and not the date a lesson was first
-- scheduled. That is honest: the product has never recorded when a lesson was
-- placed, and back-dating every row to the start of the academic year would
-- assert something no column in this database has ever known. What matters for
-- the rule is the future, and from today forward the dates are real.
--
-- ══ Step 2. The unique index had to become PARTIAL, and this is the trap ═
-- `timetable_entries_location_section_slot_day_idx` was
-- `UNIQUE (location_id, section_id, slot_id, day_of_week)` over the whole
-- table. Superseding writes a **second** row for the same cell — that is what
-- superseding *is* — so with the index as it stood the very first teacher
-- change would have been a `23505` on a form that has never failed, at every
-- school, on the first day.
--
-- It is dropped and re-created restricted to the rows that are still in force:
--
--     WHERE "effective_to" IS NULL AND "is_active"
--
-- which is exactly the set every grid draws from. So a section still has at
-- most one live lesson per period per day — the property that makes a grid a
-- grid — while history is unconstrained and can hold as many closed versions
-- of a cell as the school has made changes.
--
-- The predicate must stay identical to the one the reads filter on
-- (`lib/timetable-history.ts`). If the two ever drift, the index constrains a
-- set the queries do not draw and a duplicate lesson appears in a cell with
-- nothing refusing it.
--
-- ⚠ `ON CONFLICT` cannot infer a partial index unless the statement repeats the
-- predicate. `POST /api/school/timetable/entries` passes it as `targetWhere`;
-- without that the insert does not merely lose its fallback, it **fails
-- outright** with "there is no unique or exclusion constraint matching the ON
-- CONFLICT specification".
--
-- ══ The boundary convention, stated once ════════════════════════════════
-- A superseded row is closed on **`CURRENT_DATE - 1`** and its replacement
-- opens on **`CURRENT_DATE`**. The change takes effect today; yesterday
-- belongs to the version that was in force yesterday. Sharing the boundary
-- date between the two would make both live on that date and draw the cell
-- twice. `supersededOn()` is the one place that arithmetic is written.
--
-- ══ Step 3. `timetable_substitutions` — one date, never the grid ════════
-- A substitution is cover **for one date**. It is not a timetable change and
-- must never be confused with one: a teacher covering Tuesday's Maths is not
-- the teacher of Tuesday's Maths, and writing it into `timetable_entries`
-- would put them there for every Tuesday until somebody noticed. So it is its
-- own table, it carries a `date`, and nothing in it is read by any grid.
--
-- ══ Step 4. `timetable.substitute` — the permission key ═════════════════
-- §0 of the spec: **every approval-type or access setting is a permission key,
-- never a hard-coded role list.** Arranging cover commits another person's
-- afternoon, so it is a right of its own rather than a fold into
-- `academics.write`, which a coordinator holds in order to build a grid.
--
-- `role_permissions_permission_check` is therefore dropped and re-added with
-- the full list — the standing rule in CLAUDE.md, and the one Sprint 26 shipped
-- `chat.oversight` without. The default matrix hides the failure: a key works
-- immediately for every role holding it by default, and the constraint is only
-- reached when a school **overrides** the default on the permissions screen.

-- ── Step 1. The two dates ──────────────────────────────────────────────────
ALTER TABLE "timetable_entries"
  ADD COLUMN IF NOT EXISTS "effective_from" date DEFAULT CURRENT_DATE NOT NULL;--> statement-breakpoint

ALTER TABLE "timetable_entries"
  ADD COLUMN IF NOT EXISTS "effective_to" date;--> statement-breakpoint

-- ── Step 2. The unique index, made partial ─────────────────────────────────
--
-- Dropped and re-created under the same name. The name is kept deliberately:
-- it is what a `23505` names on screen and in every log line, and renaming it
-- would break the match in `lib/one-head-per-campus.ts`-style error handling
-- the first time somebody writes one for this table.
DROP INDEX IF EXISTS "timetable_entries_location_section_slot_day_idx";--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS "timetable_entries_location_section_slot_day_idx"
  ON "timetable_entries" ("location_id", "section_id", "slot_id", "day_of_week")
  WHERE "effective_to" IS NULL AND "is_active";--> statement-breakpoint

-- Every version of one cell, in order. Nothing draws a grid from it — decision
-- 9 says there is no history view — but "who took this period in March" is a
-- question a school will ask, and the answer should be a query rather than a
-- backup restore.
CREATE INDEX IF NOT EXISTS "timetable_entries_history_idx"
  ON "timetable_entries"
     ("location_id", "section_id", "slot_id", "day_of_week", "effective_from");--> statement-breakpoint

-- ── Step 3. Substitutions ──────────────────────────────────────────────────
--
-- `entry_id` is nullable and the (section, slot, day) triple is not: a
-- substitution can be arranged against a cell whose standing lesson is later
-- superseded or cleared, and the cover that was actually arranged must survive
-- that. The triple is what the screen reads it back by; the entry id is what it
-- was arranged from, kept for provenance and set null if that row ever goes.
--
-- `original_teacher_id` is recorded rather than re-derived. Re-deriving it from
-- the grid months later would answer with whoever takes the period *now*, which
-- is the same class of defect this whole migration exists to close.
CREATE TABLE IF NOT EXISTS "timetable_substitutions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "location_id" text NOT NULL REFERENCES "schools"("location_id") ON DELETE cascade,
  "academic_year_id" uuid NOT NULL REFERENCES "academic_years"("id"),
  "entry_id" uuid REFERENCES "timetable_entries"("id") ON DELETE set null,
  "section_id" uuid NOT NULL REFERENCES "sections"("id"),
  "slot_id" uuid NOT NULL REFERENCES "timetable_slots"("id"),
  "day_of_week" integer NOT NULL,
  "cover_date" date NOT NULL,
  "original_teacher_id" uuid REFERENCES "school_users"("id"),
  "cover_teacher_id" uuid NOT NULL REFERENCES "school_users"("id"),
  "arranged_by" uuid REFERENCES "school_users"("id") ON DELETE set null,
  "note" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "timetable_substitutions_day_of_week_check"
    CHECK ("day_of_week" BETWEEN 0 AND 4),
  CONSTRAINT "timetable_substitutions_distinct_check"
    CHECK ("original_teacher_id" IS NULL OR "original_teacher_id" <> "cover_teacher_id")
);--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "timetable_substitutions_location_id_idx"
  ON "timetable_substitutions" ("location_id");--> statement-breakpoint

-- The screen's read: one campus's cover for one date.
CREATE INDEX IF NOT EXISTS "timetable_substitutions_location_date_idx"
  ON "timetable_substitutions" ("location_id", "cover_date");--> statement-breakpoint

-- "Is this teacher already covering something at this hour" — the clash test,
-- and the reason the cover teacher is the leading column.
CREATE INDEX IF NOT EXISTS "timetable_substitutions_cover_teacher_date_idx"
  ON "timetable_substitutions" ("location_id", "cover_teacher_id", "cover_date");--> statement-breakpoint

-- One cover per cell per date. A second arrangement for the same period on the
-- same day is two teachers told to take one class, and the one who does not
-- turn up is the one who was told first.
CREATE UNIQUE INDEX IF NOT EXISTS "timetable_substitutions_cell_date_idx"
  ON "timetable_substitutions"
     ("location_id", "section_id", "slot_id", "cover_date");--> statement-breakpoint

-- ── Step 4. The permission CHECK, rewritten in full ────────────────────────
--
-- Every key in `PERMISSIONS`, in order, plus `timetable.substitute` at the end.
-- Strictly wider than `0047`'s list, so no existing row can fail re-validation.
ALTER TABLE "role_permissions"
  DROP CONSTRAINT IF EXISTS "role_permissions_permission_check";--> statement-breakpoint

ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_permission_check" CHECK (
  "permission" IN (
    'users.read', 'users.write', 'admissions.read',
    'admissions.write', 'students.read', 'students.create',
    'students.update', 'students.delete', 'students.import',
    'students.promote', 'students.transfer', 'fees.read',
    'fees.write', 'fees.admission',
    'academics.read', 'academics.write',
    'attendance.mark', 'exams.read', 'exams.write',
    'exams.publish', 'results.enter', 'results.publish',
    'results.promotion', 'hr.read', 'hr.write',
    'payroll.read', 'payroll.write', 'payroll.approve',
    'comms.read', 'comms.write', 'comms.send',
    'chat.read', 'chat.send', 'chat.grant',
    'chat.moderate', 'chat.oversight',
    'settings.read', 'settings.write', 'branches.manage',
    'principals.manage', 'permissions.manage', 'calendar.manage',
    'accounting.read', 'accounting.write', 'accounting.settle',
    'kpis.read', 'kpis.create', 'kpis.delete', 'kpis.overall',
    'kpis.rate.teacher', 'kpis.rate.coordinator', 'kpis.rate.vice_principal',
    'kpis.rate.hr_manager', 'kpis.rate.accountant', 'kpis.rate.marketing',
    -- Sprint 33b.
    'kpis.rate.section_head',
    'leave.read', 'leave.request', 'leave.approve', 'leave.manage',
    -- Sprint 33c.
    'timetable.substitute'
  )
);
