-- Sprint 33b — the Section Head, the chain of command, and HR leave
-- management. `SPRINT-33-SPEC.md` Part B is the requirement; STATE.md §5cf is
-- the round's handover entry and §5cg is Part A, which is live.
--
-- ══ Six CHECK constraints, and each one missed is a 23514 ═══════════════
-- `section_head` joins `USER_ROLES`, and that list is the source of **six**
-- database constraints rather than the three the spec named. Every one of them
-- is reached only by a school that has *configured* something, which is the
-- case no test driven by the defaults ever touches:
--
--   1. `school_users_role_check`            — last defined in `0010`. Without
--      it nobody can hold the role at all: the invite's own write fails.
--   2. `school_invitations_role_check`      — also `0010`. `section_head` is in
--      `INVITABLE_ROLES`, so the invitation row is written before the member
--      exists, and it is written against this constraint.
--   3. `role_permissions_role_check`        — `0010`, inline in the CREATE
--      TABLE. A school that **overrides** any of the new role's defaults
--      writes a row keyed by the role. Granting or revoking one toggle on the
--      permissions matrix is all it takes.
--   4. `saturday_duty_policies_role_check`  — `0043`, inline. `PUT
--      /api/school/hr/saturday-duty` saves **one row per role in
--      `USER_ROLES`**, so the very first save of that screen after this
--      deploys would fail — on a screen that has never failed — if this were
--      left alone.
--   5. `staff_kpis_target_role_check`       — `0045`. A KPI written for a
--      Section Head.
--   6. `role_permissions_permission_check`  — `0045`, rewritten here with all
--      55 existing keys plus `kpis.rate.section_head` and the four `leave.*`
--      keys. CLAUDE.md's rule, and Sprint 26 shipped `chat.oversight` without
--      it despite `0040`'s Step 10 comment predicting exactly that.
--
-- Every list below is strictly **wider** than the one it replaces, so no
-- existing row can fail re-validation and the rewrite is a metadata change
-- plus one scan per constrained table.
--
-- ══ Four new tables, all empty, and seven nullable columns ══════════════
-- No existing row is rewritten. `ADD COLUMN … NOT NULL DEFAULT` has been
-- metadata-only since Postgres 11, so the two defaulted booleans/integers on
-- `staff` do not rewrite the table either. Every table is tenant-keyed on
-- `location_id` and indexed on it.
--
-- ══ The one-head-per-campus indexes are NOT here — they are `0048` ═══════
-- They were, and they moved out on 2026-09-16 when the product owner retired
-- divisions inside a campus. Askari runs four active Principals on Main Campus,
-- one per division, and three of them become Section Heads. That cannot happen
-- until THIS migration widens `school_users_role_check`, the index cannot be
-- created until it has happened, and none of them may sign in as
-- `section_head` before code that recognises the role is live. So the deploy
-- order is:
--
--   0047  →  code deploy  →  scripts/apply-sprint33b-data.mjs --apply  →  0048
--
-- and this file must never depend on the data being tidy.

-- ── Step 1. `school_users.role` ────────────────────────────────────────────
ALTER TABLE "school_users"
  DROP CONSTRAINT IF EXISTS "school_users_role_check";--> statement-breakpoint

ALTER TABLE "school_users" ADD CONSTRAINT "school_users_role_check" CHECK (
  role IN (
    'school_admin', 'branch_admin', 'principal', 'vice_principal',
    'section_head', 'coordinator', 'teacher', 'student', 'parent',
    'accountant', 'hr_manager', 'marketing'
  )
);--> statement-breakpoint

-- ── Step 2. `school_invitations.role` ──────────────────────────────────────
ALTER TABLE "school_invitations"
  DROP CONSTRAINT IF EXISTS "school_invitations_role_check";--> statement-breakpoint

ALTER TABLE "school_invitations" ADD CONSTRAINT "school_invitations_role_check" CHECK (
  role IN (
    'school_admin', 'branch_admin', 'principal', 'vice_principal',
    'section_head', 'coordinator', 'teacher', 'student', 'parent',
    'accountant', 'hr_manager', 'marketing'
  )
);--> statement-breakpoint

-- ── Step 3. `role_permissions.role` ────────────────────────────────────────
ALTER TABLE "role_permissions"
  DROP CONSTRAINT IF EXISTS "role_permissions_role_check";--> statement-breakpoint

ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_role_check" CHECK (
  role IN (
    'school_admin', 'branch_admin', 'principal', 'vice_principal',
    'section_head', 'coordinator', 'teacher', 'student', 'parent',
    'accountant', 'hr_manager', 'marketing'
  )
);--> statement-breakpoint

-- ── Step 4. `saturday_duty_policies.role` ──────────────────────────────────
ALTER TABLE "saturday_duty_policies"
  DROP CONSTRAINT IF EXISTS "saturday_duty_policies_role_check";--> statement-breakpoint

