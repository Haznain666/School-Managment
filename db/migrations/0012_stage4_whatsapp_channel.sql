-- Stage 4 step 8 — WhatsApp becomes a per-school paid add-on.
--
-- `school_modules` gains one more legal key. It is a *channel*, not a module —
-- how a message leaves the building rather than a slice of the product — and
-- it renders in its own section of the Super Admin school page rather than
-- beside "Hostel Management". It shares this table because the storage
-- question has the same answer for both: one row per school per flag, absent
-- means off, with an audit breadcrumb. See `lib/platform-modules.ts`.
--
-- No rows are inserted. Absent means off, so every existing school starts with
-- WhatsApp disabled and email carrying everything — which is the intended
-- default and the reason nothing here backfills. Switch a school on from the
-- Super Admin panel once it has paid.
--
-- Written by hand for the same reason 0011 was: `drizzle-kit generate` cannot
-- run non-interactively here. The snapshot was derived from 0011 by applying
-- exactly this change.

ALTER TABLE "school_modules" DROP CONSTRAINT IF EXISTS "school_modules_module_key_check";
--> statement-breakpoint
ALTER TABLE "school_modules" ADD CONSTRAINT "school_modules_module_key_check" CHECK (module_key IN ('admissions', 'fee_management', 'academics', 'lms', 'hr_payroll', 'accounts', 'event_mgmt', 'transport', 'library', 'hostel', 'whatsapp'));
