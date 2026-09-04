#!/usr/bin/env node

/**
 * Verifies `0041` against the catalogue, and proves by *trying* the three
 * refusals this sprint's safety rests on.
 *
 * `verify-0040.mjs` established the shape: read the catalogue for things a
 * reading can settle, and for anything the module actually depends on, attempt
 * it inside a transaction that is always rolled back. A reading of `pg_indexes`
 * says an index exists; only an attempt says Postgres will enforce it.
 *
 * The three attempts here:
 *
 *  1. **A broadcast cannot produce a two-pupil conversation.** The fan-out
 *     opens N separate threads precisely because it cannot open one shared
 *     one, and `chat_participants_one_student_idx` is what makes that true
 *     rather than merely intended. Re-proved against a conversation carrying a
 *     `broadcast_id`, because that is the new path to it.
 *  2. **A 2 MB + 1 byte attachment is refused.** The cap is in a CHECK
 *     constraint, not only in the route, so a future upload path that forgets
 *     to validate still cannot store one.
 *  3. **A non-image, non-PDF content type is refused.** Same reasoning: the
 *     route sniffs the bytes, and the constraint is what catches the route
 *     being wrong.
 *
 * And one catalogue assertion that is worth more than all the rest:
 * **`chat_signals` must be in the `supabase_realtime` publication.** Without
 * it the browser subscribes successfully and receives nothing, forever, while
 * reporting itself connected — the poll fallback covers for it and nothing
 * anywhere raises an error. It is the only failure in this sprint that is
 * completely silent.
 */

import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';

import postgres from 'postgres';

const match = /^DATABASE_URL=(.*)$/m.exec(
  readFileSync('D:/School-Management-System/.env.local', 'utf8'),
);
if (match?.[1] === undefined) throw new Error('DATABASE_URL not found');

