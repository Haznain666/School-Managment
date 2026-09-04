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
--   —   `notifications.kind` widened for the announcement bell
--   —   `role_permissions_permission_check` rewritten with the full list
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
