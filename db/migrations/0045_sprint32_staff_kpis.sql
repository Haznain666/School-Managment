-- Sprint 32 — staff KPIs and performance. STATE.md §5ca is the requirement.
--
-- ── Two CHECK rewrites, and either one missing ships a 23514 ─────────────
-- `staff_kpis` joins `PLATFORM_MODULES`, so `school_modules_module_key_check`
-- is dropped and re-added with it: without that the Super Admin toggle for the
-- module fails at its first save. Ten `kpis.*` keys join `PERMISSIONS`, so
-- `role_permissions_permission_check` is rewritten with all 55: without that
-- the permission matrix fails the first time a school overrides a KPI default,
-- which is a screen no test that uses the defaults ever reaches (CLAUDE.md).
--
-- Both lists are strictly wider than the ones they replace, so no existing row
-- can fail re-validation.
--
-- ── Seven new tables, all empty ──────────────────────────────────────────
-- No existing row is rewritten. Every table is tenant-keyed on `location_id`.
-- `staff_kpi_ratings` is append-only and a trigger refuses UPDATE; DELETE is
-- left to the cascades, because a trigger refusing it would also refuse
-- deleting a school.

ALTER TABLE "school_modules"
  DROP CONSTRAINT IF EXISTS "school_modules_module_key_check";--> statement-breakpoint

ALTER TABLE "school_modules" ADD CONSTRAINT "school_modules_module_key_check" CHECK (
  module_key IN (
    'admissions', 'fee_management', 'academics', 'chat', 'lms', 'hr_payroll',
    'accounts', 'event_mgmt', 'staff_kpis', 'transport', 'library', 'hostel'
  )
);--> statement-breakpoint

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
    'kpis.rate.hr_manager', 'kpis.rate.accountant', 'kpis.rate.marketing'
  )
);--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "staff_kpis" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "location_id" text NOT NULL REFERENCES "schools"("location_id") ON DELETE cascade,
  "branch_id" uuid REFERENCES "branches"("id") ON DELETE cascade,
  "target_role" text NOT NULL,
  "name" text NOT NULL,
  "description" text,
  "period" text NOT NULL,
  "created_by" uuid REFERENCES "school_users"("id") ON DELETE set null,
  "updated_by" uuid REFERENCES "school_users"("id") ON DELETE set null,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "deleted_at" timestamp with time zone,
  "deleted_by" uuid REFERENCES "school_users"("id") ON DELETE set null,
  CONSTRAINT "staff_kpis_target_role_check" CHECK (target_role IN (
    'principal', 'vice_principal', 'branch_admin', 'coordinator', 'teacher',
    'hr_manager', 'accountant', 'marketing'
  )),
  CONSTRAINT "staff_kpis_period_check" CHECK ("period" IN ('monthly', 'annual')),
  CONSTRAINT "staff_kpis_name_check" CHECK (length("name") BETWEEN 1 AND 80)
);--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "staff_kpis_location_role_idx"
  ON "staff_kpis" ("location_id", "target_role");--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "staff_kpi_ratings" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "location_id" text NOT NULL REFERENCES "schools"("location_id") ON DELETE cascade,
  "kpi_id" uuid NOT NULL REFERENCES "staff_kpis"("id") ON DELETE cascade,
  "rated_user_id" uuid NOT NULL REFERENCES "school_users"("id") ON DELETE cascade,
  "academic_year_id" uuid NOT NULL REFERENCES "academic_years"("id") ON DELETE cascade,
  "period_month" date,
  "score" integer NOT NULL,
  "comment" text,
  "rater_user_id" uuid REFERENCES "school_users"("id") ON DELETE set null,
  "rater_role" text NOT NULL,
  "rater_name" text NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "staff_kpi_ratings_score_check" CHECK ("score" BETWEEN 1 AND 10),
  CONSTRAINT "staff_kpi_ratings_month_check"
    CHECK ("period_month" IS NULL OR extract(day from "period_month") = 1)
);--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "staff_kpi_ratings_person_year_idx"
  ON "staff_kpi_ratings" ("location_id", "rated_user_id", "academic_year_id");--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "staff_kpi_ratings_location_year_idx"
  ON "staff_kpi_ratings" ("location_id", "academic_year_id");--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "staff_kpi_ratings_kpi_idx"
  ON "staff_kpi_ratings" ("kpi_id");--> statement-breakpoint

-- A rating is an audit record. A change is a new row; nothing edits an old one.
CREATE OR REPLACE FUNCTION "staff_kpi_ratings_refuse_update"() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'staff_kpi_ratings is append-only: enter a new rating instead of changing one'
    USING ERRCODE = 'P0001';
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint

DROP TRIGGER IF EXISTS "staff_kpi_ratings_append_only" ON "staff_kpi_ratings";--> statement-breakpoint

