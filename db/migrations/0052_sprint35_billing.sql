-- Sprint 35 — super admin invoicing, the central sign-in, more than one operator.
-- SPRINT-35-SPEC.md §10. STATE.md §5co.
--
-- ══ What this adds ══════════════════════════════════════════════════════
--   super_admin_users            the operators, with an undeletable owner
--   school_billing_settings      sandbox/live, currencies, trial, grace, recipient
--   school_role_rates            per user per month, by role (never parent)
--   school_module_rates          per month, by module (never a Phase 1 module)
--   platform_invoices            one per school per billed month, in arrears
--   platform_invoice_lines       the snapshot a later rate change cannot rewrite
--   platform_invoice_discounts   at most three, by a unique slot 1–3
--   platform_invoice_receipts    money in, with the bank's transaction id
--   platform_invoice_emails      who each invoice went to, when, by whom
--   platform_bank_accounts       at most three, Pakistani IBANs only
--   billing_reminders            the claim a trial reminder is sent under
--   school_access_events         every block and unblock, append-only
--   login_handoff_tokens         the apex sign-in's single-use hand-off
--   schools.access_blocked_at    read on every school request
--
-- ══ What it changes in existing data ════════════════════════════════════
--   · every school gets a `school_billing_settings` row, environment
--     **sandbox** (E8). Nothing is invoiced, reminded or blocked until a super
--     admin switches a school to Live by hand.
--   · every school gets Admissions, Fee Management and Academics switched
--     **on** (E9). They are "Included" from now on and cannot be switched off.
--   · `auth_attempts_scope_check` gains `central_login`.
--
-- ══ What it deliberately does NOT do ════════════════════════════════════
-- Seed the owner's row. The owner's password hash lives in the host's
-- environment, and a migration file is committed to a public repository — so
-- `scripts/apply-0052.mjs` reads the hash from the environment and inserts the
-- row. Until that runs the table is empty, and an empty table is exactly the
-- case `lib/super-admin-credentials.ts` falls back to the environment
-- credential for: the owner can always sign in.
--
-- ══ Safe to apply before the code ═══════════════════════════════════════
-- Every addition is a new table or a nullable column. The old code reads none
-- of them, and `access_blocked_at` is null everywhere, so nobody is blocked.
-- The one change the old code can see is three module rows switched on, which
-- is the state every live school is already in.

CREATE TABLE IF NOT EXISTS "super_admin_users" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "email" text NOT NULL,
  "name" text NOT NULL,
  "password_hash" text NOT NULL,
  "is_owner" boolean DEFAULT false NOT NULL,
  "permissions" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "is_active" boolean DEFAULT true NOT NULL,
  "created_by" text,
  "last_sign_in_at" timestamp with time zone,
  "password_changed_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "super_admin_users_email_lower_check" CHECK ("email" = lower(btrim("email"))),
  CONSTRAINT "super_admin_users_email_shape_check" CHECK ("email" LIKE '%_@_%'),
  CONSTRAINT "super_admin_users_name_check" CHECK (btrim("name") <> '')
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "super_admin_users_email_idx" ON "super_admin_users" ("email");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "super_admin_users_one_owner_idx" ON "super_admin_users" ("is_owner") WHERE "is_owner";
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "super_admin_users_is_active_idx" ON "super_admin_users" ("is_active");
--> statement-breakpoint

-- ══ The owner cannot be removed, by anybody, by any route ═══════════════
-- The API refuses first, with a sentence. This is what makes it true for a
-- hand-typed statement in the SQL editor as well: the row with `is_owner`
-- cannot be deleted, deactivated, demoted or re-addressed, and no other row can
-- be promoted to it. The password and the name remain editable — the owner
-- changes their own password from "My account".
--
-- `P0001` is the SQLSTATE `RAISE EXCEPTION` carries by default, and it is what
-- `apply-0052.mjs` requires when it attempts the delete.
CREATE OR REPLACE FUNCTION "super_admin_users_protect_owner"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.is_owner THEN
      RAISE EXCEPTION 'The platform owner cannot be deleted.';
    END IF;
    RETURN OLD;
  END IF;

  IF OLD.is_owner THEN
    IF NOT NEW.is_owner THEN
      RAISE EXCEPTION 'The platform owner cannot be demoted.';
    END IF;
    IF NOT NEW.is_active THEN
      RAISE EXCEPTION 'The platform owner cannot be deactivated.';
    END IF;
    IF NEW.email <> OLD.email THEN
      RAISE EXCEPTION 'The platform owner''s email cannot be changed.';
    END IF;
  ELSIF NEW.is_owner THEN
    RAISE EXCEPTION 'Nobody can be promoted to platform owner.';
  END IF;

  RETURN NEW;
