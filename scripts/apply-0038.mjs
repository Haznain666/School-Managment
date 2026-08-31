#!/usr/bin/env node

/**
 * Applies pending migrations through drizzle-orm's own `postgres-js` migrator.
 *
 * `drizzle-kit migrate` cannot be used and has not been since Sprint 18: the
 * password in `DATABASE_URL` holds an unescaped literal `@`, and drizzle-kit
 * hangs on it for five minutes and applies nothing. This is the documented
 * route — same statements, same `drizzle.__drizzle_migrations` bookkeeping.
 *
 * Against the **pooler on port 5432**, session mode. 6543 is transaction mode
 * and will not do DDL, and the direct `db.<ref>.supabase.co` host is IPv6-only.
 * The port is rewritten here rather than in the env file so nothing else has to
 * change.
 *
 * Prints the bookkeeping row count either side, because that count — not the
 * absence of an error — is how every migration in this repository is verified.
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

const client = postgres(url, { max: 1, prepare: false });

const count = async () => {
  const rows = await client`select count(*)::int as n from drizzle.__drizzle_migrations`;
  return rows[0].n;
};

const before = await count();
console.log(`bookkeeping rows before: ${before}`);

await migrate(drizzle(client), { migrationsFolder: './db/migrations' });

const after = await count();
console.log(`bookkeeping rows after:  ${after}`);

const newest = await client`
  select id, created_at from drizzle.__drizzle_migrations order by id desc limit 1`;
console.log(`newest entry: id=${newest[0].id} when=${newest[0].created_at}`);

await client.end();
