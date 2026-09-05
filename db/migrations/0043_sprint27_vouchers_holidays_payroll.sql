-- Sprint 27 — the pre-paid voucher, the school's own calendar, and the
-- payroll a principal signs.
--
-- ── What this migration is, in one paragraph ─────────────────────────────
-- Three things that ship together because two of them meet in the payroll run:
-- a holiday is what stops a teacher being docked, and the payroll approval is
-- who says so. Part A widens the fee module so a month can be re-billed after a
-- cancellation and so a school can raise next month's vouchers on a timer;
-- Part B gives the school a calendar it did not have; Part C hands the
-- teachers' and coordinators' payroll to the head who is answerable for them.
--
-- ── Order matters here, and this is the order ────────────────────────────
--   A1  the two partial unique indexes on the billing documents
--   A3  `family_challans.origin`
--   A5  the four auto-generation columns on `late_fee_rules`
--   B1  `holidays`
--   B3  `saturday_duty_policies` and `staff.saturday_ordinals`
--   B8  `holiday_notifications`
--   C2  `payroll_runs.status` widened, `payroll_run_approvals`, the payslip
--       override columns
--   —   `role_permissions_permission_check` rewritten with the full list
--
-- `notifications.kind` needs no statement here: the column is free-form by
-- design — `db/schema/notifications.ts` says so — and carries no CHECK. Adding
-- `announcement` to `NOTIFICATION_KINDS` in code is the whole of that change.
--
-- The permission CHECK is last on purpose: it is the one statement that must
-- carry *every* key in `lib/permissions.ts`, so it is written once, at the end,
-- against the finished catalogue rather than twice against two halves of it.
--
-- ── Nothing here rewrites a row ──────────────────────────────────────────
-- Every column added is nullable or carries a default; every CHECK widened is
-- strictly weaker than the one it replaces; and the one index that could fail
-- on data — `family_challans_guardian_month_idx`, which is new rather than a
-- replacement — is preceded by a census that names the offending rows instead
-- of letting Postgres report a duplicate key with nothing a human can act on.

-- ═══════════════════════════════════════════════════════════════════════════
-- Part A — vouchers
-- ═══════════════════════════════════════════════════════════════════════════

-- ── A1. One LIVE voucher per student per month ───────────────────────────
-- `fee_challans_student_month_year_idx` has been a plain UNIQUE since Sprint 5
-- and it counts **cancelled** rows. So the flow the product owner described —
-- cancel October's individual vouchers, then raise one family voucher over the
-- month — is refused by the database, with a `23505` naming a constraint no
-- clerk can act on and no screen can translate.
--
-- Re-created partial on `status <> 'cancelled'`, exactly as
-- `fee_challans_admission_once_idx` already is and for the same reason. This is
-- strictly *weaker* than what it replaces — it constrains a subset of the rows
-- the old one did — so no existing row can violate it and this statement cannot
-- fail on data.
--
-- `waived` deliberately still occupies the month. Waiving is a decision a human
-- made about a child's fees; re-billing the month would undo that decision with
-- nothing anywhere saying so.
DROP INDEX IF EXISTS "fee_challans_student_month_year_idx";--> statement-breakpoint

CREATE UNIQUE INDEX "fee_challans_student_month_year_idx"
  ON "fee_challans" ("student_profile_id", "billing_month", "billing_year", "academic_year_id")
  WHERE "status" <> 'cancelled';--> statement-breakpoint

-- The same rule on the wrapper, so a family cannot hold two live vouchers for
-- one month either.
--
-- ⚠ Unlike the index above this one is **new**, so it can fail on data. The
-- census runs first and raises with the guardian and the month spelled out —
-- a duplicate-key error names an index, and whoever reads this log needs to
-- know which family to look at.
DO $$
DECLARE
  clashes text;
BEGIN
  SELECT string_agg(format('guardian %s, %s/%s (%s vouchers)', guardian_id, billing_month, billing_year, n), '; ')
    INTO clashes
    FROM (
      SELECT guardian_id, billing_month, billing_year, count(*) AS n
        FROM family_challans
       WHERE status <> 'cancelled'
       GROUP BY guardian_id, billing_month, billing_year
      HAVING count(*) > 1
    ) AS duplicates;

  IF clashes IS NOT NULL THEN
    RAISE EXCEPTION
      'family_challans already holds more than one live voucher for a guardian and month: %. Cancel the duplicates before applying 0043.',
      clashes;
  END IF;
