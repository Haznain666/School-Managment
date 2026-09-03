-- Sprint 24 — internal chat, part 1.
--
-- Eight new tables, two CHECK rewrites, one row-level-security policy, and two
-- new columns on tables that already exist. Nothing here rewrites an existing row and
-- nothing here can fail on data: every table is new, both CHECK rewrites only
-- widen, and the two added columns are a nullable timestamp and a boolean
-- defaulted to the value every existing row would have chosen.
--
-- This is the module that replaces WhatsApp. `ROADMAP.md` §5 decided that on
-- 2026-08-07, `0028` removed the WhatsApp flag on 2026-08-22, and
-- `lib/platform-modules.ts` has said ever since that anything which comes back
-- is a module or it is nothing. Step 9 is that sentence being honoured.
--
-- ── Atomic without a BEGIN ───────────────────────────────────────────────
-- drizzle-orm's migrator runs each migration file inside one transaction, so
-- all twelve steps commit together or not at all. An explicit `BEGIN` here
-- would be a nested transaction the migrator did not ask for.
--
-- ── The two rewrites that break at runtime rather than here ──────────────
-- Steps 9 and 10 widen CHECK constraints that are generated from TypeScript
-- lists. A key added to `PERMISSIONS` or to `PLATFORM_MODULES` without the
-- matching DDL does not fail the build, does not fail this file, and fails at
-- the first toggle a school touches — which is the trap STATE.md §5o records
-- and the reason both rewrites are in the same migration as the code that
-- needs them.
--
-- ── The two indexes that are the safeguarding design ─────────────────────
-- Step 3 creates two partial unique indexes on `chat_participants`. They are
-- what make student-to-student and parent-to-parent messaging impossible
-- rather than merely disallowed, and the docblock on
-- `db/schema/chat-participants.ts` explains at length why that distinction is
-- the whole point of the module. If any part of this file has to be understood
-- before it is applied, it is those eleven lines.
--
-- `SPRINT-24-DDL-NOTES.md` at the repo root states how to verify this against
-- the catalogue rather than against the exit code, how to undo it, and — the
-- part that matters for the deploy order — exactly what breaks if the code
-- ships ahead of it. The short version: everything. There is no chat surface
-- that degrades gracefully without these tables.

-- ── Step 1: chat_school_settings ─────────────────────────────────────────
--
-- One row per school, holding the dials a school turns rather than the ones
-- compiled in. Separate from `schools` because that row is read on **every**
-- request — middleware resolves the tenant from it and `membershipFor` joins
-- it — and nine chat columns riding the hottest read in the product to answer
-- a question only chat asks is a cost paid on every page of every portal.
--
-- An absent row means the defaults, exactly as `notification_preferences`
-- behaves, so provisioning a school seeds nothing.
--
-- `student_login_min_grade_sort_order` is the exception and is nullable with
-- **null meaning no student accounts at all**. A school that has not answered
-- the question has not agreed to issue credentials to minors, and step 11's
-- column would otherwise be filled on their behalf the moment chat was
-- switched on.
--
-- The quiet-hours columns are integer minutes from midnight rather than
-- `time`, because the comparison is deliberately timezone-free: a school in
-- Lahore means eight in the evening on the wall, and an integer cannot be
-- accidentally compared against an instant.
CREATE TABLE IF NOT EXISTS "chat_school_settings" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "location_id" text NOT NULL REFERENCES "schools"("location_id") ON DELETE cascade,
  "student_login_min_grade_sort_order" integer,
  "reply_window_minutes" integer NOT NULL DEFAULT 60,
  "max_unanswered_from_student" integer NOT NULL DEFAULT 3,
  "max_open_threads_per_student" integer NOT NULL DEFAULT 3,
  "student_contact_from" integer NOT NULL DEFAULT 420,
  "student_contact_to" integer NOT NULL DEFAULT 1200,
  "allow_contact_window_override" boolean NOT NULL DEFAULT false,
  "safeguarding_lead_email" text,
  "retention_months" integer NOT NULL DEFAULT 84,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "chat_school_settings_windows_check" CHECK (
    "student_contact_from" BETWEEN 0 AND 1439
    AND "student_contact_to" BETWEEN 0 AND 1439
    AND "student_contact_from" < "student_contact_to"
  ),
  CONSTRAINT "chat_school_settings_limits_check" CHECK (
    "reply_window_minutes" BETWEEN 5 AND 10080
    AND "max_unanswered_from_student" BETWEEN 1 AND 50
    AND "max_open_threads_per_student" BETWEEN 1 AND 50
    AND "retention_months" BETWEEN 1 AND 240
  )
);--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS "chat_school_settings_location_id_idx"
  ON "chat_school_settings" ("location_id");--> statement-breakpoint

