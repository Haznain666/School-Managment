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
 * `0039` is two `ADD COLUMN IF NOT EXISTS` and must rewrite nothing, so the
 * census is the evidence that matters: the row counts on `schools`, `staff` and
 * `principal_assignments` must be identical either side.
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

const census = async (label) => {
  const [books] = await client`select count(*)::int as n from drizzle.__drizzle_migrations`;
  const [newest] = await client`
    select id, hash, created_at from drizzle.__drizzle_migrations order by id desc limit 1`;
  const [schools] = await client`select count(*)::int as n from schools`;
  const [staff] = await client`select count(*)::int as n from staff`;
  const [pa] = await client`select count(*)::int as n from principal_assignments`;
  const cols = await client`
    select table_name, column_name from information_schema.columns
     where table_schema = 'public'
       and ((table_name = 'schools' and column_name = 'allow_shared_principal_grades')
         or (table_name = 'staff'   and column_name = 'photo_url'))
     order by table_name`;
  console.log(`\n--- ${label} ---`);
  console.log(`  __drizzle_migrations rows : ${books.n}`);
  console.log(`  newest entry              : id=${newest.id} created_at=${newest.created_at}`);
  console.log(`  schools rows              : ${schools.n}`);
  console.log(`  staff rows                : ${staff.n}`);
  console.log(`  principal_assignments rows: ${pa.n}`);
  console.log(`  0039 columns present      : ${cols.length === 0 ? '(none)' : cols.map((c) => `${c.table_name}.${c.column_name}`).join(', ')}`);
  return { books: books.n, schools: schools.n, staff: staff.n, pa: pa.n, cols: cols.length };
};

const before = await census('BEFORE');

const started = Date.now();
await migrate(drizzle(client), { migrationsFolder: './db/migrations' });
console.log(`\nmigrator returned in ${((Date.now() - started) / 1000).toFixed(1)}s`);

const after = await census('AFTER');

console.log('\n--- deltas ---');
console.log(`  bookkeeping           : ${before.books} -> ${after.books} (expect +1)`);
console.log(`  schools rows           : ${before.schools} -> ${after.schools} (expect unchanged)`);
console.log(`  staff rows             : ${before.staff} -> ${after.staff} (expect unchanged)`);
console.log(`  principal_assignments  : ${before.pa} -> ${after.pa} (expect unchanged)`);
console.log(`  0039 columns           : ${before.cols} -> ${after.cols} (expect 2)`);

await client.end();
