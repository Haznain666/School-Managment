-- Sprint 17 — the credit a discount leaves behind, and where a voucher carries it.
--
-- One new table and one new column with a default. Expand-only: no existing
-- column is altered, no row is rewritten, and nothing running today reads
-- either — so this is safe to apply while the *old* build is still serving.
--
-- ── Why a credit ledger exists at all ────────────────────────────────────
-- The product owner's rule, verbatim: *as long as the fee has not been paid,
-- any discount applied will be effective. If the discount has been applied
-- afterwards, then it will appear as adjustment in the next voucher.*
--
-- The first half is `repriceOpenChallans`, which rewrites an unpaid challan in
-- place. The second half has nowhere to go without this table: a paid challan
-- is history and may not be edited, and a discount granted after it was
-- settled is money the school now owes the parent. Before Sprint 17 there was
-- no row anywhere that could hold that fact, so the discount was simply lost —
-- the school believed it had granted it and the parent never saw it.
--
-- The same table is the floor under a challan. A 100% sibling discount on a
-- 5,000 admission fee where 6,000 has already been demanded must not produce a
-- voucher for minus 1,000; the voucher is floored and the surplus lands here.
--
-- ── This is NOT the double-entry ledger ──────────────────────────────────
-- `ledger_transactions` / `ledger_entries` are the school's books and balance.
-- This table does not, and must not be made to. It is a fee-module artefact in
-- exactly the sense that an outstanding balance is one (see CLAUDE.md, "Income
-- is recognised on receipt, not on billing"): a credit is not income, not an
-- expense and not cash — it is a promise about what the *next* challan will
-- demand, and it reaches the books only when that challan is paid and the
-- payment posts, for the reduced amount. `npm run check-accounting` must never
-- learn about this table.
--
-- ── Append-only, in the same sense the ledger is ─────────────────────────
-- Nothing UPDATEs or DELETEs a row here. A grant is a positive row, a
-- consumption is a negative one, a correction is another row. There is
-- deliberately no `updated_at` and no balance column: a student's balance is
-- `SUM(amount)`, for the same reason `ledger_entries` has none — a stored
-- balance is a second source of truth and the one that goes wrong silently.
-- The CHECK on `amount <> 0` is there because a zero row records nothing and
-- would only ever be the result of a bug.

CREATE TABLE IF NOT EXISTS "student_credits" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "location_id" text NOT NULL,
  "student_profile_id" uuid NOT NULL,
  "amount" numeric(12, 2) NOT NULL,
  "reason" text NOT NULL,
  "source_challan_id" uuid,
  "applied_challan_id" uuid,
  "notes" text,
  "created_by_uid" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "student_credits_reason_check" CHECK ("reason" IN ('discount_overflow', 'applied_to_challan', 'manual')),
  CONSTRAINT "student_credits_amount_check" CHECK ("amount" <> 0)
);--> statement-breakpoint

DO $$ BEGIN
  ALTER TABLE "student_credits" ADD CONSTRAINT "student_credits_location_id_schools_location_id_fk"
    FOREIGN KEY ("location_id") REFERENCES "public"."schools"("location_id")
    ON DELETE cascade ON UPDATE no action;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint

DO $$ BEGIN
  ALTER TABLE "student_credits" ADD CONSTRAINT "student_credits_student_profile_id_student_profiles_id_fk"
    FOREIGN KEY ("student_profile_id") REFERENCES "public"."student_profiles"("id")
    ON DELETE cascade ON UPDATE no action;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint

-- Both challan references are ON DELETE SET NULL rather than CASCADE. A credit
-- outlives the challan that created it — that is the whole point of it — and a
-- cascade here would delete the parent's money along with a cancelled voucher.
DO $$ BEGIN
  ALTER TABLE "student_credits" ADD CONSTRAINT "student_credits_source_challan_id_fee_challans_id_fk"
    FOREIGN KEY ("source_challan_id") REFERENCES "public"."fee_challans"("id")
    ON DELETE set null ON UPDATE no action;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint

DO $$ BEGIN
  ALTER TABLE "student_credits" ADD CONSTRAINT "student_credits_applied_challan_id_fee_challans_id_fk"
    FOREIGN KEY ("applied_challan_id") REFERENCES "public"."fee_challans"("id")
    ON DELETE set null ON UPDATE no action;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "student_credits_location_id_idx" ON "student_credits" USING btree ("location_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "student_credits_student_profile_id_idx" ON "student_credits" USING btree ("student_profile_id");--> statement-breakpoint

-- What a challan actually took off for credit carried forward, frozen at
-- generation exactly as `subtotal` and `concession_amount` are. It is on the
-- header and not in `fee_challan_items` because every line there carries a
-- `fee_type_id` NOT NULL, and an adjustment has no fee head — it is not a
-- charge the school levied, it is money it already owed.
--
-- `total_amount` remains the authority on what the parent owes:
--   total_amount = subtotal − concession_amount − credit_applied + late_fee_amount
-- The DEFAULT is what makes this expand-only: every challan raised before this
-- deploy took no credit off, and '0' is the true value for all of them.
ALTER TABLE "fee_challans" ADD COLUMN IF NOT EXISTS "credit_applied" numeric(12, 2) DEFAULT '0' NOT NULL;