-- ── Step 2: chat_settings ────────────────────────────────────────────────
--
-- One person's own preferences, and there are only two of them.
--
-- `students_may_initiate` is per teacher and defaults false, which is
-- `ROADMAP.md` §5's wording kept intact: one teacher opting in must not opt in
-- the rest. It is a *necessary* condition and never a sufficient one — a pupil
-- may open a thread only when this is true and a live `chat_grants` allow
-- covers them. The teacher decides whether she is reachable at all; the school
-- decides when.
--
-- The quiet hours here defer a *notification*. They are the opposite of
-- `chat_school_settings.student_contact_*`, which refuses the send. The
-- difference is who is being protected: an adult from being disturbed, or a
-- child from being contacted at eleven at night.
CREATE TABLE IF NOT EXISTS "chat_settings" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "location_id" text NOT NULL REFERENCES "schools"("location_id") ON DELETE cascade,
  "school_user_id" uuid NOT NULL REFERENCES "school_users"("id") ON DELETE cascade,
  "students_may_initiate" boolean NOT NULL DEFAULT false,
  "quiet_hours_from" integer,
  "quiet_hours_to" integer,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "chat_settings_quiet_hours_check" CHECK (
    ("quiet_hours_from" IS NULL) = ("quiet_hours_to" IS NULL)
    AND (
      "quiet_hours_from" IS NULL
      OR ("quiet_hours_from" BETWEEN 0 AND 1439 AND "quiet_hours_to" BETWEEN 0 AND 1439)
    )
  )
);--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "chat_settings_location_id_idx"
  ON "chat_settings" ("location_id");--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS "chat_settings_location_user_idx"
  ON "chat_settings" ("location_id", "school_user_id");--> statement-breakpoint

-- ── Step 3: chat_conversations ───────────────────────────────────────────
--
-- A thread, and the institutional reason it exists.
--
-- Two kinds only. `group` and `announcement` belong to Sprint 25 and are
-- deliberately absent from the CHECK: `ROADMAP.md` settled that an
-- announcement channel is one-way, because a class notice to 400 parents must
-- not be a group chat 400 people can reply into. A kind that exists before the
-- code which constrains it is an invitation to create one of those by hand.
--
-- `role_inbox` is a thread addressed to a desk rather than to a named clerk,
-- so it survives that clerk leaving. `claimed_by` records who picked it up and
-- is written by a conditional UPDATE … RETURNING — seven Node processes in
-- production, and three clerks with the same inbox open, are the same race.
--
-- `student_profile_id` is `set null` and not cascade, and that is the load
-- bearing choice in this step: deleting a pupil's profile must not take the
-- record of what was said about them with it. It is also what seats the class
-- teacher and the principal as observers, what shows a parent their child's
-- threads, and what the withdrawal freeze finds. Without it, "which
-- conversations concern this pupil" is a question the schema cannot answer.
CREATE TABLE IF NOT EXISTS "chat_conversations" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "location_id" text NOT NULL REFERENCES "schools"("location_id") ON DELETE cascade,
  "branch_id" uuid REFERENCES "branches"("id") ON DELETE set null,
  "kind" text NOT NULL,
  "subject" text,
  "student_profile_id" uuid REFERENCES "student_profiles"("id") ON DELETE set null,
  "role_inbox" text,
  "claimed_by" uuid REFERENCES "school_users"("id") ON DELETE set null,
  "claimed_at" timestamp with time zone,
  "status" text NOT NULL DEFAULT 'open',
  "frozen_at" timestamp with time zone,
  "frozen_reason" text,
  "created_by" uuid REFERENCES "school_users"("id") ON DELETE set null,
  "last_message_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "chat_conversations_kind_check"
    CHECK (kind IN ('direct', 'role_inbox')),
  CONSTRAINT "chat_conversations_status_check"
    CHECK (status IN ('open', 'frozen', 'archived')),
  CONSTRAINT "chat_conversations_role_inbox_check" CHECK (
    (kind = 'role_inbox') = (role_inbox IS NOT NULL)
    AND (role_inbox IS NULL OR role_inbox IN ('office', 'accounts', 'admissions', 'principal'))
  ),
  CONSTRAINT "chat_conversations_frozen_check"
    CHECK (("status" = 'frozen') = ("frozen_at" IS NOT NULL)),
  CONSTRAINT "chat_conversations_subject_check"
    CHECK ("subject" IS NULL OR length("subject") BETWEEN 1 AND 140)
);--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "chat_conversations_location_id_idx"
  ON "chat_conversations" ("location_id");--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "chat_conversations_location_last_message_idx"
  ON "chat_conversations" ("location_id", "last_message_at");--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "chat_conversations_student_profile_idx"
  ON "chat_conversations" ("student_profile_id");--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "chat_conversations_role_inbox_idx"
  ON "chat_conversations" ("location_id", "role_inbox", "claimed_by");--> statement-breakpoint

