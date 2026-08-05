-- Sprint 9 — email authentication.
--
-- Every statement here is idempotent, which is not the drizzle-kit default and
-- is deliberate.
--
-- `drizzle-orm/neon-http/migrator` runs one HTTP request per statement with no
-- enclosing transaction, and it defers every `__drizzle_migrations` insert to
-- after the whole run completes. A failure part-way therefore leaves the
-- statements that already succeeded in place with no bookkeeping row at all —
-- the database ends up half-migrated and the migrator has no record it ever
-- started. The next `drizzle-kit migrate` replays this file from the top and
-- dies on `CREATE TABLE ... already exists`, which needs hand-written SQL to
-- escape.
--
-- Written this way, re-running is always safe: a partially applied 0011 is
-- completed, a fully applied one is a no-op, and either way the bookkeeping row
-- is finally written.

CREATE TABLE IF NOT EXISTS "email_verifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"location_id" text NOT NULL,
	"email" text NOT NULL,
	"token" text NOT NULL,
	"otp" text NOT NULL,
	"type" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	"attempts" integer DEFAULT 0 NOT NULL,
	"send_count" integer DEFAULT 1 NOT NULL,
	"window_started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "email_verifications_type_check" CHECK (type IN ('invitation', 'otp_login', 'forgot_password'))
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "user_passwords" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"location_id" text NOT NULL,
	"firebase_uid" text NOT NULL,
	"email" text NOT NULL,
	"password_hash" text NOT NULL,
	"must_change_password" boolean DEFAULT false NOT NULL,
	"last_password_change" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_passwords_firebase_uid_unique" UNIQUE("firebase_uid")
);
--> statement-breakpoint
-- Already a no-op once the column is nullable, so this needs no guard.
ALTER TABLE "school_users" ALTER COLUMN "phone" DROP NOT NULL;--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "email_verifications" ADD CONSTRAINT "email_verifications_location_id_schools_location_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."schools"("location_id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
	WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "user_passwords" ADD CONSTRAINT "user_passwords_location_id_schools_location_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."schools"("location_id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
	WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "email_verifications_email_idx" ON "email_verifications" USING btree ("email");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "email_verifications_token_idx" ON "email_verifications" USING btree ("token");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "email_verifications_expires_at_idx" ON "email_verifications" USING btree ("expires_at");--> statement-breakpoint
-- Load-bearing rather than an optimisation: `issueEmailVerification` upserts
-- with ON CONFLICT on these three columns, which Postgres rejects with 42P10
-- unless a matching unique index exists.
CREATE UNIQUE INDEX IF NOT EXISTS "email_verifications_location_email_type_idx" ON "email_verifications" USING btree ("location_id","email","type");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "user_passwords_location_id_idx" ON "user_passwords" USING btree ("location_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "user_passwords_email_idx" ON "user_passwords" USING btree ("email");--> statement-breakpoint
-- Same again: `upsertPassword` conflicts on (location_id, email).
CREATE UNIQUE INDEX IF NOT EXISTS "user_passwords_location_id_email_idx" ON "user_passwords" USING btree ("location_id","email");