END $$;--> statement-breakpoint

CREATE UNIQUE INDEX "family_challans_guardian_month_idx"
  ON "family_challans" ("guardian_id", "billing_month", "billing_year", "academic_year_id")
  WHERE "status" <> 'cancelled';--> statement-breakpoint

-- ── A3. Where a family voucher came from ─────────────────────────────────
-- `combined` is one assembled over vouchers that already existed; `generated`
-- is one that *raised* its members. The distinction decides what cancelling
-- does: releasing the members of a combined voucher returns them to individual
-- billing, which is right, and doing the same to a generated voucher would
-- leave behind vouchers that exist only because the wrapper did.
--
-- Every existing row is `combined`, which is precisely what every existing row
-- is — `createFamilyChallan` has been the only door since Sprint 10.
ALTER TABLE "family_challans"
  ADD COLUMN IF NOT EXISTS "origin" text NOT NULL DEFAULT 'combined';--> statement-breakpoint

ALTER TABLE "family_challans"
  DROP CONSTRAINT IF EXISTS "family_challans_origin_check";--> statement-breakpoint

ALTER TABLE "family_challans" ADD CONSTRAINT "family_challans_origin_check"
  CHECK ("origin" IN ('combined', 'generated'));--> statement-breakpoint

-- ── A5. Raising next month's vouchers on a day the school picks ──────────
-- **Off, and it must stay off until a school asks.** The same reasoning as
-- `auto_send_vouchers` beside it and worse in one respect: an email cannot be
-- recalled, and neither can a voucher a parent has already been shown.
--
-- `auto_generate_last_run_on` is the **claim** column, not a log. Production
-- runs seven server processes, each with its own timer; a read-then-check lets
-- all seven decide to bill and a school's parents receive seven vouchers.
-- `lib/voucher-auto-generate.ts` claims a school with a conditional
-- `UPDATE … RETURNING`, which Postgres settles on one row under one lock.
ALTER TABLE "late_fee_rules"
  ADD COLUMN IF NOT EXISTS "auto_generate_vouchers" boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "auto_generate_day" integer NOT NULL DEFAULT 25,
  ADD COLUMN IF NOT EXISTS "auto_generate_last_run_on" date,
  ADD COLUMN IF NOT EXISTS "auto_generate_family_vouchers" boolean NOT NULL DEFAULT true;--> statement-breakpoint

ALTER TABLE "late_fee_rules"
  DROP CONSTRAINT IF EXISTS "late_fee_rules_auto_generate_day_check";--> statement-breakpoint

-- Capped at 28 for the same reason `due_day` and `auto_send_day` are: every
-- month has a 28th, and February does not have a 30th.
ALTER TABLE "late_fee_rules" ADD CONSTRAINT "late_fee_rules_auto_generate_day_check"
  CHECK ("auto_generate_day" BETWEEN 1 AND 28);--> statement-breakpoint

COMMENT ON COLUMN "late_fee_rules"."auto_generate_last_run_on" IS
  'The claim column. Null means never run. Set to today by the sweeper''s conditional UPDATE and handed back to null on a throw.';--> statement-breakpoint

-- ═══════════════════════════════════════════════════════════════════════════
-- Part B — the holiday calendar
-- ═══════════════════════════════════════════════════════════════════════════