-- ── Step 4: chat_participants, and the two indexes that matter ───────────
--
-- The brief for this module named four abuses: pupils flooding one another,
-- forming their own groups, passing images around, and passing links to the
-- places they formed those groups. Every one of them needs a pupil to be able
-- to reach another pupil.
--
-- So that is not a permission, a setting, or a rule in a resolver:
--
--     CREATE UNIQUE INDEX chat_participants_one_student_idx
--       ON chat_participants (conversation_id) WHERE is_student;
--
-- At most one pupil in any conversation, decided by Postgres, on one row,
-- under one lock. There is no administrator toggle that lifts it, no
-- super-admin override, and no route back to pupil-to-pupil messaging that
-- does not go through a migration somebody has to write and defend. A resolver
-- can be bypassed by the next route that forgets to call it; this cannot.
--
-- The parent twin is narrower, and the difference is deliberate: it is
-- restricted to seats that can **post**, so both parents may still observe
-- their child's thread. A flat "one parent" index would have made a mother and
-- a father reading the same thread impossible, which is not the rule anybody
-- asked for.
--
-- `is_student` and `is_parent` duplicate `school_users.role`, which this schema
-- otherwise avoids. The duplication is the price of the indexes: a partial
-- index cannot reach through a foreign key, so the alternative to these two
-- columns is no index, and the alternative to the index is a rule in
-- application code.
CREATE TABLE IF NOT EXISTS "chat_participants" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "location_id" text NOT NULL REFERENCES "schools"("location_id") ON DELETE cascade,
  "conversation_id" uuid NOT NULL REFERENCES "chat_conversations"("id") ON DELETE cascade,
  "school_user_id" uuid NOT NULL REFERENCES "school_users"("id") ON DELETE cascade,
  "participant_role" text NOT NULL DEFAULT 'member',
  "can_post" boolean NOT NULL DEFAULT true,
  "is_student" boolean NOT NULL DEFAULT false,
  "is_parent" boolean NOT NULL DEFAULT false,
  "reply_window_expires_at" timestamp with time zone,
  "joined_at" timestamp with time zone DEFAULT now() NOT NULL,
  "last_read_at" timestamp with time zone,
  "muted_until" timestamp with time zone,
  "digested_at" timestamp with time zone,
  "left_at" timestamp with time zone,
  CONSTRAINT "chat_participants_role_check"
    CHECK (participant_role IN ('owner', 'member', 'observer')),
  CONSTRAINT "chat_participants_kind_check"
    CHECK (NOT ("is_student" AND "is_parent")),
  CONSTRAINT "chat_participants_observer_check"
    CHECK ("participant_role" <> 'observer' OR "can_post" = false)
);--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "chat_participants_location_id_idx"
  ON "chat_participants" ("location_id");--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS "chat_participants_conversation_user_idx"
  ON "chat_participants" ("conversation_id", "school_user_id");--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "chat_participants_user_read_idx"
  ON "chat_participants" ("school_user_id", "last_read_at");--> statement-breakpoint

