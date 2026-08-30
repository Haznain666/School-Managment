-- Sprint 20 — the voucher, the discount, and the bank.
--
-- Four blocks, one migration, and every one of them expand-only: one new table
-- and five new columns, all of them either nullable or carrying a default. No
-- existing column is altered, no CHECK is widened, no row is rewritten and no
-- permission key is added — so this is safe to apply while the **old** build is
-- still serving, which is the order it will actually be applied in.
--
-- ⚠ THE OPPOSITE ORDER IS NOT SAFE, AND ONE ROW OF THE TABLE BELOW IS WORSE
-- THAN THE REST.
--
--   Surface                              Without this migration
--   ───────────────────────────────────  ────────────────────────────────────
--   /dashboard/settings/banks            500 — `bank_accounts` does not exist
--   ANY voucher detail page, and         500 — getChallanDetail now selects
--   the printed voucher                        schools.ntn/.website/
--                                              .finance_email, and the print
--                                              builder reads bank_accounts
--   POST …/challans/[id]/payments        500 — RECORDING A FEE PAYMENT STOPS
--                                              WORKING AT EVERY SCHOOL. It
--                                              calls getChallanDetail first.
--   /dashboard/fees/concessions          500 — listConcessionSchemes selects
--                                              scheme_type
--   /dashboard/fees/settings             500 — the settings read selects the
--                                              two new booleans
--   /dashboard/settings                  500 — the school profile selects ntn,
--                                              website and finance_email
--   the student profile + the wizard     the discount panel's read fails and
--                                        the card shows its error state
--   ENROLLING A CHILD                    still works — see below
--
-- The payments row is the one to read twice. Every other failure is a *read*:
-- loud, harmless, reported within the minute. The payments route reads before
-- it writes, so there is no partial state and no ledger entry without its
-- payment — but a fee counter that cannot take money, with a parent standing at
-- it, is the most expensive half-hour this deployment can have.
--
-- **The enrolment does not roll back**, and that is deliberate rather than
-- lucky. The sibling auto-grant runs *after* `enrollStudent` has committed and
-- swallows its own failures — the judgement the GHL sync and the photo upload
-- already make, and the reason the §5bi hazard has no equivalent here. It could
-- not have been inside the transaction in any case: `batch()` builds every
-- statement before any of them runs, and the sibling question is answered from
-- the guardian rows that batch is writing.
--
-- `SPRINT-20-DDL-NOTES.md` at the repo root states all of it in full, with the
-- order to apply it in, how to verify it and how to undo it.
--
-- **No new permission keys.** Bank accounts reuse `settings.read` /
-- `settings.write` — the pair the rest of Settings already runs on — and the
-- discount panel reuses `fees.read` / `fees.write`. `role_permissions`'s
-- `permission` CHECK is therefore untouched, which is deliberate: STATE.md §5o
-- records what happens when code ships a key the database has never heard of,
-- and none of this is a new *kind* of thing a school would grant separately.
--
-- ── Block 1: concession_schemes.scheme_type ──────────────────────────────
-- Item 5. Three kinds — `sibling`, `scholarship`, `other` — and the type is not
-- a description. It is the slot a scheme occupies on the apply-discount modal,
-- where the operator may select at most one of each, and for `sibling` it is
-- how the auto-apply and the last-child sweep know which scheme they mean.
--
-- **Backfilled to `other`, and nothing is inferred from a name.** A scheme
-- called "Sibling Discount" almost certainly is one, and guessing that from a
-- string is precisely the drift `concession_schemes` was created to end — the
-- same school also holds "Sibling disc." and "sibling discount (2 kids)".
-- `other` is the honest answer for a row created before the question was asked
-- and it is one dropdown to correct. The alternative — a migration that reads
-- names and decides — would silently mark somebody's "Sibling of Staff" scheme
-- as the school's sibling policy, at which point the last-child sweep would one
-- day remove it.
--
-- The default is kept on the column rather than dropped after the backfill.
-- Every insert in the code names the value explicitly, so the default is never
-- reached in practice; leaving it means an `INSERT` written by hand at a psql
-- prompt cannot fail on a NOT NULL nobody remembered.
--
-- ── Block 2: late_fee_rules, two booleans ────────────────────────────────
-- Item 6, and `late_fee_rules` is where they belong: that table has been "the
-- school's fee settings" since the due day moved into it, one row per school,
-- and a second single-row settings table would only be somewhere else to look.
--
-- Both default **false**, and `auto_apply_sibling_discount` is the one that
-- matters. A sprint that deployed and began discounting every family's fees at
-- a school that never asked for it is the fee module's equivalent of the
-- auto-send email — and it is *worse*, because it is not recoverable by
-- switching the toggle back: the vouchers have already been priced, printed and
-- in some cases paid, and unwinding that is a conversation with four hundred
-- parents rather than a column update.
--
-- `sibling_discount_for_last_child` defaults false because that is the
-- behaviour the requirement describes: a discount granted for *having* siblings
-- is not owed to a child who no longer has any. A school that reads it as a
-- loyalty discount instead switches it on and the sweep stops removing
-- anything.
--
-- ── Block 3: schools.ntn, .website, .finance_email ───────────────────────
-- Decision D4. The reference voucher prints all three and the product held
-- none of them. Nullable with no default, printed **only when set** — a blank
-- `NTN #` on a fee slip is a question a parent asks at the counter, so the
-- label is omitted with the value rather than printed empty.
--
-- `finance_email` is deliberately not `schools.email`. The office address and
-- the desk that reconciles a bank transfer are two different inboxes at every
-- school large enough to have a finance office, and the note printed under the
-- bank block names the second. Null means the note is not printed at all.
--
-- `ntn` is free text. NTN formats have changed twice, and a school that types
-- its STRN here instead is still printing the number it means to print; a CHECK
-- would refuse a correct document to enforce a shape the tax authority has
-- already abandoned.
--
-- ── Block 4: bank_accounts ───────────────────────────────────────────────
-- Item 10. Where a school's money arrives and where its salaries leave from.
--
-- School-wide reference data read by **two** modules and owned by neither: Fees
-- prints the student-facing accounts on a voucher, Payroll pays out of the
-- staff-facing ones. Filing it under Fees would put the payroll bank under
-- Fees, which is where nobody would look for it.
--
-- `purpose` is `text` + CHECK on three values rather than two booleans. Two
-- booleans admit a fourth state — neither set — which is an account that exists
-- and is for nothing, and every reader would then have to decide whether that
-- meant "both" or "hidden". Three named values cannot hold the answer nobody
-- meant.
--
-- `branch_id` is **nullable and means shared**, which is decision D1 of Sprint
-- 19a one table further on, and `ON DELETE set null` for the same reason the
-- nine catalogue tables of `0035` are: an account whose campus is deleted is
-- still the school's account, and cascading would delete the bank details a
-- voucher printed last month along with the campus record. Read it with
-- `sharedOrOwnedBy`, never with `eq` — every row is shared on the day this
-- ships, and `eq` would return nothing at all while looking entirely normal.
--
-- Three indexes and all of them tenant-first, which is the only access pattern
-- there is: `(location_id)` for the settings list, `(location_id, purpose)` for
-- the voucher's own read, and `(location_id, branch_id)` for the campus scope.
--
-- No unique index on the account number. Two rows carrying one number is a
-- school that has listed its main account twice for two purposes, or has
-- retyped it while correcting the title, and refusing the second insert at the
-- database would surface as "could not save" on a screen with no way to find
-- the first. The list is a dozen rows long and a person can see the duplicate.

