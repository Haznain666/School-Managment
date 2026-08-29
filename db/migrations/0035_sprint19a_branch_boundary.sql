-- Sprint 19a — the branch boundary.
--
-- Three blocks, one migration, and every one of them expand-only: one CHECK
-- widened, one new table, and nine new columns that are all nullable with no
-- default. No existing column is altered, no row is rewritten, and nothing
-- serving today reads any of it — so this is safe to apply while the *old*
-- build is still up, which is the order it will actually be applied in.
--
-- The opposite order is not safe. `lib/branch-scope.ts` selects from
-- `school_user_branches` on **every request that resolves a scope**, which is
-- the school-admin dashboard, the reports runner, the users list, the
-- admissions overview and both branch screens. A build deployed ahead of this
-- migration takes all of them down at once with `relation does not exist` —
-- the §5aw failure, one module over, and the reason `0029` carries the banner
-- it does. `SPRINT-19A-DDL-NOTES.md` at the repo root states it in full.
--
-- ── Block 1: role_permissions_permission_check ───────────────────────────
-- Sprint 19a adds one key, `branches.manage`, which gates editing and deleting
-- a campus from the school portal. Creating one stays on `settings.write`,
-- where it has been since Sprint 10.5, so a school that never opens the
-- permissions screen can still make its first campus exactly as it could
-- yesterday.
--
-- The list below is regenerated from `PERMISSIONS` in `lib/permissions.ts`,
-- which is also what `db/schema/role-permissions.ts` derives its CHECK from —
-- the two must be the same list or the schema file and the live database
-- disagree, which is the exact failure this constraint exists to prevent.
--
-- Nothing breaks *before* this runs. `DEFAULT_ROLE_PERMISSIONS` is code, and
-- `school_admin` holds `[...PERMISSIONS]`, so the owner already has the key
-- with no row written anywhere. What needs this is the first school that
-- toggles it on the permissions screen: without it Postgres refuses the INSERT
-- with a constraint name and no explanation.
--
-- ── Block 2: school_user_branches ────────────────────────────────────────
-- Decision D2: cross-branch access is granted per person, not per role. A
-- school group asked for "let the Karachi principal also see Hyderabad".
-- Expressed as a role permission that is a grant to *every* principal at the
-- school at once, and it cannot be taken back from one of them without taking
-- it from all. So the grant is a row about a person.
--
-- An empty table is the state of every school on the day this deploys, and an
-- empty table resolves to exactly the behaviour the product has today: a
-- branch-bound member reaches one campus. Nothing has to be seeded and nothing
-- has to be backfilled.
--
-- The unique index on (school_user_id, branch_id) is load-bearing rather than
-- hygienic. The branch form's "the school owner" path writes this row every
-- time the campus is saved, so without the index re-saving a campus would bank
-- a second identical grant and revoking would take two deletes — the same
-- shape of bug `fee_challan_reminders` carries its unique index for.
--
-- `granted_by_uid` is kept because "who gave this principal the Karachi campus"
-- is a question a school group gets asked, usually months later and usually
-- because something went wrong. It is not a full audit trail — revoking the
-- grant deletes the row — but while the grant stands it is the only record of
-- who made it, and a column that answers with silence is worse than one nobody
-- reads.
--
-- ── Block 3: nine nullable branch_id columns ─────────────────────────────
-- Decision D1: a catalogue row belongs to one campus, or to none. NULL means
-- *shared by every branch* and is what every existing row is, so nothing
-- changes for any school on the day this deploys. A value means *this campus
-- only*.
--
-- Rejected, explicitly and not to be re-litigated: a NOT NULL backfill to the
-- main branch. A three-campus school would then have to re-create the same
-- grading scheme three times, every existing report card would point at a
-- scheme that had silently become one campus's, and the backfill cannot be
-- undone because nothing records which rows were school-wide before it ran.
--
-- **ON DELETE SET NULL on every one of them, never CASCADE.** Closing a campus
-- must not delete the school's grading scheme, its fee heads or its exam terms
-- — every published report card and every issued voucher points at those rows.
-- A branch-owned row whose branch is gone becomes shared, which is the safe
-- direction: it stays visible to everybody rather than disappearing from the
-- one place it could be corrected.
--
-- The index on each is (location_id, branch_id) rather than (branch_id) alone.
-- Every read is tenant-first — `location_id` is in the WHERE of every query in
-- this repo — so a leading branch_id index would be the wrong shape for the
-- only access pattern there is.
--
-- ⚠ `late_fee_rules.branch_id` is **inert on arrival**, and deliberately.
-- `late_fee_rules.location_id` carries a UNIQUE constraint — one policy per
-- school — so no second row can exist to hold a campus, and every row is and
-- stays NULL. The column ships now because it is expand-only and because
-- relaxing that unique index is a separate decision: the moment two rows can
-- exist, every reader of the table has to choose between them, and there is no
-- code today that would. Adding the column without relaxing the index changes
-- nothing and closes no door; doing both in one migration would ship a state
-- the application cannot yet reason about.

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
    'settings.write', 'branches.manage', 'principals.manage',
    'permissions.manage', 'accounting.read', 'accounting.write',
    'accounting.settle'
  )
);--> statement-breakpoint

-- ─────────────────────────────────────────────────────────────────────────
-- Block 2 — school_user_branches
-- ─────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS "school_user_branches" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "location_id" text NOT NULL,
  "school_user_id" uuid NOT NULL,
  "branch_id" uuid NOT NULL,
  "granted_by_uid" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint

