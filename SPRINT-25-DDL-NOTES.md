# Sprint 25 — `0041_sprint25_chat_part2.sql`

Three new tables, five new columns, one publication change. Nothing in this
file rewrites an existing row.

---

## Deploy order: **migration first, then code**

Same as `0040`, and for a sharper reason. Two of the five columns are read by
paths that run on **every page** of a portal.

| If the code ships first | What happens |
| --- | --- |
| `chat_settings.sound_enabled` | The chat settings read throws `42703`. The chat screen 500s on all four portals. |
| `chat_conversations.broadcast_id` | `listInbox` selects it — the inbox 500s. This is the loudest one and it is on every portal. |
| `notification_preferences.push_chat` | The parent settings screen 500s, and the digest sweep throws every five minutes. |
| `school_users.deactivated_at` | The users screen 500s. |
| `chat_broadcasts` / `chat_attachments` / `push_subscriptions` | `42P01` on the composer, the attachment proxy and the push-subscribe route. |

Apply `0041`, then push.

---

## The one statement whose failure is silent

Step 8:

```sql
ALTER PUBLICATION supabase_realtime ADD TABLE public.chat_signals;
```

Everything else in this file fails **loudly** if it is missing — a `42P01` or a
`42703` on a screen somebody is looking at. This one does not.

Supabase Realtime streams Postgres changes only for tables in the
`supabase_realtime` publication. If `chat_signals` is not in it:

- the browser's `postgres_changes` subscription **succeeds**;
- the channel reports `SUBSCRIBED`;
- no error is raised anywhere, in any log;
- and not one event ever arrives.

The poll fallback then quietly does all the work, so chat *appears* to function
— just eight seconds slower than it should, forever. Nobody would report it,
because nothing looks broken.

That is why `verify-0041.mjs` asserts publication membership directly rather
than trusting that the migration ran, and why it is the first thing to check if
real-time "does not seem to work".

It is wrapped in a `DO` block because `ALTER PUBLICATION … ADD TABLE` has no
`IF NOT EXISTS` and would otherwise fail a re-run with *"relation is already
member of publication"*.

**Adding it to the publication does not widen what anyone can see.**
`chat_signals` already carries row-level security and a single SELECT policy
keyed on `auth.uid()`, so a subscriber receives only their own rows — and the
payload is a conversation id and a message id, never content.

---

## How to apply and verify

```bash
node scripts/apply-0041.mjs     # census either side
node scripts/verify-0041.mjs    # catalogue + three attempted refusals
npm run check-sprint25          # every new statement, executed
```

⚠ **`drizzle-kit migrate` cannot be used.** `DATABASE_URL` holds an unescaped
literal `@` in the password; drizzle-kit hangs for five minutes and applies
nothing (`STATE.md` §5bg). Use the pooler on port **5432** (session mode) —
6543 is transaction mode and will not do DDL.

`verify-0041.mjs` proves three refusals by attempting them inside transactions
that are always rolled back:

1. a broadcast conversation cannot hold two pupils (`23505`);
2. an attachment one byte over 2 MB is refused (`23514`);
3. an attachment claiming a forbidden content type is refused (`23514`).

The first matters most. The broadcast fan-out opens N separate threads
*because* it cannot open one shared one — and this re-proves that on the new
code path, against a conversation that carries a `broadcast_id`.

---

## Environment variables this sprint needs

Two, both **server-only**, both on the Hostinger Node app:

```
VAPID_PUBLIC_KEY
VAPID_PRIVATE_KEY
```

They are already in the local `.env.local`.

**Neither is `NEXT_PUBLIC_`, and that is deliberate.** A `NEXT_PUBLIC_*` value
is baked into the bundle at build time, so changing it on Hostinger needs a
fresh build rather than a restart. The browser gets the public key from
`GET /api/school/chat/realtime-config` instead, alongside the Supabase URL and
anon key — which is why this sprint adds no new public env var at all and a key
rotation is a restart rather than a rebuild.

Setting them through the Hostinger API is a **full replace** of the variable
set: send every existing key with its real value, or the ones you omit are
deleted. The values are in `.env.local`; the API returns them masked and they
can never be read back.

---

## How to undo it

`0041` is additive, so rolling the code back makes the schema inert. If the
tables must go:

```sql
BEGIN;
ALTER PUBLICATION supabase_realtime DROP TABLE public.chat_signals;

ALTER TABLE chat_conversations DROP COLUMN IF EXISTS broadcast_id;
DROP TABLE IF EXISTS chat_attachments, chat_broadcasts, push_subscriptions CASCADE;

ALTER TABLE chat_settings DROP COLUMN IF EXISTS sound_enabled;
ALTER TABLE notification_preferences DROP COLUMN IF EXISTS push_chat;
ALTER TABLE school_users DROP COLUMN IF EXISTS deactivated_at;
ALTER TABLE school_users DROP COLUMN IF EXISTS deactivated_reason;

DELETE FROM drizzle.__drizzle_migrations WHERE id = 42;
COMMIT;
```

⚠ Dropping `chat_attachments` orphans the objects in Storage under
`<location>/<branch>/chat/`. They are unreachable but not deleted, and they
still count against the bucket. Clear that prefix separately if the rollback is
permanent.

⚠ Dropping `school_users.deactivated_reason` loses the record of *why* accounts
were switched off. `is_active` survives, so nobody is locked out or let back in
by the rollback — but "why can this parent not sign in" becomes unanswerable
again.

**What a rollback does not undo:** push subscriptions already registered in
people's browsers. The rows go, the browser-side registration does not, so
those browsers hold a subscription to an endpoint nothing will ever send to.
Harmless, and it means re-subscribing after a re-deploy is a fresh row rather
than a duplicate — `endpoint` is unique, so the second registration replaces
the first.