-- ─────────────────────────────────────────────────────────────────────────
-- Block 1 — concession_schemes.scheme_type
-- ─────────────────────────────────────────────────────────────────────────

ALTER TABLE "concession_schemes" ADD COLUMN IF NOT EXISTS "scheme_type" text DEFAULT 'other' NOT NULL;--> statement-breakpoint

DO $$ BEGIN
  ALTER TABLE "concession_schemes" ADD CONSTRAINT "concession_schemes_scheme_type_check"
    CHECK ("scheme_type" IN ('sibling', 'scholarship', 'other'));
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint

-- ─────────────────────────────────────────────────────────────────────────
-- Block 2 — the two fee settings
-- ─────────────────────────────────────────────────────────────────────────

ALTER TABLE "late_fee_rules" ADD COLUMN IF NOT EXISTS "auto_apply_sibling_discount" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "late_fee_rules" ADD COLUMN IF NOT EXISTS "sibling_discount_for_last_child" boolean DEFAULT false NOT NULL;--> statement-breakpoint

-- ─────────────────────────────────────────────────────────────────────────
-- Block 3 — the three school fields the voucher prints
-- ─────────────────────────────────────────────────────────────────────────

ALTER TABLE "schools" ADD COLUMN IF NOT EXISTS "ntn" text;--> statement-breakpoint
ALTER TABLE "schools" ADD COLUMN IF NOT EXISTS "website" text;--> statement-breakpoint
ALTER TABLE "schools" ADD COLUMN IF NOT EXISTS "finance_email" text;--> statement-breakpoint

-- ─────────────────────────────────────────────────────────────────────────
-- Block 4 — bank_accounts
-- ─────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS "bank_accounts" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "location_id" text NOT NULL,
  "branch_id" uuid,
  "account_title" text NOT NULL,
  "bank_name" text NOT NULL,
  "branch_name" text,
  "branch_code" text,
  "account_number" text NOT NULL,
  "iban" text,
  "swift_code" text,
  "bank_address" text,
  "intermediary_bank" text,
  "intermediary_swift" text,
  "currency" text DEFAULT 'PKR' NOT NULL,
  "purpose" text DEFAULT 'student' NOT NULL,
  "instructions" text,
  "is_active" boolean DEFAULT true NOT NULL,
  "sort_order" integer DEFAULT 0 NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "bank_accounts_purpose_check" CHECK ("purpose" IN ('student', 'staff', 'both'))
);--> statement-breakpoint

DO $$ BEGIN
  ALTER TABLE "bank_accounts" ADD CONSTRAINT "bank_accounts_location_id_schools_location_id_fk"
    FOREIGN KEY ("location_id") REFERENCES "public"."schools"("location_id")
    ON DELETE cascade ON UPDATE no action;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint

-- `set null`, not `cascade`. An account whose campus is deleted is still the
-- school's account, and cascading would delete the bank details a voucher
-- printed last month along with the campus record. Same rule as `0035`'s nine.
DO $$ BEGIN
  ALTER TABLE "bank_accounts" ADD CONSTRAINT "bank_accounts_branch_id_branches_id_fk"
    FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id")
    ON DELETE set null ON UPDATE no action;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "bank_accounts_location_id_idx" ON "bank_accounts" USING btree ("location_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "bank_accounts_location_purpose_idx" ON "bank_accounts" USING btree ("location_id", "purpose");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "bank_accounts_location_branch_idx" ON "bank_accounts" USING btree ("location_id", "branch_id");