DO $$ BEGIN
  ALTER TABLE "school_user_branches" ADD CONSTRAINT "school_user_branches_location_id_schools_location_id_fk"
    FOREIGN KEY ("location_id") REFERENCES "public"."schools"("location_id")
    ON DELETE cascade ON UPDATE no action;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint

DO $$ BEGIN
  ALTER TABLE "school_user_branches" ADD CONSTRAINT "school_user_branches_school_user_id_school_users_id_fk"
    FOREIGN KEY ("school_user_id") REFERENCES "public"."school_users"("id")
    ON DELETE cascade ON UPDATE no action;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint

DO $$ BEGIN
  ALTER TABLE "school_user_branches" ADD CONSTRAINT "school_user_branches_branch_id_branches_id_fk"
    FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id")
    ON DELETE cascade ON UPDATE no action;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint

-- The resolver's own lookup: one person, every campus granted to them.
CREATE INDEX IF NOT EXISTS "school_user_branches_location_user_idx" ON "school_user_branches" USING btree ("location_id", "school_user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "school_user_branches_branch_id_idx" ON "school_user_branches" USING btree ("branch_id");--> statement-breakpoint
-- Granting the same campus twice is not a second grant. See the header.
CREATE UNIQUE INDEX IF NOT EXISTS "school_user_branches_user_branch_idx" ON "school_user_branches" USING btree ("school_user_id", "branch_id");--> statement-breakpoint

-- ─────────────────────────────────────────────────────────────────────────
-- Block 3 — the nine nullable branch_id columns
--
-- Written out one table at a time rather than in a DO loop: a loop hides which
-- table failed, and this is the block most likely to meet a database that has
-- already had one of them added by hand.
-- ─────────────────────────────────────────────────────────────────────────

ALTER TABLE "subjects" ADD COLUMN IF NOT EXISTS "branch_id" uuid;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "subjects" ADD CONSTRAINT "subjects_branch_id_branches_id_fk"
    FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id")
    ON DELETE set null ON UPDATE no action;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "subjects_location_branch_idx" ON "subjects" USING btree ("location_id", "branch_id");--> statement-breakpoint

ALTER TABLE "fee_types" ADD COLUMN IF NOT EXISTS "branch_id" uuid;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "fee_types" ADD CONSTRAINT "fee_types_branch_id_branches_id_fk"
    FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id")
    ON DELETE set null ON UPDATE no action;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "fee_types_location_branch_idx" ON "fee_types" USING btree ("location_id", "branch_id");--> statement-breakpoint

ALTER TABLE "grading_schemes" ADD COLUMN IF NOT EXISTS "branch_id" uuid;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "grading_schemes" ADD CONSTRAINT "grading_schemes_branch_id_branches_id_fk"
    FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id")
    ON DELETE set null ON UPDATE no action;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "grading_schemes_location_branch_idx" ON "grading_schemes" USING btree ("location_id", "branch_id");--> statement-breakpoint

ALTER TABLE "exam_terms" ADD COLUMN IF NOT EXISTS "branch_id" uuid;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "exam_terms" ADD CONSTRAINT "exam_terms_branch_id_branches_id_fk"
    FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id")
    ON DELETE set null ON UPDATE no action;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "exam_terms_location_branch_idx" ON "exam_terms" USING btree ("location_id", "branch_id");--> statement-breakpoint

ALTER TABLE "concession_schemes" ADD COLUMN IF NOT EXISTS "branch_id" uuid;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "concession_schemes" ADD CONSTRAINT "concession_schemes_branch_id_branches_id_fk"
    FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id")
    ON DELETE set null ON UPDATE no action;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "concession_schemes_location_branch_idx" ON "concession_schemes" USING btree ("location_id", "branch_id");--> statement-breakpoint

ALTER TABLE "leave_types" ADD COLUMN IF NOT EXISTS "branch_id" uuid;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "leave_types" ADD CONSTRAINT "leave_types_branch_id_branches_id_fk"
    FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id")
    ON DELETE set null ON UPDATE no action;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "leave_types_location_branch_idx" ON "leave_types" USING btree ("location_id", "branch_id");--> statement-breakpoint

ALTER TABLE "salary_components" ADD COLUMN IF NOT EXISTS "branch_id" uuid;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "salary_components" ADD CONSTRAINT "salary_components_branch_id_branches_id_fk"
    FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id")
    ON DELETE set null ON UPDATE no action;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "salary_components_location_branch_idx" ON "salary_components" USING btree ("location_id", "branch_id");--> statement-breakpoint

ALTER TABLE "result_subcategories" ADD COLUMN IF NOT EXISTS "branch_id" uuid;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "result_subcategories" ADD CONSTRAINT "result_subcategories_branch_id_branches_id_fk"
    FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id")
    ON DELETE set null ON UPDATE no action;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "result_subcategories_location_branch_idx" ON "result_subcategories" USING btree ("location_id", "branch_id");--> statement-breakpoint

-- Inert on arrival — `late_fee_rules.location_id` is UNIQUE. See the header.
ALTER TABLE "late_fee_rules" ADD COLUMN IF NOT EXISTS "branch_id" uuid;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "late_fee_rules" ADD CONSTRAINT "late_fee_rules_branch_id_branches_id_fk"
    FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id")
    ON DELETE set null ON UPDATE no action;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "late_fee_rules_location_branch_idx" ON "late_fee_rules" USING btree ("location_id", "branch_id");