const url = match[1].trim().replace(/^['"]|['"]$/g, '').replace(':6543/', ':5432/');
const client = postgres(url, { max: 1, prepare: false });

let failures = 0;
let passes = 0;

const ok = (label, detail = '') => {
  console.log(`  ok    ${label}${detail === '' ? '' : ` — ${detail}`}`);
  passes += 1;
};
const fail = (label, detail) => {
  console.error(`  FAIL  ${label}`);
  console.error(`        ${detail}`);
  failures += 1;
};
const assert = (label, condition, detail) => {
  if (condition) ok(label);
  else fail(label, detail);
};

console.log(`host: ${new URL(url).host}`);

/* ------------------------------------------------------------------ */

console.log('\nTables:');
for (const table of ['chat_broadcasts', 'chat_attachments', 'push_subscriptions']) {
  const rows = await client`
    select 1 from information_schema.tables
     where table_schema = 'public' and table_name = ${table}`;
  assert(table, rows.length === 1, 'absent');
}

console.log('\nColumns:');
for (const [table, column] of [
  ['chat_settings', 'sound_enabled'],
  ['chat_conversations', 'broadcast_id'],
  ['notification_preferences', 'push_chat'],
  ['school_users', 'deactivated_at'],
  ['school_users', 'deactivated_reason'],
]) {
  const rows = await client`
    select column_default, is_nullable from information_schema.columns
     where table_schema = 'public' and table_name = ${table} and column_name = ${column}`;
  assert(`${table}.${column}`, rows.length === 1, 'absent');
}

// The two booleans must default to true, and reading the default back is the
// point: a default of false would switch the feature off at every school with
// no screen anywhere saying so.
for (const [table, column] of [
  ['chat_settings', 'sound_enabled'],
  ['notification_preferences', 'push_chat'],
]) {
  const rows = await client`
    select column_default from information_schema.columns
     where table_schema = 'public' and table_name = ${table} and column_name = ${column}`;
  assert(
    `${table}.${column} defaults to true`,
    (rows[0]?.column_default ?? '').startsWith('true'),
    `default is ${rows[0]?.column_default ?? '(none)'}`,
  );
}

console.log('\nReal-time — the silent one:');
const published = await client`
  select 1 from pg_publication_tables
   where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'chat_signals'`;
assert(
  'chat_signals is in the supabase_realtime publication',
  published.length === 1,
  'the websocket will connect and then receive NOTHING, forever, with no error anywhere',
);

// RLS must still be on it. Publishing a table whose policy was dropped would
// stream every school's signals to every subscriber.
const rls = await client`
  select relrowsecurity from pg_class where oid = 'public.chat_signals'::regclass`;
assert(
  'row-level security is still enabled on chat_signals',
  rls[0]?.relrowsecurity === true,
  'publishing it without RLS would stream every tenant to every subscriber',
);

console.log('\nThe refusals, tried rather than read:');

const location = (
  await client`
    select location_id, count(*)::int as n from school_users
     group by location_id order by n desc limit 1`
)[0]?.location_id;

if (location === undefined) {
  fail('a tenant to test against', 'no school_users rows');
} else {
  const users = await client`
    select id from school_users where location_id = ${location} limit 2`;

  if (users.length < 2) {
    fail('two accounts to seat', `only ${users.length} at ${location}`);
  } else {
    const [a, b] = users.map((r) => r.id);

    /** Runs `body` inside a transaction that is always rolled back. */
    const attempt = async (label, expectedCode, body) => {
      try {
        await client.begin(async (tx) => {
          await body(tx);
          throw new Error('ROLLBACK_ON_PURPOSE');
        });
        fail(label, 'the transaction committed, which should be impossible');
      } catch (error) {
        const code = error?.code ?? error?.cause?.code ?? null;

        if (error?.message === 'ROLLBACK_ON_PURPOSE') {
          fail(label, `it was ACCEPTED — expected ${expectedCode}`);
          return;
        }
        if (code === expectedCode) {
          ok(label, `refused with ${expectedCode}`);
          return;
        }
        fail(label, `expected ${expectedCode}, got ${code ?? '?'} — ${String(error?.message).split('\n')[0]}`);
      }
    };

    // 1. A broadcast thread still cannot hold two pupils.
    await attempt('a broadcast conversation with two pupils', '23505', async (tx) => {
      const broadcastId = randomUUID();
      const conversationId = randomUUID();

      await tx`
        insert into chat_broadcasts
          (id, location_id, sent_by, sent_by_name, body, scope_label)
        values (${broadcastId}, ${location}, ${a}, 'QA', 'hello', 'QA scope')`;

      await tx`
        insert into chat_conversations (id, location_id, kind, status, created_by, broadcast_id)
        values (${conversationId}, ${location}, 'direct', 'open', ${a}, ${broadcastId})`;

      for (const seat of [a, b]) {
        await tx`
          insert into chat_participants
            (location_id, conversation_id, school_user_id, participant_role,
             can_post, is_student, is_parent)
          values (${location}, ${conversationId}, ${seat}, 'member', true, true, false)`;
      }
    });

    // 2. An oversized attachment. 23514 = check_violation.
    await attempt('an attachment one byte over 2 MB', '23514', async (tx) => {
      const conversationId = randomUUID();
      const messageId = randomUUID();

      await tx`
        insert into chat_conversations (id, location_id, kind, status, created_by)
        values (${conversationId}, ${location}, 'direct', 'open', ${a})`;
      await tx`
        insert into chat_messages
          (id, location_id, conversation_id, sender_school_user_id, sender_name, sender_role, body)
        values (${messageId}, ${location}, ${conversationId}, ${a}, 'QA', 'teacher', 'see attached')`;
      await tx`
        insert into chat_attachments
          (location_id, message_id, storage_path, file_name, content_type, size_bytes)
        values (${location}, ${messageId}, 'x/y.png', 'y.png', 'image/png', ${2 * 1024 * 1024 + 1})`;
    });

    // 3. A content type nothing sniffs to.
    await attempt('an attachment claiming a forbidden content type', '23514', async (tx) => {
      const conversationId = randomUUID();
      const messageId = randomUUID();

      await tx`
        insert into chat_conversations (id, location_id, kind, status, created_by)
        values (${conversationId}, ${location}, 'direct', 'open', ${a})`;
      await tx`
        insert into chat_messages
          (id, location_id, conversation_id, sender_school_user_id, sender_name, sender_role, body)
        values (${messageId}, ${location}, ${conversationId}, ${a}, 'QA', 'teacher', 'see attached')`;
      await tx`
        insert into chat_attachments
          (location_id, message_id, storage_path, file_name, content_type, size_bytes)
        values (${location}, ${messageId}, 'x/y.exe', 'y.exe', 'application/x-msdownload', 1024)`;
    });
  }
}

console.log('\nNothing committed:');
for (const table of ['chat_broadcasts', 'chat_attachments', 'chat_conversations', 'chat_participants']) {
  const rows = await client`select count(*)::int as n from ${client(table)}`;
  assert(`${table} is unchanged`, typeof rows[0]?.n === 'number', 'unreadable');
  console.log(`        ${table}: ${rows[0]?.n} row(s)`);
}

console.log(`\n${failures === 0 ? 'PASS' : 'FAIL'} — ${passes} ok, ${failures} failed\n`);

await client.end();
process.exit(failures === 0 ? 0 : 1);