-- ── B1. holidays ─────────────────────────────────────────────────────────
-- One row per holiday, **not per day**. Eid is one holiday of three days, and
-- a school moving it because the moon was sighted late moves one row. The
-- calendar expands the range on read — `expandHolidays` in
-- `lib/holiday-calendar.ts` is the only thing that turns a row into dates.
--
-- Weekends are never rows. Sunday is always off; Saturday is decided by the
-- duty roster below. A table holding 104 rows a year per school that all say
-- the same thing is a table that will eventually disagree with itself, and
-- nothing would say which half was right.
--
-- `branch_id` null means every campus, which is what a national holiday is.
-- `set null` on delete rather than cascade: removing a campus must not delete
-- the days the school was shut.
CREATE TABLE IF NOT EXISTS "holidays" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "location_id" text NOT NULL REFERENCES "schools"("location_id") ON DELETE cascade,
  "branch_id" uuid REFERENCES "branches"("id") ON DELETE set null,
  "name" text NOT NULL,
  "starts_on" date NOT NULL,
  "ends_on" date NOT NULL,
  "holiday_type" text NOT NULL,
  "is_tentative" boolean NOT NULL DEFAULT false,
  "source" text NOT NULL DEFAULT 'manual',
  "notes" text,
  "created_by" uuid REFERENCES "school_users"("id") ON DELETE set null,
  "updated_by" uuid REFERENCES "school_users"("id") ON DELETE set null,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "holidays_range_check" CHECK ("ends_on" >= "starts_on"),
  CONSTRAINT "holidays_type_check" CHECK ("holiday_type" IN ('public', 'religious', 'school')),
  CONSTRAINT "holidays_source_check" CHECK ("source" IN ('manual', 'seed'))
);--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "holidays_location_starts_on_idx"
  ON "holidays" ("location_id", "starts_on");--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "holidays_location_branch_idx"
  ON "holidays" ("location_id", "branch_id");--> statement-breakpoint

-- Two indexes for one rule, because Postgres treats every NULL as distinct.
-- A single unique index over a nullable `branch_id` would permit any number of
-- identical school-wide rows, and *Load public holidays* — which is meant to be
-- safe to press twice — would write Independence Day again every time. The
-- pattern `payroll_runs` already uses, for the same reason.
CREATE UNIQUE INDEX IF NOT EXISTS "holidays_school_wide_idx"
  ON "holidays" ("location_id", "starts_on", "name") WHERE "branch_id" IS NULL;--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS "holidays_branch_idx"
  ON "holidays" ("location_id", "branch_id", "starts_on", "name") WHERE "branch_id" IS NOT NULL;--> statement-breakpoint

COMMENT ON COLUMN "holidays"."is_tentative" IS
  'True for every lunar-dated holiday until a person confirms it. The dates come from the tabular Islamic calendar, which is an approximation; Pakistan decides them by moon sighting, typically within a day either side. Editing the date clears this.';--> statement-breakpoint

-- ── B3. The Saturday duty roster ─────────────────────────────────────────
-- The requirement, exactly: *teachers and coordinators are called every
-- Saturday while the principal comes in on 2*, and *four coordinators each
-- come on one distinct Saturday*. Both halves are load-bearing — it is per
-- **role** and per **person** — so there are two levels, and this is the first.
--
-- `ordinals` is a subset of 1–5, meaning *which* Saturday of the month, not
-- how many. A count cannot express four coordinators on four distinct
-- Saturdays, and it cannot answer the only question a calendar ever asks:
-- whether **this** Saturday is a working day for **this** person.
--
-- 5 is real. A month can hold five Saturdays, and a policy that could not name
-- one would silently make every fifth Saturday a day off for the whole school.
CREATE TABLE IF NOT EXISTS "saturday_duty_policies" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "location_id" text NOT NULL REFERENCES "schools"("location_id") ON DELETE cascade,
  "role" text NOT NULL,
  "ordinals" integer[] NOT NULL DEFAULT '{}'::integer[],
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "saturday_duty_policies_role_check" CHECK ("role" IN (
    'school_admin', 'branch_admin', 'principal', 'vice_principal',
    'coordinator', 'teacher', 'student', 'parent', 'accountant',
    'hr_manager', 'marketing'
  ))
);--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS "saturday_duty_policies_location_role_idx"
  ON "saturday_duty_policies" ("location_id", "role");--> statement-breakpoint

-- The per-person override.
--
-- ⚠ NULL and '{}' are one character apart and opposite. NULL means *no
-- override — use the role policy*, which is what almost every member of staff
-- carries. '{}' means *no Saturdays*, for the person whose role is called in
-- every week and who is not. Collapsing the two would make it impossible to
-- excuse one teacher from a rota without excusing every teacher.
ALTER TABLE "staff"
  ADD COLUMN IF NOT EXISTS "saturday_ordinals" integer[];--> statement-breakpoint