END;
$$;
--> statement-breakpoint
DROP TRIGGER IF EXISTS "super_admin_users_protect_owner" ON "super_admin_users";
--> statement-breakpoint
CREATE TRIGGER "super_admin_users_protect_owner"
  BEFORE UPDATE OR DELETE ON "super_admin_users"
  FOR EACH ROW EXECUTE FUNCTION "super_admin_users_protect_owner"();
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "school_billing_settings" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "location_id" text NOT NULL REFERENCES "schools"("location_id") ON DELETE cascade,
  "environment" text DEFAULT 'sandbox' NOT NULL,
  "live_since" date,
  "billing_currency" text DEFAULT 'USD' NOT NULL,
  "invoice_currency" text DEFAULT 'USD' NOT NULL,
  "usd_to_pkr_rate" numeric(12, 4),
  "trial_days" integer DEFAULT 0 NOT NULL,
  "grace_days" integer DEFAULT 2 NOT NULL,
  "invoice_email" text,
  "updated_by" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "school_billing_settings_environment_check" CHECK ("environment" IN ('sandbox', 'live')),
  CONSTRAINT "school_billing_settings_billing_currency_check" CHECK ("billing_currency" IN ('USD', 'PKR')),
  CONSTRAINT "school_billing_settings_invoice_currency_check" CHECK ("invoice_currency" IN ('USD', 'PKR')),
  CONSTRAINT "school_billing_settings_rate_check" CHECK ("billing_currency" = "invoice_currency" OR "usd_to_pkr_rate" > 0),
  CONSTRAINT "school_billing_settings_trial_check" CHECK ("trial_days" BETWEEN 0 AND 365),
  CONSTRAINT "school_billing_settings_grace_check" CHECK ("grace_days" BETWEEN 0 AND 60),
  CONSTRAINT "school_billing_settings_live_check" CHECK ("environment" = 'live' OR "live_since" IS NULL)
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "school_billing_settings_location_id_idx" ON "school_billing_settings" ("location_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "school_billing_settings_environment_idx" ON "school_billing_settings" ("environment");
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "school_role_rates" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "location_id" text NOT NULL REFERENCES "schools"("location_id") ON DELETE cascade,
  "role" text NOT NULL,
  "monthly_rate" numeric(12, 2) NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "school_role_rates_role_check" CHECK (role IN ('school_admin', 'branch_admin', 'principal', 'vice_principal', 'section_head', 'coordinator', 'teacher', 'student', 'accountant', 'hr_manager', 'marketing')),
  CONSTRAINT "school_role_rates_rate_check" CHECK ("monthly_rate" >= 0)
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "school_role_rates_location_id_idx" ON "school_role_rates" ("location_id");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "school_role_rates_location_role_idx" ON "school_role_rates" ("location_id", "role");
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "school_module_rates" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "location_id" text NOT NULL REFERENCES "schools"("location_id") ON DELETE cascade,
  "module_key" text NOT NULL,
  "monthly_rate" numeric(12, 2) NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "school_module_rates_module_check" CHECK (module_key IN ('admissions', 'fee_management', 'academics', 'chat', 'lms', 'hr_payroll', 'accounts', 'event_mgmt', 'staff_kpis', 'transport', 'library', 'hostel')),
  CONSTRAINT "school_module_rates_rate_check" CHECK ("monthly_rate" >= 0)
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "school_module_rates_location_id_idx" ON "school_module_rates" ("location_id");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "school_module_rates_location_module_idx" ON "school_module_rates" ("location_id", "module_key");
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "platform_invoices" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "location_id" text NOT NULL REFERENCES "schools"("location_id") ON DELETE cascade,
  "invoice_number" text NOT NULL,
  "period_start" date NOT NULL,
  "period_end" date NOT NULL,
  "billed_from" date NOT NULL,
  "billable_days" integer NOT NULL,
  "days_in_period" integer NOT NULL,
  "billing_currency" text NOT NULL,
  "invoice_currency" text NOT NULL,
  "conversion_rate" numeric(12, 4),
  "subtotal" numeric(14, 2) NOT NULL,
  "discount_total" numeric(14, 2) DEFAULT '0' NOT NULL,
  "total" numeric(14, 2) NOT NULL,
  "received_total" numeric(14, 2) DEFAULT '0' NOT NULL,
  "status" text DEFAULT 'draft' NOT NULL,
  "due_date" date NOT NULL,
  "finalized_at" timestamp with time zone,
  "finalized_by" text,
  "cleared_at" timestamp with time zone,
  "carried_forward_to" uuid REFERENCES "platform_invoices"("id") ON DELETE set null,
  "generated_by" text NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "platform_invoices_status_check" CHECK ("status" IN ('draft', 'finalized', 'paid', 'carried_forward')),
  CONSTRAINT "platform_invoices_billing_currency_check" CHECK ("billing_currency" IN ('USD', 'PKR')),
  CONSTRAINT "platform_invoices_invoice_currency_check" CHECK ("invoice_currency" IN ('USD', 'PKR')),
  CONSTRAINT "platform_invoices_amounts_check" CHECK ("subtotal" >= 0 AND "discount_total" >= 0 AND "discount_total" <= "subtotal" AND "total" = "subtotal" - "discount_total" AND "received_total" >= 0),
  CONSTRAINT "platform_invoices_days_check" CHECK ("billable_days" BETWEEN 1 AND "days_in_period" AND "days_in_period" BETWEEN 28 AND 31),
  CONSTRAINT "platform_invoices_finalized_check" CHECK ("status" = 'draft' OR "finalized_at" IS NOT NULL)
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "platform_invoices_location_id_idx" ON "platform_invoices" ("location_id");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "platform_invoices_location_period_idx" ON "platform_invoices" ("location_id", "period_start");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "platform_invoices_number_idx" ON "platform_invoices" ("invoice_number");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "platform_invoices_status_due_idx" ON "platform_invoices" ("status", "due_date");
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "platform_invoice_lines" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "invoice_id" uuid NOT NULL REFERENCES "platform_invoices"("id") ON DELETE cascade,
  "location_id" text NOT NULL REFERENCES "schools"("location_id") ON DELETE cascade,
  "kind" text NOT NULL,
  "description" text NOT NULL,
  "role" text,
  "module_key" text,
  "quantity" integer DEFAULT 1 NOT NULL,
  "unit_rate" numeric(12, 2) DEFAULT '0' NOT NULL,
  "billing_amount" numeric(14, 2) NOT NULL,
  "amount" numeric(14, 2) NOT NULL,
  "source_invoice_id" uuid REFERENCES "platform_invoices"("id") ON DELETE set null,
  "sort_order" integer DEFAULT 0 NOT NULL,
  CONSTRAINT "platform_invoice_lines_kind_check" CHECK ("kind" IN ('role', 'module', 'carry_forward')),
  CONSTRAINT "platform_invoice_lines_amount_check" CHECK ("amount" >= 0 AND "quantity" >= 0)
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "platform_invoice_lines_invoice_id_idx" ON "platform_invoice_lines" ("invoice_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "platform_invoice_lines_location_id_idx" ON "platform_invoice_lines" ("location_id");
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "platform_invoice_discounts" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "invoice_id" uuid NOT NULL REFERENCES "platform_invoices"("id") ON DELETE cascade,
  "location_id" text NOT NULL REFERENCES "schools"("location_id") ON DELETE cascade,
  "kind" text NOT NULL,
  "percent_basis_points" integer,
  "fixed_amount" numeric(14, 2),
  "amount" numeric(14, 2) NOT NULL,
  "description" text NOT NULL,
  "position" integer NOT NULL,
  "created_by" text NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "platform_invoice_discounts_kind_check" CHECK ("kind" IN ('percent', 'fixed')),
  CONSTRAINT "platform_invoice_discounts_position_check" CHECK ("position" BETWEEN 1 AND 3),
  CONSTRAINT "platform_invoice_discounts_value_check" CHECK (("kind" = 'percent' AND "percent_basis_points" BETWEEN 1 AND 10000 AND "fixed_amount" IS NULL) OR ("kind" = 'fixed' AND "fixed_amount" > 0 AND "percent_basis_points" IS NULL)),
  CONSTRAINT "platform_invoice_discounts_description_check" CHECK (btrim("description") <> '')
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "platform_invoice_discounts_location_id_idx" ON "platform_invoice_discounts" ("location_id");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "platform_invoice_discounts_slot_idx" ON "platform_invoice_discounts" ("invoice_id", "position");
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "platform_invoice_receipts" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "invoice_id" uuid NOT NULL REFERENCES "platform_invoices"("id") ON DELETE cascade,
  "location_id" text NOT NULL REFERENCES "schools"("location_id") ON DELETE cascade,
  "amount" numeric(14, 2) NOT NULL,
  "transaction_id" text NOT NULL,
  "description" text,
  "recorded_by" text NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "platform_invoice_receipts_amount_check" CHECK ("amount" > 0),
  CONSTRAINT "platform_invoice_receipts_transaction_check" CHECK (btrim("transaction_id") <> '')
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "platform_invoice_receipts_invoice_id_idx" ON "platform_invoice_receipts" ("invoice_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "platform_invoice_receipts_location_id_idx" ON "platform_invoice_receipts" ("location_id");
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "platform_invoice_emails" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "invoice_id" uuid NOT NULL REFERENCES "platform_invoices"("id") ON DELETE cascade,
  "location_id" text NOT NULL REFERENCES "schools"("location_id") ON DELETE cascade,
  "to_address" text NOT NULL,
  "status" text NOT NULL,
  "error" text,
  "sent_by" text NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "platform_invoice_emails_status_check" CHECK ("status" IN ('sent', 'failed'))
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "platform_invoice_emails_invoice_id_idx" ON "platform_invoice_emails" ("invoice_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "platform_invoice_emails_location_id_idx" ON "platform_invoice_emails" ("location_id");
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "platform_bank_accounts" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "bank_name" text NOT NULL,
  "account_title" text NOT NULL,
  "account_number" text NOT NULL,
  "iban" text NOT NULL,
  "branch_name" text,
  "branch_code" text,
  "city" text,
  "position" integer NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "platform_bank_accounts_position_check" CHECK ("position" BETWEEN 1 AND 3),
  CONSTRAINT "platform_bank_accounts_iban_check" CHECK ("iban" ~ '^PK[0-9]{2}[A-Z]{4}[0-9A-Z]{16}$'),
  CONSTRAINT "platform_bank_accounts_required_check" CHECK (btrim("bank_name") <> '' AND btrim("account_title") <> '' AND btrim("account_number") <> '')
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "platform_bank_accounts_position_idx" ON "platform_bank_accounts" ("position");
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "billing_reminders" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "location_id" text NOT NULL REFERENCES "schools"("location_id") ON DELETE cascade,
  "kind" text NOT NULL,
  "trial_ends_on" date NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "billing_reminders_kind_check" CHECK ("kind" IN ('trial_5d', 'trial_1d'))
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "billing_reminders_location_id_idx" ON "billing_reminders" ("location_id");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "billing_reminders_claim_idx" ON "billing_reminders" ("location_id", "kind", "trial_ends_on");
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "school_access_events" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "location_id" text NOT NULL REFERENCES "schools"("location_id") ON DELETE cascade,
  "action" text NOT NULL,
  "reason" text NOT NULL,
  "actor" text NOT NULL,
  "invoice_id" uuid REFERENCES "platform_invoices"("id") ON DELETE set null,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "school_access_events_action_check" CHECK ("action" IN ('blocked', 'unblocked')),
  CONSTRAINT "school_access_events_reason_check" CHECK ("reason" IN ('manual', 'overdue', 'payment'))
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "school_access_events_location_id_idx" ON "school_access_events" ("location_id", "created_at");
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "login_handoff_tokens" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "location_id" text NOT NULL REFERENCES "schools"("location_id") ON DELETE cascade,
  "token_hash" text NOT NULL,
  "auth_user_id" text NOT NULL,
  "email" text NOT NULL,
  "expires_at" timestamp with time zone NOT NULL,
  "used_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "login_handoff_tokens_token_hash_idx" ON "login_handoff_tokens" ("token_hash");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "login_handoff_tokens_location_id_idx" ON "login_handoff_tokens" ("location_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "login_handoff_tokens_expires_at_idx" ON "login_handoff_tokens" ("expires_at");
--> statement-breakpoint

-- ══ The block, on the table every school request already joins ══════════
ALTER TABLE "schools" ADD COLUMN IF NOT EXISTS "access_blocked_at" timestamp with time zone;
--> statement-breakpoint

-- ══ The apex sign-in's own throttle counter ═════════════════════════════
ALTER TABLE "auth_attempts" DROP CONSTRAINT IF EXISTS "auth_attempts_scope_check";
--> statement-breakpoint
ALTER TABLE "auth_attempts" ADD CONSTRAINT "auth_attempts_scope_check"
  CHECK (scope IN ('login', 'otp_request', 'password_reset', 'setup', 'super_admin_login', 'central_login'));
--> statement-breakpoint

-- ══ Backfill: every school is Sandbox (E8) ══════════════════════════════
INSERT INTO "school_billing_settings" ("location_id")
SELECT "location_id" FROM "schools"
ON CONFLICT ("location_id") DO NOTHING;
--> statement-breakpoint

-- ══ Backfill: Phase 1 is on everywhere, and Included from now on (E9) ═══
-- An existing row is switched on rather than replaced, so the audit breadcrumb
-- on a module somebody switched on by hand survives.
INSERT INTO "school_modules" ("location_id", "module_key", "is_enabled", "enabled_at", "enabled_by")
SELECT s."location_id", k."key", true, now(), 'migration 0052'
  FROM "schools" s
 CROSS JOIN (VALUES ('admissions'), ('fee_management'), ('academics')) AS k("key")
ON CONFLICT ("location_id", "module_key") DO UPDATE
   SET "is_enabled" = true,
       "enabled_at" = COALESCE("school_modules"."enabled_at", now()),
       "enabled_by" = COALESCE("school_modules"."enabled_by", 'migration 0052');
--> statement-breakpoint

-- ══ RLS and REVOKE on every new table ═══════════════════════════════════
-- `0050` locked down the 118 tables that existed when it was written; it is
-- not a standing rule, and a table created afterwards is the one table in
-- `public` with RLS off unless it says otherwise (`0051`'s header, at length).
-- RLS **and** REVOKE, so reopening any of these takes two mistakes, not one.
-- The application connects as `postgres`, which bypasses RLS.
ALTER TABLE "public"."super_admin_users" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "public"."school_billing_settings" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "public"."school_role_rates" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "public"."school_module_rates" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "public"."platform_invoices" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "public"."platform_invoice_lines" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "public"."platform_invoice_discounts" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "public"."platform_invoice_receipts" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "public"."platform_invoice_emails" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "public"."platform_bank_accounts" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "public"."billing_reminders" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "public"."school_access_events" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "public"."login_handoff_tokens" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
REVOKE ALL ON TABLE
  "public"."super_admin_users",
  "public"."school_billing_settings",
  "public"."school_role_rates",
  "public"."school_module_rates",
  "public"."platform_invoices",
  "public"."platform_invoice_lines",
  "public"."platform_invoice_discounts",
  "public"."platform_invoice_receipts",
  "public"."platform_invoice_emails",
  "public"."platform_bank_accounts",
  "public"."billing_reminders",
  "public"."school_access_events",
  "public"."login_handoff_tokens"
FROM "anon", "authenticated";
--> statement-breakpoint
REVOKE ALL ON FUNCTION "public"."super_admin_users_protect_owner"() FROM "anon", "authenticated", PUBLIC;
