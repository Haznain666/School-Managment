# Sprint 24 — `0040_sprint24_chat.sql`

**Status: APPLIED and VERIFIED** against the live database on 2026-09-04.
Bookkeeping went 40 → 41 rows; every existing row count was identical either
side.

Eight new tables, two widened CHECK constraints, one row-level-security policy,
three new columns. Nothing in this file rewrites an existing row.

---

## Deploy order: **migration first, then code**

There is no chat surface that degrades gracefully without these tables, and one
of the reads is in a **layout**:

| If the code ships first | What a user sees |
| --- | --- |
| `app/(student)/layout.tsx`, `(parent)`, `(teacher)` | The chat badge read throws `42P01`. **Guarded** — `countChats` catches it and returns 0, so the portal still opens. This is the §5aw pattern and it is the only reason a code-first deploy is survivable at all. |
| `/dashboard/chat`, `/parent/chat`, `/student/chat`, `/teacher/chat` | 500. `listInbox` has no tables to read. |
| The Super Admin module grid | The `chat` toggle renders and Postgres refuses the write with `23514`. |
| The permission matrix | Saving any role fails with `23514` — the §5o trap. |

So: apply `0040`, then push. The reverse leaves four dead routes and two
screens that refuse to save.

---

## How it was applied

```bash
node scripts/apply-0040.mjs
```

⚠ **`drizzle-kit migrate` cannot be used.** `DATABASE_URL` holds an unescaped
literal `@` in the password; drizzle-kit hangs on it for five minutes and
applies nothing (`STATE.md` §5bg). `apply-0040.mjs` runs drizzle-orm's own
`postgres-js` migrator — same statements, same `drizzle.__drizzle_migrations`
bookkeeping — against the **pooler on port 5432** (session mode). Port 6543 is
transaction mode and will not do DDL; the direct `db.<ref>.supabase.co` host is
IPv6-only without a paid add-on.

Two `NOTICE`s are expected and harmless on a re-run: `__drizzle_migrations
already exists` and `policy "chat_signals_own" does not exist, skipping` — the
latter is the `DROP POLICY IF EXISTS` that makes step 8 idempotent.

---

## How to verify it — against the catalogue, not the exit code

```bash
node scripts/verify-0040.mjs   # 25 assertions
npm run check-sprint24         # 28 statements, executed
```

`verify-0040.mjs` does something the other scripts in this repository do not,
and it is the reason it exists: **it proves the two safeguarding indexes
actually refuse**, rather than reading `pg_indexes` and believing it.

```
The two safeguarding indexes, tried rather than read:
  ok    two pupils in one conversation — refused with 23505
  ok    two parents who can both post — refused with 23505
  ok    two parents observing, plus the pupil and a teacher — permitted, as intended
```

Every attempt runs inside a transaction that is **always rolled back**, and the
script then asserts both tables are empty. Reading the catalogue would have said
the index was present; only trying it says Postgres will enforce it. An index
created non-unique by accident would forbid nothing and report nothing, which is
exactly the failure this half catches.

---

## What the two indexes are, and why they are the point

```sql
CREATE UNIQUE INDEX chat_participants_one_student_idx
  ON chat_participants (conversation_id) WHERE is_student;

CREATE UNIQUE INDEX chat_participants_one_posting_parent_idx
  ON chat_participants (conversation_id) WHERE is_parent AND can_post;
```

The brief named four abuses — pupils flooding one another, forming their own
groups, passing images around, and passing links to the places they formed those
groups. Every one needs a pupil to be able to reach another pupil.

The first index makes that a `23505` rather than a rule in a resolver. There is
no administrator toggle that lifts it, no super-admin override, and no route back
that does not go through a migration somebody has to write and defend. **A
resolver is bypassed by the next route that forgets to call it; this cannot be.**

The second is narrowed to seats that can *post*, so a mother and a father may
both observe their child's thread. A flat "one parent" index would have made
that impossible, which is not the rule anybody asked for — hence the third
assertion above, which fails if the narrowing is ever lost.

---

## The two CHECK rewrites

Both are generated from TypeScript lists, and both fail at **runtime** rather
than at build or in this file:

- `role_permissions_permission_check` — widened for `chat.read`, `chat.send`,
  `chat.grant`, `chat.moderate`. Without it, saving the permission matrix fails
  with `23514`. This is the trap `STATE.md` §5o records by name.
- `school_modules_module_key_check` — widened for `chat`. Without it, switching
  the module on for a school fails with `23514`.

A key added to `PERMISSIONS` or `PLATFORM_MODULES` without the matching DDL is
green in every check this repository has except the two that talk to Postgres.

---

## Row-level security — the one policy in this schema

`chat_signals` is the only table with RLS enabled, and it is the only table a
browser ever reads directly:

```sql
CREATE POLICY "chat_signals_own" ON "chat_signals"
  FOR SELECT TO "authenticated"
  USING ("recipient_auth_user_id" = auth.uid()::text);
```

**This is not what `SPRINTS.md` originally specified**, and the difference is
deliberate. §24 records the plan as Postgres Changes over `chat_messages` with
RLS as the gate. Two things make that wrong here:

1. RLS does not apply to the connection the app itself uses — postgres-js
   through the Supavisor pooler, and the service role for Storage. It would gate
   only the browser's connection, which is a narrower claim than the one being
   made.
2. The browser authenticates to Realtime with a GoTrue JWT, and `STATE.md`
   §5bk-adjacent notes warn that **changing a role does not refresh an existing
   token**, while `SPRINTS.md:1398` states flatly that authorization is read per
   request from `school_users` and never from the token.

So the socket carries `{conversationId, messageId}` and nothing readable, the
API serves the content under `withSchoolAuth`, and RLS is back to being what
`STATE.md:1358` calls it — *additional* defence, not a replacement. It also
keeps the socket pointed at Supabase rather than at a LiteSpeed proxy nobody has
measured for WebSocket behaviour.

There is deliberately **no INSERT, UPDATE or DELETE policy**: only the server
writes here, and the server is not subject to this.

---

## How to undo it

`0040` is additive, so rolling back the *code* is enough to make the schema
inert — the eight tables simply stop being read. If the tables themselves must
go:

```sql
BEGIN;
DROP TABLE IF EXISTS chat_signals, chat_reports, chat_grants, chat_messages,
                     chat_participants, chat_conversations, chat_settings,
                     chat_school_settings CASCADE;

ALTER TABLE school_users DROP COLUMN IF EXISTS student_credential_issued_at;
ALTER TABLE notification_preferences DROP COLUMN IF EXISTS email_chat;

-- And put both CHECK constraints back to their pre-0040 text, which is in
-- 0035 (permissions) and 0028 (modules). Leaving them widened is harmless —
-- they only permit values nothing writes any more.

DELETE FROM drizzle.__drizzle_migrations WHERE id = 41;
COMMIT;
```

⚠ Dropping `chat_messages` destroys a safeguarding record. Do not do it to tidy
up after a failed deploy; the tables are empty until somebody sends a message,
and an empty table costs nothing.

**One thing a rollback does not undo:** any pupil credential already issued.
`issueStudentCredential` writes a GoTrue account and sets `school_users.email`,
and dropping `student_credential_issued_at` leaves both. That is deliberate —
losing the column should not lock a pupil out — but it means the address is
still live and should be cleared by hand if the feature is abandoned.
