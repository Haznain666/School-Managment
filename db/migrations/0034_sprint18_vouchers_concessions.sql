-- Sprint 18 — the voucher, the concession the school owns, and the four
-- student-record permissions.
--
-- Five blocks, one migration, and every one of them expand-only: three new
-- tables, five new columns each with a default or nullable, and one CHECK
-- widened. No existing column is altered, no row is rewritten, and nothing
-- serving today reads any of it — so this is safe to apply while the *old*
-- build is still up, which is the order it will actually be applied in.
--
-- ── Block 1: role_permissions_permission_check ───────────────────────────
-- Sprint 18 split the student record out of `admissions.*` into four keys:
-- `students.read`, `students.create`, `students.update`, `students.delete`.
-- The list below is regenerated from `PERMISSIONS` in `lib/permissions.ts`,
-- which is also what `db/schema/role-permissions.ts` derives its CHECK from —
-- the two must be the same list or the schema file and the live database
-- disagree, which is the exact failure this constraint exists to prevent.
--
-- Nothing breaks *before* this runs, which is why it can travel with the rest.
-- `DEFAULT_ROLE_PERMISSIONS` is code, so a school with no override row already
-- holds the new keys with no write at all. What needs this is the first school
-- that toggles one on the permissions screen: without it Postgres refuses the
-- INSERT with a constraint name and no explanation.
--
-- ── Block 2: fee_challan_reminders ───────────────────────────────────────
-- One row per reminder actually sent about a voucher, so the defaulters screen
-- can say `Reminder 2 · 02-Aug-2026` instead of leaving three clerks each
-- assuming somebody else has chased the family.
--
-- The unique index on (challan_id, sequence) is load-bearing rather than
-- hygienic. The route computes the sequence *inside* the INSERT —
-- `INSERT … SELECT coalesce(max(sequence), 0) + 1 … ON CONFLICT DO NOTHING` —
-- because a read followed by an insert is CLAUDE.md's background-work mistake
-- in a different costume: two clicks a second apart both read 1 and both write
-- 2. With the index, Postgres decides it on one row under one lock and the
-- loser writes nothing, which is the right outcome — the reminder it was about
-- to record was the duplicate nobody wanted.
--
-- ── Block 3: concession schemes ──────────────────────────────────────────
-- A sibling discount is one decision a school made once, and it was being
-- typed again per child: three spellings of the same policy, a rate that
-- drifted between the second child and the fourth, and no way to answer "who
-- is on the staff discount".
--
-- A scheme is that decision, named once and unique per school. Granting it
-- still writes a `student_concessions` row, and that row **freezes the name,
-- the rate and the dates at grant time** exactly as a voucher line freezes its
-- price. `scheme_id` is provenance, never a live join: renaming a scheme in
-- March must not rewrite February's slip, and cutting a rate must not
-- retroactively re-bill the children granted the old one. Hence
-- `ON DELETE SET NULL` — deleting a policy is not the same act as taking a
-- discount off four hundred children.
--
-- The two join tables carry the fee heads, and **no rows means every head, of
-- every category**. That is not a convention invented here; it is the existing
-- meaning of a null `applies_to_fee_type_id`, and STATE.md §5be records what
-- reading it narrowly cost — an unqualified "20% sibling discount", the
-- commonest thing a school writes, silently never reached the admission,
-- annual or examination fee, and a discount that does not apply looks
-- identical on screen to one the school never granted.
--
-- `applies_to_fee_type_id` is **not** backfilled into
-- `student_concession_fee_types` and not dropped. A legacy grant carries its
-- single head in the old column, the calculator folds it into the array on the
-- way out, and it goes on behaving exactly as it did.
--
-- ── Block 4: fee_challan_items.concession_detail ─────────────────────────
-- `Sibling Discount 20%, Staff Discount PKR 2,000`, persisted at generation
-- time for the same reason `description` is. A parent reads a voucher once, at
-- a counter, and a bare `−4,000` in the Concession column is a figure they have
-- to telephone the school to understand. Null on every existing row, which is
-- correct: nothing knows what those lines were discounted by, and inventing an
-- explanation is worse than not offering one.
--
-- ── Block 5: late_fee_rules auto-send ────────────────────────────────────
-- The monthly voucher email, on a timer. **Off by default and it must stay
-- off** until a school turns it on: a sprint that deployed and began writing
-- to every parent at a school that never asked would be the worst thing this
-- module could do, and an email cannot be recalled.
--
-- `auto_send_last_run_on` is the claim column, not a log. Production runs
-- seven server processes, each with its own timer, and a read-then-check lets
-- all seven decide to send — so the sweeper claims a school with a conditional
-- `UPDATE … WHERE auto_send_vouchers AND auto_send_day = <today's day> AND
-- (auto_send_last_run_on IS NULL OR auto_send_last_run_on < <today>) RETURNING`
-- and exactly one process gets the row. CLAUDE.md's rule, and this column is
-- the whole of it.