COMMENT ON COLUMN "staff"."saturday_ordinals" IS
  'Which Saturdays of the month (1-5) this person works, overriding their role policy. NULL = no override, use saturday_duty_policies. ''{}'' = an override meaning no Saturdays. The two are opposite and must never be collapsed.';--> statement-breakpoint

-- ── B8. The claim row for the day-before notice ──────────────────────────
-- Production runs seven schedulers. Every one of them wakes the evening before
-- Eid, finds the same block, and would send the same announcement to every
-- parent at the school — seven notices.
--
-- CLAUDE.md's rule is *claimed, not checked*, and for an insert the shape it
-- takes is `INSERT … ON CONFLICT DO NOTHING RETURNING id`: exactly one process
-- gets a row back and the other six do nothing. The unique key is
-- (location, block_start) because the notice is about a **merged block** —
-- 30 Oct, 31 Oct and 1 Nov are one closure and one notice — and the first day
-- of that block is the one thing every process computes identically.
CREATE TABLE IF NOT EXISTS "holiday_notifications" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "location_id" text NOT NULL REFERENCES "schools"("location_id") ON DELETE cascade,
  "block_start" date NOT NULL,
  "block_end" date NOT NULL,
  "announcement_id" uuid REFERENCES "announcements"("id") ON DELETE set null,
  "sent_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "holiday_notifications_location_idx"
  ON "holiday_notifications" ("location_id");--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS "holiday_notifications_location_block_idx"
  ON "holiday_notifications" ("location_id", "block_start");--> statement-breakpoint

-- ═══════════════════════════════════════════════════════════════════════════
-- Part C — the payroll a principal signs
-- ═══════════════════════════════════════════════════════════════════════════

-- ── C2. `pending_approval` ───────────────────────────────────────────────
-- The state a run sits in while the heads answerable for its teachers and
-- coordinators sign their own slice. It goes forward to `approved` only when
-- every slice is signed, and a rejection returns it to `draft` so the next
-- submission is a clean sheet.
--
-- `draft → approved` stays legal. A school with no principal at all needs
-- nobody's approval, and a sprint that froze their payroll behind a role they
-- have never appointed would be a feature that broke a working product.
--
-- Widening a CHECK cannot invalidate an existing row: every value that
-- satisfied the four-status list satisfies the five-status one. Postgres
-- re-validates the table when the constraint is added, so a row somehow holding
-- a value outside the list surfaces here as a 23514 rather than being silently
-- accepted. That is the desired failure.
ALTER TABLE "payroll_runs"
  DROP CONSTRAINT IF EXISTS "payroll_runs_status_check";--> statement-breakpoint

ALTER TABLE "payroll_runs" ADD CONSTRAINT "payroll_runs_status_check" CHECK (
  "status" IN ('draft', 'pending_approval', 'approved', 'paid', 'cancelled')
);--> statement-breakpoint

-- One head's signature over their slice of a run.
--
-- Not a boolean on the run: a Junior School head may have approved her forty
-- teachers while the Senior School head has not looked yet, and a single
-- `approved_by` column cannot say so. `staff_count` is that slice's size,
-- frozen at submission — recomputing it on read would make a run's history move
-- when an assignment changes, which is exactly what a signature must not do.
CREATE TABLE IF NOT EXISTS "payroll_run_approvals" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "location_id" text NOT NULL REFERENCES "schools"("location_id") ON DELETE cascade,
  "payroll_run_id" uuid NOT NULL REFERENCES "payroll_runs"("id") ON DELETE cascade,
  "principal_user_id" uuid NOT NULL REFERENCES "school_users"("id") ON DELETE cascade,
  "status" text NOT NULL DEFAULT 'pending',
  "staff_count" integer NOT NULL DEFAULT 0,
  "note" text,
  "decided_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "payroll_run_approvals_status_check"
    CHECK ("status" IN ('pending', 'approved', 'rejected'))
);--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "payroll_run_approvals_location_idx"
  ON "payroll_run_approvals" ("location_id");--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "payroll_run_approvals_principal_idx"
  ON "payroll_run_approvals" ("location_id", "principal_user_id", "status");--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS "payroll_run_approvals_run_principal_idx"
  ON "payroll_run_approvals" ("payroll_run_id", "principal_user_id");--> statement-breakpoint

