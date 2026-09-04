-- Sprint 25 — chat, part 2: broadcast, real-time, push, sound, attachments.
--
-- Three new tables, five new columns, and one line that switches the whole
-- real-time design on. Nothing here rewrites an existing row: every table is
-- new, and all five columns are either nullable or defaulted to the value every
-- existing row would have chosen anyway.
--
-- ── Atomic without a BEGIN ───────────────────────────────────────────────
-- drizzle-orm's migrator runs each migration file inside one transaction, so
-- all eight steps commit together or not at all. An explicit `BEGIN` here would
-- be a nested transaction the migrator did not ask for.
--
-- ── The one line that matters most ───────────────────────────────────────
-- Step 8 adds `chat_signals` to the `supabase_realtime` publication. Until it
-- runs, the browser's websocket subscribes successfully and **receives nothing,
-- forever, silently** — which is the worst shape a failure can take, because
-- the client reports itself connected and the poll fallback quietly does all
-- the work. `scripts/verify-0041.mjs` asserts the table is in the publication
-- for exactly that reason.
--
-- The publication already exists on this project and is currently empty.
--
-- `SPRINT-25-DDL-NOTES.md` says how, in what order, and what breaks if the code
-- goes first.

-- ── Step 1: the notification chime ───────────────────────────────────────
--
-- Default **on**. A sound nobody discovers is a feature nobody has, and this is
-- the thing that turns a live message into a notification rather than something
-- you notice ten minutes later. One tap silences it, on the chat screen of
-- every portal.
--
-- There is deliberately no column for *which* sound. A picker means audio files
-- to ship, cache and serve, and a decision nobody wants to make twice; there is
-- one chime, generated in the browser with WebAudio, and nothing is downloaded
-- to play it.
ALTER TABLE "chat_settings"
  ADD COLUMN IF NOT EXISTS "sound_enabled" boolean NOT NULL DEFAULT true;--> statement-breakpoint

-- ── Step 2: chat_broadcasts ──────────────────────────────────────────────
--
-- One composition, N conversations. A teacher with a class of thirty writes
-- once — and that is *all* they asked for. It is not a request for a
-- thirty-person room, and this schema could not hold one anyway:
-- `chat_participants_one_student_idx` makes a second pupil in a conversation a
-- `23505`, which is the control that makes pupil-to-pupil messaging impossible
-- rather than merely disallowed.
--
-- So the send fans out into ordinary `direct` threads, each private between the
-- sender and one recipient. No recipient ever learns who else received it,
-- because there is no query that would tell them — they are not participants in
-- each other's conversations.
--
-- This table exists so that a sender sees **one** row in a sent list rather
-- than thirty, and so a fan-out that half-succeeded can be diagnosed. `body` is
-- duplicated from the messages deliberately: the copy here is what the sender
-- wrote and survives every one of those conversations being archived or
-- redacted.
CREATE TABLE IF NOT EXISTS "chat_broadcasts" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "location_id" text NOT NULL REFERENCES "schools"("location_id") ON DELETE cascade,
  "branch_id" uuid REFERENCES "branches"("id") ON DELETE set null,
  "sent_by" uuid REFERENCES "school_users"("id") ON DELETE set null,
  "sent_by_name" text NOT NULL,
  "subject" text,
  "body" text NOT NULL,
  "scope_label" text NOT NULL,
  "recipient_count" integer NOT NULL DEFAULT 0,
  "skipped_count" integer NOT NULL DEFAULT 0,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "chat_broadcasts_counts_check" CHECK (
    "recipient_count" >= 0 AND "skipped_count" >= 0 AND "recipient_count" <= 200
  ),
  CONSTRAINT "chat_broadcasts_scope_label_check"
    CHECK (length("scope_label") BETWEEN 1 AND 120),
  CONSTRAINT "chat_broadcasts_body_check" CHECK (length("body") BETWEEN 1 AND 2000)
);--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "chat_broadcasts_location_id_idx"
  ON "chat_broadcasts" ("location_id");--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "chat_broadcasts_sender_idx"
  ON "chat_broadcasts" ("location_id", "sent_by", "created_at");--> statement-breakpoint

-- ── Step 3: the link back from a conversation to its broadcast ───────────
--
-- `set null` rather than cascade, and the distinction is the point: deleting
-- the record of a *send* must not delete the thirty conversations it started.
-- Those are real correspondence with thirty people and they outlive the act of
-- sending them.
ALTER TABLE "chat_conversations"
  ADD COLUMN IF NOT EXISTS "broadcast_id" uuid
  REFERENCES "chat_broadcasts"("id") ON DELETE set null;--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "chat_conversations_broadcast_idx"
  ON "chat_conversations" ("broadcast_id");--> statement-breakpoint