-- The digest sweep claims on this. `digested_at` is on the participant row
-- rather than on `school_users` because it is what the conditional
-- `UPDATE … RETURNING` moves, and a column on `school_users` would put a chat
-- concern on the row every request in the product already reads.
CREATE INDEX IF NOT EXISTS "chat_participants_digested_idx"
  ON "chat_participants" ("digested_at");--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS "chat_participants_one_student_idx"
  ON "chat_participants" ("conversation_id") WHERE "is_student";--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS "chat_participants_one_posting_parent_idx"
  ON "chat_participants" ("conversation_id") WHERE "is_parent" AND "can_post";--> statement-breakpoint

-- ── Step 5: chat_messages, append-only ───────────────────────────────────
--
-- `CLAUDE.md` justifies the append-only ledger like this: a parent disputing a
-- figure in March is asking about a payment made in October, and a ledger that
-- can be edited answers "it says 5,000 now", which is not an answer.
--
-- A parent disputing what a *teacher said* is the identical problem, and it is
-- the one a school is least able to survive getting wrong. So there is no
-- `updated_at` on this table and no destructive delete anywhere in the module.
-- Removing a message writes the three `redacted_*` columns; `body` stays
-- exactly as written, for the investigation and for the export.
--
-- `ROADMAP.md` reached the same conclusion from the other direction on
-- 2026-08-07 — deleted-message-shaped holes in a safeguarding record are a
-- problem — which is why pupils and parents cannot redact at all.
--
-- `sender_name` and `sender_role` are NOT NULL snapshots beside a `set null`
-- foreign key, following `feedback_replies`. An account is deleted when
-- somebody leaves; the record of what they said must survive that and must
-- still say who they were *at the time*. Joining the live row would rename a
-- message retrospectively when a teacher is promoted.
CREATE TABLE IF NOT EXISTS "chat_messages" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "location_id" text NOT NULL REFERENCES "schools"("location_id") ON DELETE cascade,
  "conversation_id" uuid NOT NULL REFERENCES "chat_conversations"("id") ON DELETE cascade,
  "sender_school_user_id" uuid REFERENCES "school_users"("id") ON DELETE set null,
  "sender_name" text NOT NULL,
  "sender_role" text NOT NULL,
  "kind" text NOT NULL DEFAULT 'text',
  "body" text NOT NULL,
  "redacted_at" timestamp with time zone,
  "redacted_by" uuid REFERENCES "school_users"("id") ON DELETE set null,
  "redaction_reason" text,
  "flagged_at" timestamp with time zone,
  "flagged_reason" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "chat_messages_kind_check" CHECK (kind IN ('text', 'system')),
  CONSTRAINT "chat_messages_body_check" CHECK (length("body") BETWEEN 1 AND 2000),
  CONSTRAINT "chat_messages_redaction_check" CHECK (
    ("redacted_at" IS NULL) = ("redacted_by" IS NULL AND "redaction_reason" IS NULL)
  ),
  CONSTRAINT "chat_messages_system_sender_check"
    CHECK ("kind" <> 'system' OR "sender_school_user_id" IS NULL)
);--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "chat_messages_location_id_idx"
  ON "chat_messages" ("location_id");--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "chat_messages_conversation_created_idx"
  ON "chat_messages" ("conversation_id", "created_at");--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "chat_messages_flagged_idx"
  ON "chat_messages" ("location_id", "flagged_at");--> statement-breakpoint

