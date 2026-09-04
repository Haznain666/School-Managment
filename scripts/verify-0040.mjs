#!/usr/bin/env node

/**
 * Verifies `0040` against the catalogue, and then proves the two indexes that
 * carry the module's safeguarding actually refuse what they claim to.
 *
 * ── Why the second half exists ───────────────────────────────────────────
 * `check-sprint24` asserts the indexes are *present* and that one of them is
 * UNIQUE and partial. That is a reading of `pg_indexes`, and a reading is
 * evidence about spelling. The claim this module actually rests on is that
 * Postgres will **refuse a second pupil in a conversation** — and the only
 * thing that establishes that is trying it.
 *
 * ── It writes, and then it does not ──────────────────────────────────────
 * The attempt runs inside a transaction that is always rolled back, so the
 * database is exactly as it was either way. That is the only form in which a
 * verification script may write at all: the rows exist for the length of one
 * statement, are never committed, and are never visible to another connection.
 *
 * A `23505` is the pass. Anything else — including the insert succeeding — is a
 * failure, and the succeeding case is the one worth naming: an index created
 * without its `WHERE` clause would forbid *two participants of any kind*, which
 * is loud; one created non-unique would forbid nothing at all and say so
 * nowhere. This distinguishes them.
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

/* ---------------------------------------------------------------------
 * 1. The catalogue — read one thing at a time, never a count.
 * ------------------------------------------------------------------ */

console.log('\nTables:');
const CHAT_TABLES = [
  'chat_school_settings',
  'chat_settings',
  'chat_conversations',
  'chat_participants',
  'chat_messages',
  'chat_grants',
  'chat_reports',
  'chat_signals',
];

for (const table of CHAT_TABLES) {
  const rows = await client`
    select 1 from information_schema.tables
     where table_schema = 'public' and table_name = ${table}`;
  assert(table, rows.length === 1, 'absent');
}

console.log('\nColumns added to existing tables:');
for (const [table, column] of [
  ['school_users', 'student_credential_issued_at'],
  ['notification_preferences', 'email_chat'],
  ['chat_participants', 'digested_at'],
]) {
  const rows = await client`
    select data_type, is_nullable from information_schema.columns
     where table_schema = 'public' and table_name = ${table} and column_name = ${column}`;
  assert(`${table}.${column}`, rows.length === 1, 'absent');
}

console.log('\nConstraints that fail at runtime rather than here:');
const permCheck = await client`
  select pg_get_constraintdef(oid) as def from pg_constraint
   where conname = 'role_permissions_permission_check'`;
for (const key of ['chat.read', 'chat.send', 'chat.grant', 'chat.moderate']) {
  assert(
    `role_permissions CHECK admits ${key}`,
    (permCheck[0]?.def ?? '').includes(key),
    'saving the permission matrix would fail with 23514',
  );
}

const moduleCheck = await client`
  select pg_get_constraintdef(oid) as def from pg_constraint
   where conname = 'school_modules_module_key_check'`;
assert(
  "school_modules CHECK admits 'chat'",
  (moduleCheck[0]?.def ?? '').includes("'chat'"),
  'switching chat on for a school would fail with 23514',
);

console.log('\nRow-level security on chat_signals:');
const rls = await client`
  select relrowsecurity from pg_class where oid = 'public.chat_signals'::regclass`;
assert('RLS is enabled', rls[0]?.relrowsecurity === true, 'the policy would grant nothing');

const policy = await client`
  select policyname, cmd, qual from pg_policies
   where schemaname = 'public' and tablename = 'chat_signals'`;
assert('exactly one policy', policy.length === 1, `found ${policy.length}`);
assert('it is a SELECT policy', policy[0]?.cmd === 'SELECT', `cmd is ${policy[0]?.cmd}`);
assert(
  'it compares recipient_auth_user_id to auth.uid()',
  (policy[0]?.qual ?? '').includes('auth.uid()'),
  `qual is ${policy[0]?.qual}`,
);

/* ---------------------------------------------------------------------
 * 2. The part that matters: do the indexes actually refuse?
 * ------------------------------------------------------------------ */

