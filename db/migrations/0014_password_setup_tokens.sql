-- First-time sign-in stops needing a code.
--
-- Choosing a first password used to mean: open the portal, type your address,
-- ask for a six-digit code, read a second email, transcribe the code, then
-- choose a password. Two emails and a transcription for someone who had
-- already proved they hold the mailbox by opening the first one.
--
-- The link in that first email is now the proof, and this table is what backs
-- it. The code flow is not gone -- it is what Forgot Password uses, where the
-- person already has an account worth protecting and no link has been sent.
--
-- The link is a credential sitting in an inbox, so it is deliberately narrow:
-- 32 random bytes, single use, 48 hours, bound to one member at one school,
-- and only ever issued to a member who has never signed in. Rows are kept
-- after use rather than deleted, like emergency_login_tokens, so issuance and
-- redemption stay auditable.
--
-- Written by hand for the same reason 0011-0013 were: drizzle-kit generate
-- cannot run non-interactively here.

CREATE TABLE IF NOT EXISTS "password_setup_tokens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"location_id" text NOT NULL,
	"school_user_id" uuid NOT NULL,
	"token" text NOT NULL,
	"created_by" text DEFAULT 'super_admin' NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "password_setup_tokens_token_unique" UNIQUE("token")
);
--> statement-breakpoint
ALTER TABLE "password_setup_tokens" ADD CONSTRAINT "password_setup_tokens_location_id_schools_location_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."schools"("location_id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "password_setup_tokens" ADD CONSTRAINT "password_setup_tokens_school_user_id_school_users_id_fk" FOREIGN KEY ("school_user_id") REFERENCES "public"."school_users"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "password_setup_tokens_token_idx" ON "password_setup_tokens" USING btree ("token");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "password_setup_tokens_school_user_id_idx" ON "password_setup_tokens" USING btree ("school_user_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "password_setup_tokens_expires_at_idx" ON "password_setup_tokens" USING btree ("expires_at");