-- ── Step 6: chat_grants ──────────────────────────────────────────────────
--
-- Four controls the brief asked for separately, which turned out to be one
-- table: a per-pupil switch, a teacher opening her whole class for two hours,
-- the same teacher opening five named pupils instead, and a principal banning
-- a parent who has abused the service. Four rows.
--
-- Resolution is most-specific deny, then most-specific allow, then the default,
-- which is reply-only.
--
-- `granted_by_rank` is the column that makes a ban real, and it exists for one
-- scenario. The Principal bans a parent; a teacher then opens the whole class
-- for an activity. The teacher's allow is less specific, so it loses — but
-- reverse the scopes and a section-scoped teacher allow would beat a
-- school-scoped principal deny, and the teacher would have quietly un-banned
-- somebody. Rank is compared first: a grant cannot lift a deny issued by a
-- higher rank at any specificity. Without this column a ban is advisory, and it
-- fails silently.
--
-- `scope_id` is `text` and deliberately not a foreign key. A grant points into
-- five different tables depending on `scope_type`, so one FK is impossible and
-- five nullable columns would make every read a five-way coalesce over a shape
-- where four are always null. A grant pointing at a deleted section resolves to
-- nobody, which is the same answer as an expired one.
--
-- `reason` is required on a deny. A ban a parent cannot be told the grounds for
-- is a ban the school cannot defend, which is the same argument the fee module
-- already makes about override reasons.
CREATE TABLE IF NOT EXISTS "chat_grants" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "location_id" text NOT NULL REFERENCES "schools"("location_id") ON DELETE cascade,
  "branch_id" uuid REFERENCES "branches"("id") ON DELETE cascade,
  "scope_type" text NOT NULL,
  "scope_id" text NOT NULL,
  "capability" text NOT NULL DEFAULT 'initiate',
  "effect" text NOT NULL,
  "starts_at" timestamp with time zone DEFAULT now() NOT NULL,
  "ends_at" timestamp with time zone,
  "granted_by" uuid REFERENCES "school_users"("id") ON DELETE set null,
  "granted_by_role" text NOT NULL,
  "granted_by_rank" integer NOT NULL,
  "reason" text,
  "revoked_at" timestamp with time zone,
  "revoked_by" uuid REFERENCES "school_users"("id") ON DELETE set null,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "chat_grants_scope_type_check"
    CHECK (scope_type IN ('school_user', 'student', 'section', 'grade', 'branch')),
  CONSTRAINT "chat_grants_capability_check" CHECK (capability IN ('initiate')),
  CONSTRAINT "chat_grants_effect_check" CHECK (effect IN ('allow', 'deny')),
  CONSTRAINT "chat_grants_window_check"
    CHECK ("ends_at" IS NULL OR "ends_at" > "starts_at"),
  CONSTRAINT "chat_grants_reason_check" CHECK (
    ("effect" <> 'deny' OR "reason" IS NOT NULL)
    AND ("reason" IS NULL OR length("reason") BETWEEN 1 AND 280)
  ),
  CONSTRAINT "chat_grants_rank_check" CHECK ("granted_by_rank" BETWEEN 0 AND 100)
);--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "chat_grants_location_id_idx"
  ON "chat_grants" ("location_id");--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "chat_grants_scope_idx"
  ON "chat_grants" ("location_id", "scope_type", "scope_id");--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "chat_grants_location_ends_idx"
  ON "chat_grants" ("location_id", "ends_at");--> statement-breakpoint

-- ── Step 7: chat_reports ─────────────────────────────────────────────────
--
-- One queue, two arrival routes. A report is written either by a human pressing
-- Report or by the safeguarding scan matching a message, and the moderator's
-- job is identical for both: read it, decide, record why.
--
-- `severity = 'safeguarding'` does not wait for the queue. It is emailed to the
-- school's designated lead the moment it is written. A pupil writing something
-- about self-harm at two in the morning is the most important message this
-- system will ever carry, and a queue read on Monday is the wrong place for it.
-- `escalated_at` is what the claim predicate reads, so a restarted process
-- cannot send it twice.
--
-- `resolution_note` is required to leave `open`. "Dismissed" with no reason is
-- the outcome that makes a reporter stop reporting.
CREATE TABLE IF NOT EXISTS "chat_reports" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "location_id" text NOT NULL REFERENCES "schools"("location_id") ON DELETE cascade,
  "message_id" uuid NOT NULL REFERENCES "chat_messages"("id") ON DELETE cascade,
  "conversation_id" uuid NOT NULL REFERENCES "chat_conversations"("id") ON DELETE cascade,
  "reported_by" uuid REFERENCES "school_users"("id") ON DELETE set null,
  "source" text NOT NULL DEFAULT 'user',
  "severity" text NOT NULL DEFAULT 'abuse',
  "reason" text NOT NULL,
  "status" text NOT NULL DEFAULT 'open',
  "escalated_at" timestamp with time zone,
  "reviewed_by" uuid REFERENCES "school_users"("id") ON DELETE set null,
  "reviewed_at" timestamp with time zone,
  "resolution_note" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "chat_reports_source_check" CHECK (source IN ('user', 'scan')),
  CONSTRAINT "chat_reports_severity_check"
    CHECK (severity IN ('safeguarding', 'abuse', 'spam')),
  CONSTRAINT "chat_reports_status_check"
    CHECK (status IN ('open', 'reviewed', 'actioned', 'dismissed')),
  CONSTRAINT "chat_reports_reason_check" CHECK (length("reason") BETWEEN 1 AND 500),
  CONSTRAINT "chat_reports_resolution_check" CHECK (
    "status" = 'open'
    OR ("reviewed_at" IS NOT NULL AND "resolution_note" IS NOT NULL)
  ),
  CONSTRAINT "chat_reports_source_reporter_check"
    CHECK (("source" = 'scan') = ("reported_by" IS NULL))
);--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "chat_reports_location_id_idx"
  ON "chat_reports" ("location_id");--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "chat_reports_location_status_idx"
  ON "chat_reports" ("location_id", "status", "created_at");--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "chat_reports_escalation_idx"
  ON "chat_reports" ("severity", "escalated_at");--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "chat_reports_message_idx"
  ON "chat_reports" ("message_id");--> statement-breakpoint