ALTER TABLE "saturday_duty_policies" ADD CONSTRAINT "saturday_duty_policies_role_check" CHECK (
  "role" IN (
    'school_admin', 'branch_admin', 'principal', 'vice_principal',
    'section_head', 'coordinator', 'teacher', 'student', 'parent',
    'accountant', 'hr_manager', 'marketing'
  )
);--> statement-breakpoint

-- ── Step 5. `staff_kpis.target_role` ───────────────────────────────────────
ALTER TABLE "staff_kpis"
  DROP CONSTRAINT IF EXISTS "staff_kpis_target_role_check";--> statement-breakpoint

ALTER TABLE "staff_kpis" ADD CONSTRAINT "staff_kpis_target_role_check" CHECK (
  target_role IN (
    'principal', 'vice_principal', 'branch_admin', 'section_head',
    'coordinator', 'teacher', 'hr_manager', 'accountant', 'marketing'
  )
);--> statement-breakpoint

-- ── Step 6. The permission catalogue — all 60 ──────────────────────────────
--
-- Last on purpose among the CHECKs, as `0043` and `0045` both put it: it is the
-- statement most likely to be edited by the next sprint, and having it in one
-- place at the end of the list is what makes that edit obvious.
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
    'leave.read', 'leave.request', 'leave.approve', 'leave.manage'
  )
);--> statement-breakpoint

-- ── Step 7. Probation and the date leave starts accruing ───────────────────
--
-- `permanent_from` is nullable and null means **the whole year's quota**, not
-- "no leave". Treating it the other way round would take every existing
-- teacher's entitlement away on the day this deploys, silently, on a screen
-- that had always shown a number. `lib/leave-quota.ts` is where that is
-- decided, once.
ALTER TABLE "staff"
  ADD COLUMN IF NOT EXISTS "permanent_from" date;--> statement-breakpoint

ALTER TABLE "staff"
  ADD COLUMN IF NOT EXISTS "is_on_probation" boolean DEFAULT false NOT NULL;--> statement-breakpoint

ALTER TABLE "staff"
  ADD COLUMN IF NOT EXISTS "probation_days" integer;--> statement-breakpoint

ALTER TABLE "staff"
  ADD COLUMN IF NOT EXISTS "probation_started_on" date;--> statement-breakpoint

ALTER TABLE "staff"
  ADD COLUMN IF NOT EXISTS "probation_ends_on" date;--> statement-breakpoint

ALTER TABLE "staff"
  ADD COLUMN IF NOT EXISTS "probation_extended_days" integer DEFAULT 0 NOT NULL;--> statement-breakpoint

-- The claim the sweep takes before it emails HR. Not a log line: seven
-- scheduler processes run in production and a read-then-`if` sends seven.
ALTER TABLE "staff"
  ADD COLUMN IF NOT EXISTS "probation_notified_at" timestamp with time zone;--> statement-breakpoint

-- 180 calendar days including holidays, decision 4. In the database as well as
-- in the API, because a ceiling enforced only by a route is one the next route
-- forgets. Every existing row has NULL probation_days and passes.
ALTER TABLE "staff"
  DROP CONSTRAINT IF EXISTS "staff_probation_days_check";--> statement-breakpoint

ALTER TABLE "staff" ADD CONSTRAINT "staff_probation_days_check" CHECK (
  "probation_days" IS NULL
  OR ("probation_days" BETWEEN 1 AND 180
      AND "probation_days" + "probation_extended_days" <= 180)
);--> statement-breakpoint

ALTER TABLE "staff"
  DROP CONSTRAINT IF EXISTS "staff_probation_extended_check";--> statement-breakpoint

ALTER TABLE "staff" ADD CONSTRAINT "staff_probation_extended_check" CHECK (
  "probation_extended_days" >= 0
);--> statement-breakpoint

COMMENT ON COLUMN "staff"."permanent_from" IS
  'The date leave starts accruing. Entitlement is pro-rated from here against the school academic year and lapses at the end of it. NULL = the whole year''s quota, which is what every row predating Sprint 33b holds.';--> statement-breakpoint

-- ── Step 8. The chain of command ───────────────────────────────────────────
--
-- Section head → coordinator. Coordinator → teacher is `coordinator_teachers`
-- from `0045`, **reused unchanged**: a second table saying the same thing
-- would be two answers to one question, and the first time they disagreed a
-- teacher would be rated by one person and approved by another.
CREATE TABLE IF NOT EXISTS "section_head_coordinators" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "location_id" text NOT NULL REFERENCES "schools"("location_id") ON DELETE cascade,
  "section_head_user_id" uuid NOT NULL REFERENCES "school_users"("id") ON DELETE cascade,
  "coordinator_user_id" uuid NOT NULL REFERENCES "school_users"("id") ON DELETE cascade,
  "branch_id" uuid NOT NULL REFERENCES "branches"("id") ON DELETE cascade,
  "assigned_by" uuid REFERENCES "school_users"("id") ON DELETE set null,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "section_head_coordinators_distinct_check"
    CHECK ("section_head_user_id" <> "coordinator_user_id")
);--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS "section_head_coordinators_pair_idx"
  ON "section_head_coordinators" ("section_head_user_id", "coordinator_user_id");--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "section_head_coordinators_location_coordinator_idx"
  ON "section_head_coordinators" ("location_id", "coordinator_user_id");--> statement-breakpoint