console.log('\nThe two safeguarding indexes, tried rather than read:');

// The tenant with the most accounts, not the first one. Three seats are needed
// to prove the parent index is *narrowed* rather than merely strict, and the
// first school on this estate has two — which the first run of this script
// reported as a failure rather than skipping, correctly.
const location = (
  await client`
    select location_id, count(*)::int as n
      from school_users
     group by location_id
     order by n desc
     limit 1`
)[0]?.location_id;

if (location === undefined) {
  fail('a tenant to test against', 'no school_users rows — cannot exercise the indexes');
} else {
  const users = await client`
    select id from school_users where location_id = ${location} limit 3`;

  if (users.length < 3) {
    fail(
      'three accounts to seat',
      `only ${users.length} school_users rows at ${location} — cannot exercise the indexes`,
    );
  } else {
    const [a, b, c] = users.map((row) => row.id);

    // Every attempt is inside a transaction that is always rolled back. The
    // rows never commit and are never visible to another connection.
    const attempt = async (label, seats, expectRefusal) => {
      const conversationId = randomUUID();

      try {
        await client.begin(async (tx) => {
          await tx`
            insert into chat_conversations (id, location_id, kind, status, created_by)
            values (${conversationId}, ${location}, 'direct', 'open', ${a})`;

          for (const seat of seats) {
            await tx`
              insert into chat_participants
                (location_id, conversation_id, school_user_id, participant_role,
                 can_post, is_student, is_parent)
              values (${location}, ${conversationId}, ${seat.id}, ${seat.role},
                      ${seat.canPost}, ${seat.isStudent}, ${seat.isParent})`;
          }

          // Never committed, whatever happened above.
          throw new Error('ROLLBACK_ON_PURPOSE');
        });

        fail(label, 'the transaction committed, which should be impossible');
      } catch (error) {
        const code = error?.code ?? error?.cause?.code ?? null;

        if (error?.message === 'ROLLBACK_ON_PURPOSE') {
          if (expectRefusal) {
            fail(label, 'the insert SUCCEEDED — the index is not refusing it');
          } else {
            ok(label, 'permitted, as intended');
          }
          return;
        }

        if (code === '23505') {
          if (expectRefusal) ok(label, 'refused with 23505');
          else fail(label, 'refused with 23505, but this shape is supposed to be allowed');
          return;
        }

        fail(label, `unexpected ${code ?? '?'} — ${String(error?.message).split('\n')[0]}`);
      }
    };

    await attempt(
      'two pupils in one conversation',
      [
        { id: a, role: 'member', canPost: true, isStudent: true, isParent: false },
        { id: b, role: 'member', canPost: true, isStudent: true, isParent: false },
      ],
      true,
    );

    await attempt(
      'two parents who can both post',
      [
        { id: a, role: 'member', canPost: true, isStudent: false, isParent: true },
        { id: b, role: 'member', canPost: true, isStudent: false, isParent: true },
      ],
      true,
    );

    // The narrowing that makes the parent index right rather than merely
    // strict: a mother and a father may both observe their child's thread.
    await attempt(
      'two parents observing, plus the pupil and a teacher',
      [
        { id: a, role: 'member', canPost: true, isStudent: true, isParent: false },
        { id: b, role: 'observer', canPost: false, isStudent: false, isParent: true },
        { id: c, role: 'observer', canPost: false, isStudent: false, isParent: true },
      ],
      false,
    );
  }
}

/* ---------------------------------------------------------------------
 * 3. Nothing was left behind.
 * ------------------------------------------------------------------ */

console.log('\nNothing committed:');
for (const table of ['chat_conversations', 'chat_participants']) {
  const rows = await client`select count(*)::int as n from ${client(table)}`;
  assert(`${table} is empty`, rows[0]?.n === 0, `${rows[0]?.n} row(s) left behind`);
}

console.log(
  `\n${failures === 0 ? 'PASS' : 'FAIL'} — ${passes} ok, ${failures} failed\n`,
);

await client.end();
process.exit(failures === 0 ? 0 : 1);