-- ── Step 8: chat_signals, and the only RLS policy in this schema ─────────
--
-- `SPRINTS.md` records the intended real-time design as Postgres Changes over
-- `chat_messages` with RLS as the gate: a conversation you are not in is
-- refused by the database rather than hidden by the UI. Right instinct, wrong
-- mechanism, for two reasons this codebase has already written down.
--
-- First, RLS does not apply to the connection the app itself uses — postgres-js
-- through the Supavisor pooler, and the service role for Storage — so RLS gates
-- only the browser's connection, which is a narrower claim than the one being
-- made.
--
-- Second, the browser authenticates to Realtime with a GoTrue JWT, and
-- STATE.md warns that changing a user's role does **not** refresh an existing
-- token, while SPRINTS.md states flatly that authorization is read per request
-- from `school_users` and never from the token. An RLS policy keyed on a JWT
-- claim is the thing that rule forbids, and streaming message bodies under it
-- would make a child's privacy depend on a claim known to go stale.
--
-- So the socket carries a signal and the API carries the content. A row here
-- says *that* something happened and to whom, and nothing that would matter if
-- the wrong person received it. The client then fetches through the ordinary
-- route, where `withSchoolAuth` re-resolves membership against the live row.
--
-- `recipient_auth_user_id` stores the GoTrue id directly rather than reaching
-- it through `school_users.auth_user_id`, so the policy is a column comparison
-- against an index rather than a per-row subquery, on a table that fans out one
-- row per recipient per message.
CREATE TABLE IF NOT EXISTS "chat_signals" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "location_id" text NOT NULL REFERENCES "schools"("location_id") ON DELETE cascade,
  "recipient_auth_user_id" text NOT NULL,
  "conversation_id" uuid NOT NULL REFERENCES "chat_conversations"("id") ON DELETE cascade,
  "message_id" uuid NOT NULL REFERENCES "chat_messages"("id") ON DELETE cascade,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "chat_signals_location_id_idx"
  ON "chat_signals" ("location_id");--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "chat_signals_recipient_created_idx"
  ON "chat_signals" ("recipient_auth_user_id", "created_at");--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "chat_signals_created_idx"
  ON "chat_signals" ("created_at");--> statement-breakpoint

ALTER TABLE "chat_signals" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint

-- Deny-by-default is what enabling RLS already does: with no policy, the
-- `authenticated` role sees nothing. This adds back exactly one thing — your
-- own signals — and adds no INSERT, UPDATE or DELETE policy at all, because
-- only the server writes here and the server is not subject to this.
DROP POLICY IF EXISTS "chat_signals_own" ON "chat_signals";--> statement-breakpoint

CREATE POLICY "chat_signals_own" ON "chat_signals"
  FOR SELECT TO "authenticated"
  USING ("recipient_auth_user_id" = auth.uid()::text);--> statement-breakpoint

