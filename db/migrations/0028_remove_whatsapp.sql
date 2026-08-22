-- WhatsApp leaves the platform.
--
-- Email is the only channel this product sends on, and the only one it will
-- send on until the internal chat system lands. This migration removes the
-- three places WhatsApp was still represented in the database.
--
-- ── Why this is a deletion and not another flag set to false ─────────────
-- `lib/channels.ts` existed so a Super Admin could switch the add-on back on
-- without a deploy, and that was the right call while it was a product we
-- sold. It is not one any more. A flag left behind is a flag somebody turns
-- on, against sending code that no longer exists — so the flag goes with the
-- code, and `school_modules` goes back to holding modules and nothing else.
--
-- ── The delivery log keeps its history ───────────────────────────────────
-- `announcement_recipients` rows with channel = 'whatsapp' are *not* deleted.
-- They are the school's record of what it told which parent and when, and a
-- school answering "did you tell us about the closure" in March needs the row
-- from October whatever channel carried it. The CHECK constraint is therefore
-- narrowed only after the existing rows are re-labelled to the channel that
-- actually reached the reader: the notice board, which every announcement went
-- to unconditionally.
--
-- Re-labelling rather than deleting keeps the count honest in one direction
-- and loses nothing in the other: nobody can now ask "how many went over
-- WhatsApp", which is a question about a product that no longer exists.
--
-- The unique index is (announcement_id, school_user_id, channel), so a
-- recipient who has both a 'notice' row and a 'whatsapp' row would collide on
-- the rewrite. Those are deleted first — the 'notice' row is the one that was
-- actually read, and it survives.
--
-- ── school_invitations loses two columns ─────────────────────────────────
-- `whatsapp_sent` and `whatsapp_message_id` recorded a send that can no longer
-- happen. `email_sent` carries the whole answer now.
--
-- Written by hand, for the same reason 0011, 0012 and 0027 were:
-- `drizzle-kit generate` cannot run non-interactively here.

-- ---------------------------------------------------------------------------
-- 1. The channel flag stops being a legal key, and its rows go.
-- ---------------------------------------------------------------------------

DELETE FROM "school_modules" WHERE "module_key" = 'whatsapp';
--> statement-breakpoint
ALTER TABLE "school_modules" DROP CONSTRAINT IF EXISTS "school_modules_module_key_check";
--> statement-breakpoint
ALTER TABLE "school_modules" ADD CONSTRAINT "school_modules_module_key_check" CHECK (module_key IN ('admissions', 'fee_management', 'academics', 'lms', 'hr_payroll', 'accounts', 'event_mgmt', 'transport', 'library', 'hostel'));
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- 2. The delivery log keeps its rows, under the channel that reached people.
-- ---------------------------------------------------------------------------

DELETE FROM "announcement_recipients" AS w
WHERE w."channel" = 'whatsapp'
  AND EXISTS (
    SELECT 1
    FROM "announcement_recipients" AS n
    WHERE n."announcement_id" = w."announcement_id"
      AND n."school_user_id" = w."school_user_id"
      AND n."channel" = 'notice'
  );
--> statement-breakpoint
UPDATE "announcement_recipients" SET "channel" = 'notice' WHERE "channel" = 'whatsapp';
--> statement-breakpoint
ALTER TABLE "announcement_recipients" DROP CONSTRAINT IF EXISTS "announcement_recipients_channel_check";
--> statement-breakpoint
ALTER TABLE "announcement_recipients" ADD CONSTRAINT "announcement_recipients_channel_check" CHECK (channel IN ('notice', 'email'));
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- 3. The invitation stops recording a send that cannot happen.
-- ---------------------------------------------------------------------------

ALTER TABLE "school_invitations" DROP COLUMN IF EXISTS "whatsapp_sent";
--> statement-breakpoint
ALTER TABLE "school_invitations" DROP COLUMN IF EXISTS "whatsapp_message_id";