-- ── Step 4: chat_attachments — staff only, two megabytes ─────────────────
--
-- Sprint 24 shipped text-only because images from pupils were the first abuse
-- the brief named. That judgement has not changed; what changed is *who may
-- upload*. Every uploader here is a member of staff — a known adult with an
-- employment record, accountable to the school, whose account an administrator
-- can switch off.
--
-- **That identity is the control, and it replaces a scanner.** It is enforced
-- in the route rather than by hiding a button: a pupil or parent posting to the
-- upload endpoint is refused. Pupil and parent attachments stay out of scope,
-- because doing them safely means a quarantine bucket, an NSFW classifier, EXIF
-- stripping and a decision about what a positive hit obliges a school to do.
--
-- `storage_path` and no `download_url`, which is `feedback_attachments`' shape
-- rather than `student_documents`'. That difference is load-bearing: these are
-- served through a proxy that sets `Content-Disposition: attachment` and
-- `X-Content-Type-Options: nosniff`, because `inline` on a PDF would let an
-- attachment execute on the portal's own origin — and because a file somebody
-- sent a fourteen-year-old does not belong behind a public CDN URL.
--
-- `content_type` holds what the *bytes* said, sniffed, not what the browser
-- claimed. Same posture as `student_documents`.
CREATE TABLE IF NOT EXISTS "chat_attachments" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "location_id" text NOT NULL REFERENCES "schools"("location_id") ON DELETE cascade,
  "message_id" uuid NOT NULL REFERENCES "chat_messages"("id") ON DELETE cascade,
  "storage_path" text NOT NULL,
  "file_name" text NOT NULL,
  "content_type" text NOT NULL,
  "size_bytes" integer NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "chat_attachments_content_type_check"
    CHECK (content_type IN ('image/png', 'image/jpeg', 'application/pdf')),
  CONSTRAINT "chat_attachments_size_check"
    CHECK ("size_bytes" > 0 AND "size_bytes" <= 2097152),
  CONSTRAINT "chat_attachments_file_name_check"
    CHECK (length("file_name") BETWEEN 1 AND 200)
);--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "chat_attachments_location_id_idx"
  ON "chat_attachments" ("location_id");--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "chat_attachments_message_idx"
  ON "chat_attachments" ("message_id");--> statement-breakpoint

-- ── Step 5: push_subscriptions ───────────────────────────────────────────
--
-- The thing chat has been waiting for. `ROADMAP.md`: chat replaces a channel
-- parents *read* with one they must remember to open, and a fee reminder
-- sitting unread in an inbox nobody opens is worse than the notice board it
-- replaced. Sprint 24's hourly digest email was the hedge; this is the answer.
--
-- The unique index is on `endpoint` **alone**, not scoped to the tenant, and
-- that is the one place in this schema a unique key is not tenant-scoped. It is
-- correct: the endpoint is the push service's identity for one browser on one
-- device, and a browser is a browser. A parent with children at two schools on
-- this platform re-subscribes and the row moves to whichever they are signed
-- into — which is what should happen, rather than two rows racing to notify one
-- browser about two different inboxes.
CREATE TABLE IF NOT EXISTS "push_subscriptions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "location_id" text NOT NULL REFERENCES "schools"("location_id") ON DELETE cascade,
  "school_user_id" uuid NOT NULL REFERENCES "school_users"("id") ON DELETE cascade,
  "endpoint" text NOT NULL,
  "p256dh" text NOT NULL,
  "auth" text NOT NULL,
  "user_agent" text,
  "failure_count" integer NOT NULL DEFAULT 0,
  "last_sent_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "push_subscriptions_failure_count_check"
    CHECK ("failure_count" >= 0 AND "failure_count" <= 100)
);--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "push_subscriptions_location_id_idx"
  ON "push_subscriptions" ("location_id");--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "push_subscriptions_user_idx"
  ON "push_subscriptions" ("school_user_id");--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS "push_subscriptions_endpoint_idx"
  ON "push_subscriptions" ("endpoint");--> statement-breakpoint

-- ── Step 6: the push preference ──────────────────────────────────────────
--
-- Separate from `email_chat` on purpose. A parent who wants their phone to buzz
-- the moment a teacher writes does not necessarily also want an email an hour
-- about the same conversation, and one flag governing both makes that an
-- impossible preference to express. Default true, matching every other category
-- beside it.
ALTER TABLE "notification_preferences"
  ADD COLUMN IF NOT EXISTS "push_chat" boolean NOT NULL DEFAULT true;--> statement-breakpoint

-- ── Step 7: why an account was switched off ──────────────────────────────
--
-- `is_active` already recorded *that* portal access is off. These record *why*,
-- and they are worth two columns because of the support call: "this parent
-- cannot sign in" is answered by "their only child left on 4 September and the
-- clerk chose to disable", or it is answered by guessing.
--
-- Written by the student-removal path, which puts the choice to the clerk in
-- three explicit options. Null on an account deactivated by hand from the users
-- screen, which already has a person standing behind it.
ALTER TABLE "school_users"
  ADD COLUMN IF NOT EXISTS "deactivated_at" timestamp with time zone;--> statement-breakpoint

ALTER TABLE "school_users"
  ADD COLUMN IF NOT EXISTS "deactivated_reason" text;--> statement-breakpoint

-- ── Step 8: switch real-time on ──────────────────────────────────────────
--
-- One line, and the whole real-time design depends on it.
--
-- Supabase Realtime streams Postgres changes only for tables in the
-- `supabase_realtime` publication. Until `chat_signals` is in it, a browser
-- subscribes **successfully** and then receives nothing, forever — the client
-- reports itself connected, no error is raised anywhere, and the poll fallback
-- quietly does all the work while appearing not to be needed. That is the worst
-- shape a failure can take, and it is why `verify-0041.mjs` asserts membership
-- of the publication rather than trusting this statement ran.
--
-- `chat_signals` already carries row-level security and a SELECT policy keyed
-- on `auth.uid()`, so a subscriber receives only their own rows and the payload
-- was never readable in the first place — it is a conversation id and a message
-- id. Adding it here does not widen what anyone can see.
--
-- `DO` block rather than a bare `ALTER PUBLICATION`, because that statement has
-- no `IF NOT EXISTS` and re-running the migration would otherwise fail on
-- "relation is already member of publication".
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
     WHERE pubname = 'supabase_realtime'
       AND schemaname = 'public'
       AND tablename = 'chat_signals'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.chat_signals;
  END IF;
END
$$;
