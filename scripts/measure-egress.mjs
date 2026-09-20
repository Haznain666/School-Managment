#!/usr/bin/env node

/**
 * Reads `pg_stat_statements` and answers the only two questions the Supabase
 * egress bill turns on: **how many connections has this application opened**,
 * and **what fraction of everything the database returned was application
 * data**.
 *
 *   node scripts/measure-egress.mjs            # print the numbers
 *   node scripts/measure-egress.mjs --reset    # print them, then reset the stats
 *
 * ── Why a connection count is a row count ────────────────────────────────
 * postgres-js bootstraps every **new** connection by asking the catalogue for
 * the oid of every array type:
 *
 *   select b.oid, b.typarray from pg_catalog.pg_type a
 *   left join pg_catalog.pg_type b on b.oid = a.typelem
 *   where a.typcategory = $1
 *
 * That returns ~446 rows on a stock Supabase database, and it runs exactly
 * once per connection. So its `calls` in `pg_stat_statements` **is** the
 * number of connections opened since the last stats reset, and its `rows` is
 * what those connections cost in egress before a single byte of school data
 * moved. On 2026-09-20 that one statement was 98.6% of everything the database
 * had returned in 58 days.
 *
 * Read-only unless `--reset` is passed. Nothing here writes a tenant row.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import postgres from 'postgres';

const RESET = process.argv.includes('--reset');

function databaseUrl() {
  for (const candidate of [
    fileURLToPath(new URL('../.env.local', import.meta.url)),
    'D:/School-Management-System/.env.local',
  ]) {
    try {
      const match = /^DATABASE_URL=(.*)$/m.exec(readFileSync(candidate, 'utf8'));
      if (match?.[1] !== undefined) {
        console.log(`  DATABASE_URL from ${candidate}`);
        return match[1].trim().replace(/^['"]|['"]$/g, '').replace(':6543/', ':5432/');
      }
    } catch {
      // Try the next candidate.
    }
  }
  throw new Error('DATABASE_URL not found — a worktree has no .env.local of its own');
}

const url = databaseUrl();
console.log(`  host: ${new URL(url).host}   mode: ${RESET ? 'PRINT THEN RESET' : 'read only'}\n`);

const sql = postgres(url, { max: 1, prepare: false, connect_timeout: 20 });

const num = (v) => Number(v ?? 0).toLocaleString('en-US');

try {
  const [info] = await sql`
    select stats_reset,
           round(extract(epoch from (now() - stats_reset)) / 86400.0, 2) as days
    from pg_stat_statements_info`;

  const [totals] = await sql`
    select sum(calls) as calls, sum(rows) as rows from pg_stat_statements`;

  const days = Number(info?.days ?? 0);

  console.log('── Window ──────────────────────────────────────────────────');
  console.log(`  stats reset        ${info?.stats_reset?.toISOString?.() ?? info?.stats_reset}`);
  console.log(`  age                ${days} days`);
  console.log(`  statements         ${num(totals?.calls)}`);
  console.log(`  rows returned      ${num(totals?.rows)}`);

  const [boot] = await sql`
    select coalesce(sum(calls), 0) as calls, coalesce(sum(rows), 0) as rows
    from pg_stat_statements
    where query like '%pg_catalog.pg_type%' and query like '%typcategory%'`;

  const connections = Number(boot?.calls ?? 0);
  const bootRows = Number(boot?.rows ?? 0);
  const totalRows = Number(totals?.rows ?? 0);

  console.log('\n── Connection churn ────────────────────────────────────────');
  console.log(`  connections opened ${num(connections)}`);
  console.log(`  per day            ${num(Math.round(connections / (days || 1)))}`);
  console.log(`  rows they returned ${num(bootRows)}  (${((100 * bootRows) / (totalRows || 1)).toFixed(2)}% of everything)`);
  console.log(`  rows per connect   ${connections === 0 ? 'n/a' : (bootRows / connections).toFixed(1)}`);

  const [auth] = await sql`
    select coalesce(sum(calls), 0) as calls from pg_stat_statements where query like '%get_auth%'`;
  console.log(`  pooler auths       ${num(auth?.calls)}`);

  console.log('\n── Top 10 statements by rows returned ──────────────────────');
  const top = await sql`
    select left(regexp_replace(query, '\s+', ' ', 'g'), 96) as q, calls, rows
    from pg_stat_statements order by rows desc limit 10`;
  for (const r of top) {
    console.log(`  ${String(num(r.rows)).padStart(13)} rows  ${String(num(r.calls)).padStart(9)} calls  ${r.q}`);
  }

  console.log('\n── Sweeps that find nothing ────────────────────────────────');
  const sweeps = await sql`
    select left(regexp_replace(query, '\s+', ' ', 'g'), 86) as q, calls, rows
    from pg_stat_statements
    where (query ilike '%email_outbox%' or query ilike '%late_fee_rules%'
        or query ilike '%announcements%' or query ilike '%academic_years%'
        or query ilike '%scheduler_leases%')
    order by calls desc limit 12`;
  for (const r of sweeps) {
    const perMin = days === 0 ? 0 : Number(r.calls) / (days * 1440);
    console.log(`  ${String(num(r.calls)).padStart(9)} calls  ${String(num(r.rows)).padStart(9)} rows  ${perMin.toFixed(2)}/min  ${r.q}`);
  }

  console.log('\n── Right now ───────────────────────────────────────────────');
  const [live] = await sql`
    select count(*) as total,
           count(*) filter (where state = 'active') as active,
           count(*) filter (where state = 'idle') as idle
    from pg_stat_activity where datname = current_database()`;
  console.log(`  backends           ${live.total} (${live.active} active, ${live.idle} idle)`);

  if (RESET) {
    await sql`select pg_stat_statements_reset()`;
    console.log('\n  pg_stat_statements RESET. The next reading starts from here.');
  }
} finally {
  await sql.end({ timeout: 10 });
}
