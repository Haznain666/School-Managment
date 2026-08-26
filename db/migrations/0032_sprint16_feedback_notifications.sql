-- Sprint 16 — school feedback, and the in-app bell that carries it.
--
-- Four tables, no column changes to anything that exists, no data rewritten.
-- Expand-only, so it is safe to apply while the *old* build is still serving:
-- nothing running today knows these tables exist.
--
-- It has to go in BEFORE the merge rather than after, for the reason §5aw
-- records at length. `app/(school-admin)/layout.tsx` and
-- `components/super-admin/SuperAdminShell.tsx` both grow an unread-notification
-- count, and a layout runs on every page of its portal — so deploying this
-- sprint against the old schema would 500 both portals entirely, not just the
-- feedback screens. The read is wrapped, but a missing table inside a wrapped
-- read is still a wasted round trip on every request and an error log per page.
--
-- ── Why `feedback_attachments` has no "at most five" constraint ───────────
-- Postgres cannot express it without a trigger or a counter column, and both
-- would be a second source of truth for a rule enforced at the one place all
-- five rows are created: `POST /api/school/feedback`. `lib/feedback.ts` owns
-- the number and the route and the browser form both read it from there.
--
-- ── Why the submitter's name and address are copied onto the ticket ───────
-- The ticket outlives the person. `submitted_by` is ON DELETE SET NULL, so a
-- bug report read six months later still says who wrote it even after they
-- have left the school and their `school_users` row has gone. A join would
-- answer "unknown" for exactly the tickets most worth chasing up.

CREATE TABLE IF NOT EXISTS "feedback_tickets" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "location_id" text NOT NULL,
  "submitted_by" uuid,
  "submitted_by_name" text NOT NULL,
  "submitted_by_email" text NOT NULL,
  "title" text NOT NULL,
  "body" text NOT NULL,
  "nature" text DEFAULT 'suggestion' NOT NULL,
  "status" text DEFAULT 'unread' NOT NULL,
  "read_at" timestamp with time zone,
  "status_changed_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "feedback_tickets_nature_check" CHECK ("nature" IN ('bug', 'suggestion')),
  CONSTRAINT "feedback_tickets_status_check" CHECK ("status" IN ('unread', 'read', 'in_progress', 'future', 'resolved'))
);--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "feedback_attachments" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "ticket_id" uuid NOT NULL,
  "storage_path" text NOT NULL,
  "file_name" text NOT NULL,
  "content_type" text NOT NULL,
  "size_bytes" integer NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "feedback_replies" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "ticket_id" uuid NOT NULL,
  "author_kind" text NOT NULL,
  "author_school_user_id" uuid,
  "author_name" text NOT NULL,
  "body" text NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "feedback_replies_author_kind_check" CHECK ("author_kind" IN ('super_admin', 'school'))
);--> statement-breakpoint

-- The bell. General on purpose: it names a recipient, a title and a link, and
-- knows nothing about feedback. See db/schema/notifications.ts for why this is
-- a table rather than a count derived from `feedback_tickets`.
CREATE TABLE IF NOT EXISTS "notifications" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "audience" text NOT NULL,
  "location_id" text,
  "school_user_id" uuid,
  "kind" text NOT NULL,
  "title" text NOT NULL,
  "body" text NOT NULL,
  "href" text NOT NULL,
  "read_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "notifications_audience_check" CHECK ("audience" IN ('super_admin', 'school_user')),
  -- A school notification with nobody to deliver it to is not a notification.
  -- The inverse is deliberately unconstrained: a platform row legitimately
  -- carries the location it is *about* and never a user id.
  CONSTRAINT "notifications_recipient_check" CHECK ("audience" <> 'school_user' OR "school_user_id" IS NOT NULL)
);--> statement-breakpoint

DO $$ BEGIN
  ALTER TABLE "feedback_tickets" ADD CONSTRAINT "feedback_tickets_location_id_schools_location_id_fk"
    FOREIGN KEY ("location_id") REFERENCES "public"."schools"("location_id")
    ON DELETE cascade ON UPDATE no action;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint

DO $$ BEGIN
  ALTER TABLE "feedback_tickets" ADD CONSTRAINT "feedback_tickets_submitted_by_school_users_id_fk"
    FOREIGN KEY ("submitted_by") REFERENCES "public"."school_users"("id")
    ON DELETE set null ON UPDATE no action;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint

DO $$ BEGIN
  ALTER TABLE "feedback_attachments" ADD CONSTRAINT "feedback_attachments_ticket_id_feedback_tickets_id_fk"
    FOREIGN KEY ("ticket_id") REFERENCES "public"."feedback_tickets"("id")
    ON DELETE cascade ON UPDATE no action;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint

DO $$ BEGIN
  ALTER TABLE "feedback_replies" ADD CONSTRAINT "feedback_replies_ticket_id_feedback_tickets_id_fk"
    FOREIGN KEY ("ticket_id") REFERENCES "public"."feedback_tickets"("id")
    ON DELETE cascade ON UPDATE no action;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint

DO $$ BEGIN
  ALTER TABLE "feedback_replies" ADD CONSTRAINT "feedback_replies_author_school_user_id_school_users_id_fk"
    FOREIGN KEY ("author_school_user_id") REFERENCES "public"."school_users"("id")
    ON DELETE set null ON UPDATE no action;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint

DO $$ BEGIN
  ALTER TABLE "notifications" ADD CONSTRAINT "notifications_location_id_schools_location_id_fk"
    FOREIGN KEY ("location_id") REFERENCES "public"."schools"("location_id")
    ON DELETE cascade ON UPDATE no action;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint

DO $$ BEGIN
  ALTER TABLE "notifications" ADD CONSTRAINT "notifications_school_user_id_school_users_id_fk"
    FOREIGN KEY ("school_user_id") REFERENCES "public"."school_users"("id")
    ON DELETE cascade ON UPDATE no action;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "feedback_tickets_location_idx" ON "feedback_tickets" USING btree ("location_id","created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "feedback_tickets_status_idx" ON "feedback_tickets" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "feedback_tickets_nature_idx" ON "feedback_tickets" USING btree ("nature");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "feedback_attachments_ticket_idx" ON "feedback_attachments" USING btree ("ticket_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "feedback_replies_ticket_idx" ON "feedback_replies" USING btree ("ticket_id","created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "notifications_audience_idx" ON "notifications" USING btree ("audience","created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "notifications_school_user_idx" ON "notifications" USING btree ("school_user_id","created_at");