-- ─────────────────────────────────────────────────────────────────────────
-- Block 1 — the permission catalogue
-- ─────────────────────────────────────────────────────────────────────────

ALTER TABLE "role_permissions" DROP CONSTRAINT IF EXISTS "role_permissions_permission_check";--> statement-breakpoint

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
    'payroll.read', 'payroll.write', 'comms.read',
    'comms.write', 'comms.send', 'settings.read',
    'settings.write', 'principals.manage', 'permissions.manage',
    'accounting.read', 'accounting.write', 'accounting.settle'
  )
);--> statement-breakpoint

-- ─────────────────────────────────────────────────────────────────────────
-- Block 2 — fee_challan_reminders
-- ─────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS "fee_challan_reminders" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "location_id" text NOT NULL,
  "challan_id" uuid NOT NULL,
  "sequence" integer NOT NULL,
  "sent_at" timestamp with time zone DEFAULT now() NOT NULL,
  "sent_to_email" text,
  "sent_by_uid" text
);--> statement-breakpoint

DO $$ BEGIN
  ALTER TABLE "fee_challan_reminders" ADD CONSTRAINT "fee_challan_reminders_location_id_schools_location_id_fk"
    FOREIGN KEY ("location_id") REFERENCES "public"."schools"("location_id")
    ON DELETE cascade ON UPDATE no action;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint

DO $$ BEGIN
  ALTER TABLE "fee_challan_reminders" ADD CONSTRAINT "fee_challan_reminders_challan_id_fee_challans_id_fk"
    FOREIGN KEY ("challan_id") REFERENCES "public"."fee_challans"("id")
    ON DELETE cascade ON UPDATE no action;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "fee_challan_reminders_location_id_idx" ON "fee_challan_reminders" USING btree ("location_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "fee_challan_reminders_challan_id_idx" ON "fee_challan_reminders" USING btree ("challan_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "fee_challan_reminders_challan_sequence_idx" ON "fee_challan_reminders" USING btree ("challan_id", "sequence");--> statement-breakpoint

-- ─────────────────────────────────────────────────────────────────────────
-- Block 3 — concession schemes, and the two head sets
-- ─────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS "concession_schemes" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "location_id" text NOT NULL,
  "name" text NOT NULL,
  "discount_type" text NOT NULL,
  "discount_value" numeric(10, 2) NOT NULL,
  "valid_from" date NOT NULL,
  "valid_until" date,
  "is_active" boolean DEFAULT true NOT NULL,
  "notes" text,
  "created_by_uid" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "concession_schemes_discount_type_check" CHECK ("discount_type" IN ('percentage', 'fixed'))
);--> statement-breakpoint

DO $$ BEGIN
  ALTER TABLE "concession_schemes" ADD CONSTRAINT "concession_schemes_location_id_schools_location_id_fk"
    FOREIGN KEY ("location_id") REFERENCES "public"."schools"("location_id")
    ON DELETE cascade ON UPDATE no action;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "concession_schemes_location_id_idx" ON "concession_schemes" USING btree ("location_id");--> statement-breakpoint
