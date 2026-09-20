#!/usr/bin/env node

/**
 * Applies `0051` — the scheduler lease.
 *
 *   node scripts/apply-0051.mjs            # inspect only, changes nothing
 *   node scripts/apply-0051.mjs --apply    # apply and prove
 *
 * `drizzle-kit migrate` cannot be used and has not been since Sprint 18: the
 * password in `DATABASE_URL` holds an unescaped literal `@`, and drizzle-kit
 * hangs on it for five minutes and applies nothing (STATE.md §5bg). This is the
 * documented route — same statements, same `drizzle.__drizzle_migrations`
 * bookkeeping — against the **pooler on port 5432**, session mode. 6543 is
 * transaction mode and will not do DDL.
 *
 * -- What has to be proved here, and why a row count cannot do it ---------
 * `0051` creates one empty table. Counting rows either side proves nothing at
 * all: the count is zero before, zero after, and would be zero if the file had
 * created nothing. CLAUDE.md is explicit that a constraint is proved by
 * *attempt*, and the same applies to a table: what matters is not that it
 * exists but that **the statement the application will run against it
 * behaves**. So after applying, this:
 *
 *   1. reads the table's columns back out of `information_schema`;
 *   2. drives three contenders at one test lease and requires exactly one to
 *      win — the whole mechanism, attempted rather than read;
 *   3. expires the lease and requires exactly one to take it over;
 *   4. deletes everything it wrote, under a `apply-0051:` name that no server
 *      process uses.
 *
 * No tenant row is read or written. `scheduler_leases` holds no school's data
 * — see the migration's header for why it is the one table here with no
 * `location_id`.
 */

import { readFileSync } from 'node:fs';

import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';

const APPLY = process.argv.includes('--apply');

const match = /^DATABASE_URL=(.*)$/m.exec(
  readFileSync('D:/School-Management-System/.env.local', 'utf8'),
);
if (match?.[1] === undefined) throw new Error('DATABASE_URL not found');

