#!/usr/bin/env node

/**
 * Applies pending migrations through drizzle-orm's own `postgres-js` migrator,
 * with a before/after census either side of it.
 *
 * `drizzle-kit migrate` cannot be used and has not been since Sprint 18: the
 * password in `DATABASE_URL` holds an unescaped literal `@`, and drizzle-kit
 * hangs on it for five minutes and applies nothing (STATE.md §5bg). This is the
 * documented route — same statements, same `drizzle.__drizzle_migrations`
 * bookkeeping — against the **pooler on port 5432**, session mode. 6543 is
 * transaction mode and will not do DDL, and the direct `db.<ref>.supabase.co`
 * host is IPv6-only (§5c).
 *
 * `0040` is the largest migration in this project: eight new tables, two
 * widened CHECK constraints, one RLS policy and two new columns. It writes to
 * no existing row, so the census is the evidence that matters — every existing
 * count must be identical either side, and the eight tables must go from absent
 * to present in one step.
 *
 * The two partial unique indexes on `chat_participants` are counted separately
 * because they are the module's whole safeguarding design and a migration that
 * created the table without them would look entirely successful.
 */

import { readFileSync } from 'node:fs';

import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';

const match = /^DATABASE_URL=(.*)$/m.exec(
  readFileSync('D:/School-Management-System/.env.local', 'utf8'),
);
if (match?.[1] === undefined) throw new Error('DATABASE_URL not found');

const url = match[1].trim().replace(/^['"]|['"]$/g, '').replace(':6543/', ':5432/');
console.log(`host: ${new URL(url).host}`);

const client = postgres(url, { max: 1, prepare: false });

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

const census = async (label) => {
  const [books] = await client`select count(*)::int as n from drizzle.__drizzle_migrations`;
  const [newest] = await client`
    select id, created_at from drizzle.__drizzle_migrations order by id desc limit 1`;
  const [schools] = await client`select count(*)::int as n from schools`;
  const [users] = await client`select count(*)::int as n from school_users`;
  const [perms] = await client`select count(*)::int as n from role_permissions`;
  const [prefs] = await client`select count(*)::int as n from notification_preferences`;

  const tables = await client`
    select table_name from information_schema.tables
     where table_schema = 'public' and table_name = any(${CHAT_TABLES})
     order by table_name`;

  const indexes = await client`
    select indexname from pg_indexes
     where schemaname = 'public'
       and indexname in (
         'chat_participants_one_student_idx',
         'chat_participants_one_posting_parent_idx'
       )
     order by indexname`;

  const policies = await client`
    select policyname from pg_policies
     where schemaname = 'public' and tablename = 'chat_signals'`;

  const newCols = await client`
    select table_name, column_name from information_schema.columns
     where table_schema = 'public'
       and ((table_name = 'school_users' and column_name = 'student_credential_issued_at')
         or (table_name = 'notification_preferences' and column_name = 'email_chat')
         or (table_name = 'chat_participants' and column_name = 'digested_at'))
     order by table_name, column_name`;

  console.log(`\n--- ${label} ---`);
  console.log(`  __drizzle_migrations rows  : ${books.n}`);
  console.log(`  newest entry               : id=${newest.id} created_at=${newest.created_at}`);
  console.log(`  schools rows               : ${schools.n}`);
  console.log(`  school_users rows          : ${users.n}`);
  console.log(`  role_permissions rows      : ${perms.n}`);
  console.log(`  notification_preferences   : ${prefs.n}`);
  console.log(`  chat tables present        : ${tables.length} of 8`);
  console.log(`  safeguarding indexes       : ${indexes.length} of 2 — ${indexes.map((r) => r.indexname).join(', ') || '(none)'}`);
  console.log(`  chat_signals policies      : ${policies.length}`);
  console.log(`  new columns                : ${newCols.length} of 3 — ${newCols.map((c) => `${c.table_name}.${c.column_name}`).join(', ') || '(none)'}`);

  return {
    books: books.n,
    schools: schools.n,
    users: users.n,
    perms: perms.n,
    prefs: prefs.n,
    tables: tables.length,
    indexes: indexes.length,
    policies: policies.length,
    cols: newCols.length,
  };
};

const before = await census('BEFORE');

const started = Date.now();
await migrate(drizzle(client), { migrationsFolder: './db/migrations' });
console.log(`\nmigrator returned in ${((Date.now() - started) / 1000).toFixed(1)}s`);

const after = await census('AFTER');

console.log('\n--- deltas ---');
console.log(`  bookkeeping                : ${before.books} -> ${after.books} (expect +1)`);
console.log(`  schools rows               : ${before.schools} -> ${after.schools} (expect unchanged)`);
console.log(`  school_users rows          : ${before.users} -> ${after.users} (expect unchanged)`);
console.log(`  role_permissions rows      : ${before.perms} -> ${after.perms} (expect unchanged)`);
console.log(`  notification_preferences   : ${before.prefs} -> ${after.prefs} (expect unchanged)`);
console.log(`  chat tables                : ${before.tables} -> ${after.tables} (expect 8)`);
console.log(`  safeguarding indexes       : ${before.indexes} -> ${after.indexes} (expect 2)`);
console.log(`  chat_signals policies      : ${before.policies} -> ${after.policies} (expect 1)`);
console.log(`  new columns                : ${before.cols} -> ${after.cols} (expect 3)`);

await client.end();
