-- Sprint 0 — rate limiting, account lockout, and moving email off the request.
--
-- Two tables, and both break the tenancy invariant on purpose.
--
-- auth_attempts has no location_id because it guards the surface *before* a
-- tenant exists. A wrong password at a school's login page is answered
-- identically whether or not the address belongs to that school, so at the
-- moment an attempt is recorded there is no verified tenant to attribute it to.
-- Recording the claimed one would key the counter on attacker-supplied data,
-- which is a counter an attacker can reset. Nothing reads this table on a
-- tenant-scoped path.
--
-- email_outbox has a NULLABLE location_id because the queue also carries
-- platform mail -- the Super Admin's "Send sign-in email" -- which is sent by
-- the operator of the platform and must work while a school is still being set
-- up. Null means "platform". A synthetic tenant value would be a lie in the
-- one column every tenancy filter trusts.
--
-- One table serves both rate limiting and lockout: they are the same question
-- asked with different windows, and the row is an audit record either way,
-- which is what Sprint 23's security audit will want to read.
--
-- Rows in auth_attempts are swept opportunistically on write (roughly one call
-- in fifty deletes anything older than 24 hours). Hostinger has no platform
-- cron, so there is nowhere else to put the sweep.
--
-- Written by hand for the same reason 0011-0014 were: drizzle-kit generate
-- cannot run non-interactively here.

CREATE TABLE IF NOT EXISTS "auth_attempts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"scope" text NOT NULL,
	"identifier" text NOT NULL,
	"ip_hash" text NOT NULL,
	"succeeded" boolean NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "auth_attempts_scope_check" CHECK (scope IN ('login', 'otp_request', 'password_reset', 'setup', 'super_admin_login'))
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "email_outbox" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"location_id" text,
	"to_address" text NOT NULL,
	"subject" text NOT NULL,
	"body_text" text NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"last_error" text,
	"scheduled_at" timestamp with time zone DEFAULT now() NOT NULL,
	"sent_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "email_outbox_status_check" CHECK (status IN ('queued', 'sending', 'sent', 'failed'))
);
--> statement-breakpoint
-- Deliberately no foreign key to schools(location_id): the column is nullable
-- for platform mail, and a queued message must survive its school being closed
-- rather than vanish mid-flight. The queue is a log of what was sent, not a
-- child of the tenant.
CREATE INDEX IF NOT EXISTS "auth_attempts_scope_identifier_idx" ON "auth_attempts" USING btree ("scope","identifier","created_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "auth_attempts_scope_ip_idx" ON "auth_attempts" USING btree ("scope","ip_hash","created_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "email_outbox_status_scheduled_idx" ON "email_outbox" USING btree ("status","scheduled_at");