CREATE TRIGGER "staff_kpi_ratings_append_only"
  BEFORE UPDATE ON "staff_kpi_ratings"
  FOR EACH ROW EXECUTE FUNCTION "staff_kpi_ratings_refuse_update"();--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "staff_kpi_settings" (
  "location_id" text PRIMARY KEY NOT NULL REFERENCES "schools"("location_id") ON DELETE cascade,
  "rate_principals" boolean DEFAULT false NOT NULL,
  "principal_raters" text[] DEFAULT ARRAY['school_admin']::text[] NOT NULL,
  "rate_branch_admins" boolean DEFAULT false NOT NULL,
  "branch_admin_raters" text[] DEFAULT ARRAY['school_admin']::text[] NOT NULL,
  "updated_by" uuid REFERENCES "school_users"("id") ON DELETE set null,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "staff_kpi_settings_principal_raters_check"
    CHECK ("principal_raters" <@ ARRAY['school_admin', 'self', 'branch_admin']::text[]),
  CONSTRAINT "staff_kpi_settings_branch_admin_raters_check"
    CHECK ("branch_admin_raters" <@ ARRAY['school_admin', 'self', 'principal']::text[])
);--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "coordinator_teachers" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "location_id" text NOT NULL REFERENCES "schools"("location_id") ON DELETE cascade,
  "coordinator_user_id" uuid NOT NULL REFERENCES "school_users"("id") ON DELETE cascade,
  "teacher_user_id" uuid NOT NULL REFERENCES "school_users"("id") ON DELETE cascade,
  "branch_id" uuid NOT NULL REFERENCES "branches"("id") ON DELETE cascade,
  "assigned_by" uuid REFERENCES "school_users"("id") ON DELETE set null,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "coordinator_teachers_distinct_check"
    CHECK ("coordinator_user_id" <> "teacher_user_id")
);--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS "coordinator_teachers_pair_idx"
  ON "coordinator_teachers" ("coordinator_user_id", "teacher_user_id");--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "coordinator_teachers_location_teacher_idx"
  ON "coordinator_teachers" ("location_id", "teacher_user_id");--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "vice_principal_principals" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "location_id" text NOT NULL REFERENCES "schools"("location_id") ON DELETE cascade,
  "vice_principal_user_id" uuid NOT NULL REFERENCES "school_users"("id") ON DELETE cascade,
  "principal_user_id" uuid NOT NULL REFERENCES "school_users"("id") ON DELETE cascade,
  "set_by" uuid REFERENCES "school_users"("id") ON DELETE set null,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS "vice_principal_principals_deputy_idx"
  ON "vice_principal_principals" ("vice_principal_user_id");--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "vice_principal_principals_location_idx"
  ON "vice_principal_principals" ("location_id");--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "teacher_principals" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "location_id" text NOT NULL REFERENCES "schools"("location_id") ON DELETE cascade,
  "teacher_user_id" uuid NOT NULL REFERENCES "school_users"("id") ON DELETE cascade,
  "principal_user_id" uuid NOT NULL REFERENCES "school_users"("id") ON DELETE cascade,
  "source" text NOT NULL,
  "periods" integer,
  "requested_by" uuid REFERENCES "school_users"("id") ON DELETE set null,
  "started_at" timestamp with time zone DEFAULT now() NOT NULL,
  "ended_at" timestamp with time zone,
  CONSTRAINT "teacher_principals_source_check"
    CHECK ("source" IN ('derived', 'transferred', 'assigned'))
);--> statement-breakpoint

-- One teacher, one principal: the whole of rule 7b as the database sees it.
CREATE UNIQUE INDEX IF NOT EXISTS "teacher_principals_current_idx"
  ON "teacher_principals" ("location_id", "teacher_user_id")
  WHERE "ended_at" IS NULL;--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "teacher_principals_location_principal_idx"
  ON "teacher_principals" ("location_id", "principal_user_id");--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "teacher_principal_transfers" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "location_id" text NOT NULL REFERENCES "schools"("location_id") ON DELETE cascade,
  "teacher_user_id" uuid NOT NULL REFERENCES "school_users"("id") ON DELETE cascade,
  "from_principal_user_id" uuid REFERENCES "school_users"("id") ON DELETE set null,
  "to_principal_user_id" uuid NOT NULL REFERENCES "school_users"("id") ON DELETE cascade,
  "requested_by" uuid REFERENCES "school_users"("id") ON DELETE set null,
  "status" text DEFAULT 'requested' NOT NULL,
  "note" text,
  "decided_by" uuid REFERENCES "school_users"("id") ON DELETE set null,
  "decided_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "teacher_principal_transfers_status_check"
    CHECK ("status" IN ('requested', 'accepted', 'declined', 'cancelled'))
);--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS "teacher_principal_transfers_open_idx"
  ON "teacher_principal_transfers" ("location_id", "teacher_user_id")
  WHERE "status" = 'requested';
