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
 * `0041` adds three tables and five columns and rewrites no existing row, so
 * the census is the evidence and the exit code is not.
 *
 * The census counts the **publication membership** separately, because step 8
 * is the one statement here whose absence is silent: without `chat_signals` in
 * `supabase_realtime`, a browser subscribes successfully and then receives
 * nothing forever, with the poll fallback quietly covering for it.
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

const NEW_TABLES = ['chat_broadcasts', 'chat_attachments', 'push_subscriptions'];

const NEW_COLUMNS = [
  ['chat_settings', 'sound_enabled'],
  ['chat_conversations', 'broadcast_id'],
  ['notification_preferences', 'push_chat'],
  ['school_users', 'deactivated_at'],
  ['school_users', 'deactivated_reason'],
];

const census = async (label) => {
  const [books] = await client`select count(*)::int as n from drizzle.__drizzle_migrations`;
  const [newest] = await client`
    select id, created_at from drizzle.__drizzle_migrations order by id desc limit 1`;
  const [schools] = await client`select count(*)::int as n from schools`;
  const [users] = await client`select count(*)::int as n from school_users`;
  const [convos] = await client`select count(*)::int as n from chat_conversations`;
  const [messages] = await client`select count(*)::int as n from chat_messages`;

  const tables = await client`
    select table_name from information_schema.tables
     where table_schema = 'public' and table_name = any(${NEW_TABLES})
     order by table_name`;

  const columns = await client`
    select table_name, column_name from information_schema.columns
     where table_schema = 'public'
       and (table_name, column_name) in (
         ('chat_settings','sound_enabled'),
         ('chat_conversations','broadcast_id'),
         ('notification_preferences','push_chat'),
         ('school_users','deactivated_at'),
         ('school_users','deactivated_reason')
       )
     order by table_name, column_name`;

  const published = await client`
    select tablename from pg_publication_tables
     where pubname = 'supabase_realtime' and schemaname = 'public'
     order by tablename`;

  console.log(`\n--- ${label} ---`);
  console.log(`  __drizzle_migrations rows : ${books.n}`);
  console.log(`  newest entry              : id=${newest.id} created_at=${newest.created_at}`);
  console.log(`  schools rows              : ${schools.n}`);
  console.log(`  school_users rows         : ${users.n}`);
  console.log(`  chat_conversations rows   : ${convos.n}`);
  console.log(`  chat_messages rows        : ${messages.n}`);
  console.log(`  new tables present        : ${tables.length} of ${NEW_TABLES.length}`);
  console.log(`  new columns present       : ${columns.length} of ${NEW_COLUMNS.length}`);
  console.log(`  supabase_realtime tables  : ${published.map((r) => r.tablename).join(', ') || '(none)'}`);

  return {
    books: books.n,
    schools: schools.n,
    users: users.n,
    convos: convos.n,
    messages: messages.n,
    tables: tables.length,
    columns: columns.length,
    published: published.length,
  };
};

const before = await census('BEFORE');

const started = Date.now();
await migrate(drizzle(client), { migrationsFolder: './db/migrations' });
console.log(`\nmigrator returned in ${((Date.now() - started) / 1000).toFixed(1)}s`);

const after = await census('AFTER');

console.log('\n--- deltas ---');
console.log(`  bookkeeping             : ${before.books} -> ${after.books} (expect +1)`);
console.log(`  schools rows            : ${before.schools} -> ${after.schools} (expect unchanged)`);
console.log(`  school_users rows       : ${before.users} -> ${after.users} (expect unchanged)`);
console.log(`  chat_conversations rows : ${before.convos} -> ${after.convos} (expect unchanged)`);
console.log(`  chat_messages rows      : ${before.messages} -> ${after.messages} (expect unchanged)`);
console.log(`  new tables              : ${before.tables} -> ${after.tables} (expect 3)`);
console.log(`  new columns             : ${before.columns} -> ${after.columns} (expect 5)`);
console.log(`  realtime publication    : ${before.published} -> ${after.published} (expect >= 1, including chat_signals)`);

await client.end();