-- ── Step 9. The two staff calendars ────────────────────────────────────────
--
-- A calendar is a **filter over `holidays`**, never a second copy of it. Every
-- override names a row there, including the ones that add days, which is what
-- lets *Notify* be the existing `POST /api/school/holidays/[id]/notify` rather
-- than a second delivery path with its own opinion about who has opted out.
CREATE TABLE IF NOT EXISTS "staff_calendars" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "location_id" text NOT NULL REFERENCES "schools"("location_id") ON DELETE cascade,
  "branch_id" uuid REFERENCES "branches"("id") ON DELETE cascade,
  "category" text NOT NULL,
  "name" text NOT NULL,
  "created_by" uuid REFERENCES "school_users"("id") ON DELETE set null,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "staff_calendars_category_check"
    CHECK ("category" IN ('teaching', 'non_teaching'))
);--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "staff_calendars_location_id_idx"
  ON "staff_calendars" ("location_id");--> statement-breakpoint

-- Two indexes for one rule, because Postgres counts every NULL as distinct and
-- a null branch means *the whole school*. The pattern `holidays` uses.
CREATE UNIQUE INDEX IF NOT EXISTS "staff_calendars_school_wide_idx"
  ON "staff_calendars" ("location_id", "category")
  WHERE "branch_id" IS NULL;--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS "staff_calendars_branch_idx"
  ON "staff_calendars" ("location_id", "branch_id", "category")
  WHERE "branch_id" IS NOT NULL;--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "staff_calendar_overrides" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "location_id" text NOT NULL REFERENCES "schools"("location_id") ON DELETE cascade,
  "calendar_id" uuid NOT NULL REFERENCES "staff_calendars"("id") ON DELETE cascade,
  "holiday_id" uuid NOT NULL REFERENCES "holidays"("id") ON DELETE cascade,
  "applies_to_roles" text[] DEFAULT '{}'::text[] NOT NULL,
  "is_cancelled" boolean DEFAULT false NOT NULL,
  "moved_starts_on" date,
  "moved_ends_on" date,
  "notify" boolean DEFAULT false NOT NULL,
  "notified_at" timestamp with time zone,
  "created_by" uuid REFERENCES "school_users"("id") ON DELETE set null,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "staff_calendar_overrides_moved_check" CHECK (
    ("moved_starts_on" IS NULL) = ("moved_ends_on" IS NULL)
    AND ("moved_ends_on" IS NULL OR "moved_ends_on" >= "moved_starts_on")
  ),
  -- Cancelled and moved are opposite answers to the same question.
  CONSTRAINT "staff_calendar_overrides_effect_check" CHECK (
    NOT ("is_cancelled" AND "moved_starts_on" IS NOT NULL)
  )
);--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "staff_calendar_overrides_location_calendar_idx"
  ON "staff_calendar_overrides" ("location_id", "calendar_id");--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS "staff_calendar_overrides_calendar_holiday_idx"
  ON "staff_calendar_overrides" ("calendar_id", "holiday_id");--> statement-breakpoint

-- ── Step 10. The holiday-span setting, per campus ──────────────────────────
--
-- Decision 8. `include` is the default because it is what the product did
-- before this table existed: a school with no row behaves exactly as it did
-- yesterday, which is the test every new setting in this schema has to pass.
CREATE TABLE IF NOT EXISTS "branch_leave_settings" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "location_id" text NOT NULL REFERENCES "schools"("location_id") ON DELETE cascade,
  "branch_id" uuid REFERENCES "branches"("id") ON DELETE cascade,
  "holiday_span" text DEFAULT 'include' NOT NULL,
  "updated_by" uuid REFERENCES "school_users"("id") ON DELETE set null,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "branch_leave_settings_holiday_span_check"
    CHECK ("holiday_span" IN ('include', 'skip'))
);--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "branch_leave_settings_location_id_idx"
  ON "branch_leave_settings" ("location_id");--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS "branch_leave_settings_school_wide_idx"
  ON "branch_leave_settings" ("location_id")
  WHERE "branch_id" IS NULL;--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS "branch_leave_settings_branch_idx"
  ON "branch_leave_settings" ("location_id", "branch_id")
  WHERE "branch_id" IS NOT NULL;