-- ── Step 9: the module key ───────────────────────────────────────────────
--
-- `school_modules.module_key` is CHECKed against a list generated from
-- `SCHOOL_FLAG_KEYS` in `lib/platform-modules.ts`. Sprint 24 adds `chat` there,
-- and this is the DDL half. Without it the Super Admin toggle grid renders the
-- new switch and Postgres refuses the write — a failure that reaches nobody
-- until a school is being switched on.
ALTER TABLE "school_modules"
  DROP CONSTRAINT IF EXISTS "school_modules_module_key_check";--> statement-breakpoint

ALTER TABLE "school_modules" ADD CONSTRAINT "school_modules_module_key_check" CHECK (
  module_key IN (
    'admissions', 'fee_management', 'academics', 'chat', 'lms', 'hr_payroll',
    'accounts', 'event_mgmt', 'transport', 'library', 'hostel'
  )
);--> statement-breakpoint

-- ── Step 10: the four permission keys ────────────────────────────────────
--
-- The same trap in the other table, and the one STATE.md §5o records by name:
-- a new key in `PERMISSIONS` without this rewrite fails at the first time an
-- administrator saves the permission matrix, not at build and not here.
--
-- `chat.moderate` is separated from `chat.grant` deliberately. Opening a class
-- for two hours is a teacher's ordinary work; reading a pupil's conversations
-- and banning a parent is what a safeguarding complaint comes back to, and the
-- two should not arrive together by default.
ALTER TABLE "role_permissions"
  DROP CONSTRAINT IF EXISTS "role_permissions_permission_check";--> statement-breakpoint

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
    'comms.write', 'comms.send', 'chat.read',
    'chat.send', 'chat.grant', 'chat.moderate',
    'settings.read', 'settings.write', 'branches.manage',
    'principals.manage', 'permissions.manage', 'accounting.read',
    'accounting.write', 'accounting.settle'
  )
);--> statement-breakpoint

-- ── Step 11: the chat email preference ───────────────────────────────────
--
-- `notification_preferences` gains a fourth category. Its own docblock states
-- the rule this follows: a category exists here only if something in the
-- codebase sends mail of that kind, and Sprint 24's digest sweep is that
-- sender.
--
-- Default true, matching the three beside it, and absent-row-means-everything-
-- on stays the posture. What it governs is *only* the digest — a school cannot
-- switch off the messages themselves, which arrive in the portal whatever this
-- says, exactly as the notice board is never suppressible.
ALTER TABLE "notification_preferences"
  ADD COLUMN IF NOT EXISTS "email_chat" boolean NOT NULL DEFAULT true;--> statement-breakpoint

-- ── Step 12: the pupil's credential ──────────────────────────────────────
--
-- The blocker this sprint had to clear before any of the above matters.
--
-- `lib/enrollment.ts` creates a `school_users` row for every pupil with no
-- email, no `auth_user_id`, and a sentinel phone (`student:GVS-2025-0001`)
-- engineered so it cannot request a passcode. A pupil is an addressable
-- directory entry and not an actor, and every control the brief described —
-- the initiation toggle, the reply window, the class opened for two hours —
-- governs a person with no way to reach the product.
--
-- The address minted for them is `<admission-number>@students.<slug>.invalid`.
-- `.invalid` is reserved by RFC 2606 and can never resolve, so it is an
-- identity for GoTrue and provably never a delivery target — which is the
-- property that matters, because it means no code path can accidentally email
-- a minor. It is unique by construction, satisfying `0038`'s partial unique
-- index on the active lowercased address.
--
-- This column records *when* that was issued, and nothing else. The address
-- itself lives in the existing `email` column, so every lookup, every uniqueness
-- guarantee and every one of `0038`'s protections applies to it unchanged. A
-- second address column would have been a second thing for the login lookup to
-- disagree with, which is the defect §5bk is an incident report about.
--
-- Nullable, no default, no backfill: a school issues these deliberately, from a
-- screen, for the grades it has chosen, and a backfill script does that after
-- the fact rather than a migration doing it to every pupil on the platform.
ALTER TABLE "school_users"
  ADD COLUMN IF NOT EXISTS "student_credential_issued_at" timestamp with time zone;
