#!/usr/bin/env node

/**
 * Applies `0042` — `chat.oversight` into the `role_permissions` CHECK.
 *
 * `drizzle-kit migrate` cannot be used and has not been since Sprint 18: the
 * password in `DATABASE_URL` holds an unescaped literal `@`, and drizzle-kit
 * hangs on it for five minutes and applies nothing (STATE.md §5bg). This is the
 * documented route — same statements, same `drizzle.__drizzle_migrations`
 * bookkeeping — against the **pooler on port 5432**, session mode. 6543 is
 * transaction mode and will not do DDL.
 *
 * ── What the census has to prove here ────────────────────────────────────
 * This migration rewrites no row, so a row count either side is necessary but
 * far from sufficient: a CHECK that was dropped and never re-added would leave
 * the counts identical and the table unguarded. So the constraint's own
 * definition is read back out of `pg_constraint`, and the two facts that matter
 * are asserted directly — that `chat.oversight` is now inside it, and that a
 * value outside it is still refused.
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

async function census(label) {
  const [rows] = await client`select count(*)::int as n from role_permissions`;
  const [book] = await client`
    select count(*)::int as n from drizzle.__drizzle_migrations`;
  const [con] = await client`
    select pg_get_constraintdef(oid) as def
      from pg_constraint where conname = 'role_permissions_permission_check'`;

  const hasOversight = con !== undefined && con.def.includes("'chat.oversight'");
  const keys = con === undefined ? 0 : (con.def.match(/'[a-z.]+'/g) ?? []).length;

  console.log(
    `  ${label.padEnd(7)} role_permissions=${rows.n}  bookkeeping=${book.n}  ` +
      `check keys=${keys}  chat.oversight=${hasOversight ? 'yes' : 'NO'}`,
  );
  return { rows: rows.n, book: book.n, hasOversight, keys };
}

console.log('\nBefore:');
const before = await census('before');

await migrate(drizzle(client), { migrationsFolder: 'db/migrations' });

console.log('\nAfter:');
const after = await census('after');

/* The row count must not have moved: this migration touches no data. */
if (before.rows !== after.rows) {
  console.error(`\nFAIL — role_permissions went ${before.rows} → ${after.rows}`);
  process.exit(1);
}

if (!after.hasOversight) {
  console.error('\nFAIL — the constraint does not contain chat.oversight');
  process.exit(1);
}

/*
 * The half a row count cannot show. A dropped-and-not-re-added CHECK leaves
 * every count identical, so the guard is proved by *attempt*: a bogus key must
 * still be refused with 23514, inside a transaction that is always rolled back.
 */
console.log('\nProving the constraint still refuses, rather than reading it:');

let refused = false;
try {
  await client.begin(async (tx) => {
    const [row] = await tx`select location_id from schools limit 1`;
    await tx`
      insert into role_permissions (location_id, role, permission, is_granted)
      values (${row.location_id}, 'teacher', 'chat.not_a_real_key', true)`;
    throw new Error('the insert was accepted, which means the CHECK is gone');
  });
} catch (error) {
  const code = error?.code ?? error?.cause?.code ?? null;
  if (code === '23514') {
    refused = true;
    console.log('  ok    a key outside the list was refused with 23514');
  } else {
    console.error(`  FAIL  expected 23514, got ${code ?? error?.message}`);
  }
}

/* And the new key must be accepted — the whole point of the migration. */
let accepted = false;
try {
  await client.begin(async (tx) => {
    const [row] = await tx`select location_id from schools limit 1`;
    await tx`
      insert into role_permissions (location_id, role, permission, is_granted)
      values (${row.location_id}, 'vice_principal', 'chat.oversight', true)`;
    accepted = true;
    console.log('  ok    chat.oversight was accepted');
    // Always rolled back: this script proves the constraint, it does not grant
    // anybody anything.
    throw new Error('rollback');
  });
} catch (error) {
  if (!accepted) {
    console.error(`  FAIL  chat.oversight was refused: ${error?.message}`);
  }
}

const [final] = await client`select count(*)::int as n from role_permissions`;
console.log(`\n  role_permissions back to ${final.n} row(s) — both attempts rolled back`);

await client.end();

const good = refused && accepted && final.n === before.rows;
console.log(good ? '\n0042 APPLIED AND PROVED\n' : '\n0042 FAILED\n');
process.exit(good ? 0 : 1);