const url = match[1].trim().replace(/^['"]|['"]$/g, '').replace(':6543/', ':5432/');
console.log(`host: ${new URL(url).host}   mode: ${APPLY ? 'APPLY' : 'inspect only'}`);

const client = postgres(url, { max: 1, prepare: false, connect_timeout: 20 });

let failed = 0;
function check(label, ok, detail = '') {
  if (ok) console.log(`  ok    ${label}${detail === '' ? '' : `  -- ${detail}`}`);
  else {
    failed += 1;
    console.error(`  FAIL  ${label}${detail === '' ? '' : `  -- ${detail}`}`);
  }
}

async function census(label) {
  const [present] = await client`
    select to_regclass('public.scheduler_leases') is not null as ok`;
  const [book] = await client`
    select count(*)::int as n from drizzle.__drizzle_migrations`;
  const rows = present.ok
    ? (await client`select count(*)::int as n from scheduler_leases`)[0].n
    : null;

  console.log(
    `  ${label.padEnd(7)} scheduler_leases=${present.ok ? 'present' : 'ABSENT'}  ` +
      `leases=${rows === null ? '-' : rows}  bookkeeping=${book.n}`,
  );
  return { present: present.ok, rows, book: book.n };
}

console.log('\nBefore:');
const before = await census('before');

if (!APPLY) {
  console.log('\n  Inspect only. Nothing was changed. Re-run with --apply.');
  await client.end({ timeout: 10 });
  process.exit(0);
}

await migrate(drizzle(client), { migrationsFolder: 'db/migrations' });

console.log('\nAfter:');
const after = await census('after');

check('the table exists', after.present);
check(
  'the bookkeeping moved',
  after.book > before.book || before.present,
  `${before.book} -> ${after.book}`,
);

/* The columns, read back rather than assumed. */
const columns = await client`
  select column_name, data_type, is_nullable
    from information_schema.columns
   where table_schema = 'public' and table_name = 'scheduler_leases'
   order by ordinal_position`;

const names = columns.map((c) => c.column_name).join(', ');
check(
  'it has the five columns the code writes',
  ['name', 'owner', 'acquired_at', 'renewed_at', 'expires_at'].every((c) =>
    columns.some((row) => row.column_name === c),
  ),
  names,
);

check(
  'and no location_id -- it is a lock between processes, not a school\u2019s data',
  !columns.some((row) => row.column_name === 'location_id'),
);

/*
 * -- RLS, because 0050 ran before this table existed ----------------------
 * `0050_rls_lockdown` enumerated the 118 tables that were unprotected when it
 * was written. This one is created afterwards, so without the two statements
 * at the end of `0051` it is the ONE table in `public` with RLS off -- the
 * single exception in a posture whose whole value is having none.
 *
 * Read back from the catalogue rather than assumed, and `anon`'s grants are
 * counted rather than argued about. The last check is the one that matters
 * next time: it asserts the property for the whole schema, so the next table
 * somebody adds without RLS fails here too.
 */
const [rls] = await client`
  select c.relrowsecurity as enabled
    from pg_class c join pg_namespace ns on ns.oid = c.relnamespace
   where ns.nspname = 'public' and c.relname = 'scheduler_leases'`;

check('RLS is enabled on it, like every other public table', rls?.enabled === true);

const exposed = await client`
  select grantee, privilege_type
    from information_schema.role_table_grants
   where table_schema = 'public' and table_name = 'scheduler_leases'
     and grantee in ('anon', 'authenticated')`;

check(
  'anon and authenticated hold no privilege on it',
  exposed.length === 0,
  exposed.map((r) => `${r.grantee}:${r.privilege_type}`).join(', '),
);

const [unprotected] = await client`
  select count(*)::int as n
    from pg_class c join pg_namespace ns on ns.oid = c.relnamespace
   where ns.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity`;

check(
  'and no table in public is left without RLS',
  unprotected.n === 0,
  `${unprotected.n} table(s) still unprotected`,
);

/* -- The mechanism, attempted ------------------------------------------- */

const LEASE = 'apply-0051:probe';
const OWNERS = ['apply-0051:a', 'apply-0051:b', 'apply-0051:c'];

/*
 * -- ISO strings, not Dates, and CLAUDE.md predicted this exactly ---------
 * The first version of this probe interpolated `Date` objects straight into
 * the template and died with
 *
 *   The "string" argument must be of type string ... Received an instance of
 *   Date [ERR_INVALID_ARG_TYPE]
 *
 * naming neither the column nor the file. That is the rule "a value never
 * reaches the driver through a raw sql template", demonstrated: postgres-js
 * gets the JavaScript value with no column to map it against.
 *
 * `lib/scheduler.ts` does not have the problem because it builds the same
 * statement with Drizzle's `eq`/`lt`, which go through the column's
 * `mapToDriverValue` first. A hand-written `.mjs` has no column to go
 * through, so it formats the value itself and says what type it is.
 */
async function claim(owner, now, ttlSeconds) {
  const at = now.toISOString();
  const expires = new Date(now.getTime() + ttlSeconds * 1000).toISOString();
  const won = await client`
    INSERT INTO scheduler_leases (name, owner, acquired_at, renewed_at, expires_at)
    VALUES (${LEASE}, ${owner}, ${at}::timestamptz, ${at}::timestamptz, ${expires}::timestamptz)
    ON CONFLICT (name) DO UPDATE
       SET owner = ${owner},
           renewed_at = ${at}::timestamptz,
           expires_at = ${expires}::timestamptz
     WHERE scheduler_leases.owner = ${owner}
        OR scheduler_leases.expires_at < ${at}::timestamptz
    RETURNING owner`;
  return won.length > 0;
}

await client`delete from scheduler_leases where name like 'apply-0051:%'`;

const now = new Date();
const first = await Promise.all(OWNERS.map(async (o) => ({ o, won: await claim(o, now, 120) })));
const winners = first.filter((r) => r.won).map((r) => r.o);

check(
  'exactly one of three contenders takes a free lease',
  winners.length === 1,
  `won: ${winners.join(', ') || '(nobody)'}`,
);

await client`
  update scheduler_leases set expires_at = now() - interval '1 minute' where name = ${LEASE}`;

const takeoverAt = new Date();
const second = await Promise.all(
  OWNERS.map(async (o) => ({ o, won: await claim(o, takeoverAt, 120) })),
);
const takers = second.filter((r) => r.won).map((r) => r.o);

check(
  'exactly one of three takes over an expired lease',
  takers.length === 1,
  `took it: ${takers.join(', ') || '(nobody)'}`,
);

const removed = await client`
  delete from scheduler_leases where name like 'apply-0051:%' returning name`;
check('the probe rows are gone', removed.length > 0, `${removed.length} deleted`);

const [live] = await client`select count(*)::int as n from scheduler_leases`;
console.log(
  `\n  scheduler_leases now holds ${live.n} row(s)` +
    (live.n === 0 ? " -- no process has ticked yet; the first one claims 'sweeps'" : ''),
);

await client.end({ timeout: 10 });

if (failed > 0) {
  console.error(`\nFAIL -- ${failed} check(s) failed.`);
  process.exit(1);
}

console.log('\n0051 applied and proved by attempt.');