-- Two schemes called "Sibling Discount" at one school is the drift this table
-- exists to end.
CREATE UNIQUE INDEX IF NOT EXISTS "concession_schemes_location_name_idx" ON "concession_schemes" USING btree ("location_id", "name");--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "concession_scheme_fee_types" (
  "scheme_id" uuid NOT NULL,
  "fee_type_id" uuid NOT NULL,
  CONSTRAINT "concession_scheme_fee_types_scheme_id_fee_type_id_pk" PRIMARY KEY("scheme_id", "fee_type_id")
);--> statement-breakpoint

DO $$ BEGIN
  ALTER TABLE "concession_scheme_fee_types" ADD CONSTRAINT "concession_scheme_fee_types_scheme_id_concession_schemes_id_fk"
    FOREIGN KEY ("scheme_id") REFERENCES "public"."concession_schemes"("id")
    ON DELETE cascade ON UPDATE no action;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint

DO $$ BEGIN
  ALTER TABLE "concession_scheme_fee_types" ADD CONSTRAINT "concession_scheme_fee_types_fee_type_id_fee_types_id_fk"
    FOREIGN KEY ("fee_type_id") REFERENCES "public"."fee_types"("id")
    ON DELETE cascade ON UPDATE no action;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "concession_scheme_fee_types_fee_type_id_idx" ON "concession_scheme_fee_types" USING btree ("fee_type_id");--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "student_concession_fee_types" (
  "student_concession_id" uuid NOT NULL,
  "fee_type_id" uuid NOT NULL,
  CONSTRAINT "student_concession_fee_types_student_concession_id_fee_type_id_pk" PRIMARY KEY("student_concession_id", "fee_type_id")
);--> statement-breakpoint

DO $$ BEGIN
  ALTER TABLE "student_concession_fee_types" ADD CONSTRAINT "student_concession_fee_types_student_concession_id_student_concessions_id_fk"
    FOREIGN KEY ("student_concession_id") REFERENCES "public"."student_concessions"("id")
    ON DELETE cascade ON UPDATE no action;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint

DO $$ BEGIN
  ALTER TABLE "student_concession_fee_types" ADD CONSTRAINT "student_concession_fee_types_fee_type_id_fee_types_id_fk"
    FOREIGN KEY ("fee_type_id") REFERENCES "public"."fee_types"("id")
    ON DELETE cascade ON UPDATE no action;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "student_concession_fee_types_fee_type_id_idx" ON "student_concession_fee_types" USING btree ("fee_type_id");--> statement-breakpoint

-- Provenance on the grant. Nullable, `SET NULL` on delete, never backfilled:
-- every grant written before Sprint 18 was typed by hand and came from no
-- scheme, and saying so honestly is the only correct value.
ALTER TABLE "student_concessions" ADD COLUMN IF NOT EXISTS "scheme_id" uuid;--> statement-breakpoint

DO $$ BEGIN
  ALTER TABLE "student_concessions" ADD CONSTRAINT "student_concessions_scheme_id_concession_schemes_id_fk"
    FOREIGN KEY ("scheme_id") REFERENCES "public"."concession_schemes"("id")
    ON DELETE set null ON UPDATE no action;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "student_concessions_scheme_id_idx" ON "student_concessions" USING btree ("scheme_id");--> statement-breakpoint

-- ─────────────────────────────────────────────────────────────────────────
-- Block 4 — the voucher line explains its own discount
-- ─────────────────────────────────────────────────────────────────────────

ALTER TABLE "fee_challan_items" ADD COLUMN IF NOT EXISTS "concession_detail" text;--> statement-breakpoint

-- ─────────────────────────────────────────────────────────────────────────
-- Block 5 — the monthly voucher email, on a timer
-- ─────────────────────────────────────────────────────────────────────────

ALTER TABLE "late_fee_rules" ADD COLUMN IF NOT EXISTS "auto_send_vouchers" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "late_fee_rules" ADD COLUMN IF NOT EXISTS "auto_send_day" integer DEFAULT 28 NOT NULL;--> statement-breakpoint
ALTER TABLE "late_fee_rules" ADD COLUMN IF NOT EXISTS "auto_send_last_run_on" date;--> statement-breakpoint

DO $$ BEGIN
  ALTER TABLE "late_fee_rules" ADD CONSTRAINT "late_fee_rules_auto_send_day_check"
    CHECK ("auto_send_day" BETWEEN 1 AND 28);
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;