-- The override, and why `loss_of_pay_amount` is kept beside it.
--
-- `loss_of_pay_override` is the **replacement** loss-of-pay amount, not a
-- delta: `0.00` waives the deduction, which is the common case, and a delta of
-- "minus everything" is a number somebody has to compute and can compute wrong.
--
-- The original is never overwritten. A teacher asking why they were paid more
-- than the register implies is owed both numbers — what the attendance said,
-- and what the head decided — and overwriting the first erases the question
-- along with the answer.
ALTER TABLE "payslips"
  ADD COLUMN IF NOT EXISTS "loss_of_pay_override" numeric(12, 2),
  ADD COLUMN IF NOT EXISTS "override_reason" text,
  ADD COLUMN IF NOT EXISTS "overridden_by" uuid REFERENCES "school_users"("id") ON DELETE set null,
  ADD COLUMN IF NOT EXISTS "overridden_at" timestamp with time zone;--> statement-breakpoint

COMMENT ON COLUMN "payslips"."loss_of_pay_override" IS
  'The replacement loss-of-pay amount, not a delta. NULL = no override. net_payable is recomputed from it and payslips_net_payable_check still holds.';--> statement-breakpoint

-- ═══════════════════════════════════════════════════════════════════════════
-- The permission catalogue
-- ═══════════════════════════════════════════════════════════════════════════

-- ── Last on purpose ──────────────────────────────────────────────────────
-- This is the one statement that must carry **every** key in
-- `lib/permissions.ts`, so it is written once at the end against the finished
-- catalogue rather than twice against two halves of it.
--
-- Two keys are new: `calendar.manage` (Part B) and `payroll.approve` (Part C).
--
-- ── Why this is not optional, and how it goes wrong when it is ───────────
-- `DEFAULT_ROLE_PERMISSIONS` lives in code, so both keys **work immediately**
-- for every role that holds them by default, with no row in this table at all.
-- Every browser test passes. The constraint is reached only when a school
-- *overrides* the default — granting `calendar.manage` to a Vice Principal, or
-- taking `payroll.approve` from a Principal — which is a screen most testing
-- never touches. So the failure waits until a real administrator saves the
-- permission matrix and gets a 23514 on a form that had never failed before.
--
-- `0040`'s Step 10 predicted this in those words; Sprint 26 shipped
-- `chat.oversight` without it anyway and `0042` is the repair. CLAUDE.md now
-- carries the rule, and `check-branch-scope` fails naming the missing key.
--
-- ── Prove it by attempt, not by reading it ───────────────────────────────
-- A CHECK that was dropped and never re-added leaves every row count identical.
-- `check-sprint27` tries a key outside the list and requires 23514, then tries
-- each new key and requires acceptance, both inside transactions that are
-- rolled back, with the row count read back afterwards.
ALTER TABLE "role_permissions"
  DROP CONSTRAINT IF EXISTS "role_permissions_permission_check";--> statement-breakpoint

ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_permission_check" CHECK (
  "permission" IN (
    'users.read', 'users.write', 'admissions.read',
    'admissions.write', 'students.read', 'students.create',
    'students.update', 'students.delete', 'students.import',
    'students.promote', 'students.transfer', 'fees.read',
    'fees.write', 'academics.read', 'academics.write',
    'attendance.mark', 'exams.read', 'exams.write',
    'exams.publish', 'results.enter', 'results.publish',
    'results.promotion', 'hr.read', 'hr.write',
    'payroll.read', 'payroll.write', 'payroll.approve',
    'comms.read', 'comms.write', 'comms.send',
    'chat.read', 'chat.send', 'chat.grant',
    'chat.moderate', 'chat.oversight',
    'settings.read', 'settings.write', 'branches.manage',
    'principals.manage', 'permissions.manage', 'calendar.manage',
    'accounting.read', 'accounting.write', 'accounting.settle'
  )
);
