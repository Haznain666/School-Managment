#!/usr/bin/env node

/**
 * Applies and proves `0050` — Row Level Security on every public table.
 *
 * `drizzle-kit migrate` cannot be used and has not been since Sprint 18: the
 * password in `DATABASE_URL` holds an unescaped literal `@` and drizzle-kit
 * hangs on it for five minutes and applies nothing (STATE.md §5bg). This is the
 * documented route — same statements, same `drizzle.__drizzle_migrations`
 * bookkeeping — against the **pooler on port 5432**, session mode. 6543 is
 * transaction mode and will not do DDL.
 *
 * ── Why this one cannot be proved by reading ─────────────────────────────
 * `relrowsecurity = true` on 119 rows of `pg_class` is necessary and nowhere
 * near sufficient, for the same reason CLAUDE.md gives about a CHECK that was
 * dropped and never re-added: the catalogue reports the switch, not the
 * outcome. A table can carry RLS and still be wide open through a permissive
 * policy, and a REVOKE that silently did nothing leaves every catalogue row
 * looking exactly as it should.
 *
 * So the refusals are proved **by attempt**, inside transactions that are
 * always rolled back: `SET LOCAL ROLE anon`, then actually try to read a table
 * that holds children's records, and require the refusal.
 * `scripts/apply-0042.mjs` is the pattern; this points it at a role rather
 * than at a constraint.
 *
 * Three things are asserted in the other direction, because a lockdown that
 * breaks the product is not a fix:
 *
 *   - `postgres` still reads every table. It has `rolbypassrls`, which is what
 *     the whole application depends on and what makes this migration safe.
 *   - `chat_signals` keeps RLS, its `chat_signals_own` policy, and its SELECT
 *     grant to `authenticated` — revoke that and Realtime silently stops
 *     delivering, which is the one user-visible way this could go wrong.
 *   - `authenticated` reading `chat_signals` with no JWT returns zero rows
 *     rather than an error: the policy is filtering, the grant is not refusing.
 *
 * Run with `--apply` to migrate. Without it, it proves whatever is already
 * there, which is how you check the state before committing to a change.
 */

import { readFileSync } from 'node:fs';

import postgres from 'postgres';

const APPLY = process.argv.includes('--apply');

const MIGRATION =
  'D:/School-Management-System/.claude/worktrees/state-md-review-ff68c4/db/migrations/0050_rls_lockdown.sql';

const match = /^DATABASE_URL=(.*)$/m.exec(
  readFileSync('D:/School-Management-System/.env.local', 'utf8'),
);
if (match?.[1] === undefined) throw new Error('DATABASE_URL not found');

const url = match[1].trim().replace(/^['"]|['"]$/g, '').replace(':6543/', ':5432/');
console.log(`host: ${new URL(url).host}   mode: ${APPLY ? 'APPLY' : 'prove only'}\n`);

const sql = postgres(url, { max: 1, prepare: false });

let ok = 0;
let failed = 0;

function check(label, condition, detail = '') {
  if (condition) {
    ok += 1;
    console.log(`  PASS  ${label}`);
  } else {
    failed += 1;
    console.log(`  FAIL  ${label}${detail === '' ? '' : `  — ${detail}`}`);
  }
}

/** The SQLSTATE lives on the error's `cause`, not on the error. CLAUDE.md. */
function sqlstate(error) {
  return error?.code ?? error?.cause?.code ?? null;
}

const ROLLBACK = '__rollback__';

/**
 * Assume `role`, run `statement`, and roll the whole thing back whatever
 * happens. Answers with the SQLSTATE that refused it, the row count when it
 * was allowed through, or the string 'ALLOWED' for a statement returning none.
 *
 * `sql.begin` discards a callback's return value when we throw to roll back,
 * so the outcome is carried out in a closed-over variable rather than returned.
 */
async function attemptAs(role, statement) {
  let outcome = 'UNKNOWN';

  try {
    await sql.begin(async (tx) => {
      await tx.unsafe(`SET LOCAL ROLE "${role}"`);
      try {
        const rows = await tx.unsafe(statement);
        outcome = Array.isArray(rows) ? rows.length : 'ALLOWED';
      } catch (error) {
        outcome = sqlstate(error) ?? 'UNKNOWN';
      }
      throw new Error(ROLLBACK);
    });
  } catch (error) {
    if (!(error instanceof Error && error.message === ROLLBACK)) throw error;
  }

  return outcome;
}

// ── Before ────────────────────────────────────────────────────────────────
const before = await sql`
  select count(*)::int as total,
         count(*) filter (where c.relrowsecurity)::int as with_rls
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relkind in ('r','p')`;
console.log(`before: ${before[0].with_rls}/${before[0].total} public tables carry RLS`);
console.log(
  `before: anon reading student_profiles -> ${await attemptAs(
    'anon',
    'select 1 from public.student_profiles limit 1',
  )}\n`,
);

// ── Apply ─────────────────────────────────────────────────────────────────
if (APPLY) {
  const file = readFileSync(MIGRATION, 'utf8');
  const statements = file
    .split('--> statement-breakpoint')
    .map((s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*--.*$/gm, '').trim())
    .filter((s) => s !== '');

  console.log(`applying ${statements.length} statements…`);
  await sql.begin(async (tx) => {
    for (const statement of statements) await tx.unsafe(statement);
  });

  // Drizzle bookkeeping, so `db:generate` does not re-emit this migration.
  const hash = (await sql`select md5(${file}) as h`)[0].h;
  const already = await sql`select 1 from drizzle.__drizzle_migrations where hash = ${hash}`;
  if (already.length === 0) {
    await sql`
      insert into drizzle.__drizzle_migrations (hash, created_at)
      values (${hash}, ${Date.parse('2026-09-20T00:00:00Z')})`;
    console.log('recorded in drizzle.__drizzle_migrations');
  }
  console.log('applied\n');
}

// ── What the catalogue says ───────────────────────────────────────────────
console.log('── the catalogue ──');
const after = await sql`
  select count(*)::int as total,
         count(*) filter (where c.relrowsecurity)::int as with_rls
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relkind in ('r','p')`;
check(
  `RLS on every public table (${after[0].with_rls}/${after[0].total})`,
  after[0].with_rls === after[0].total,
);

const stray = await sql`
  select table_name, grantee, privilege_type
  from information_schema.role_table_grants
  where table_schema = 'public' and grantee in ('anon','authenticated')
    and table_name <> 'chat_signals'`;
check(
  `no grant left to anon/authenticated outside chat_signals (${stray.length} found)`,
  stray.length === 0,
  stray.slice(0, 5).map((r) => `${r.grantee}:${r.table_name}:${r.privilege_type}`).join(', '),
);

const signals = await sql`
  select c.relrowsecurity,
         (select count(*)::int from pg_policy p where p.polrelid = c.oid) as policies,
         (select count(*)::int from information_schema.role_table_grants g
           where g.table_schema = 'public' and g.table_name = 'chat_signals'
             and g.grantee = 'authenticated' and g.privilege_type = 'SELECT') as sel
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relname = 'chat_signals'`;
check('chat_signals still carries RLS', signals[0].relrowsecurity === true);
check('chat_signals still carries its policy', signals[0].policies === 1);
check('authenticated still holds SELECT on chat_signals (Realtime)', signals[0].sel === 1);

const fn = await sql`
  select p.proconfig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'staff_kpi_ratings_refuse_update'`;
check(
  'staff_kpi_ratings_refuse_update has a pinned search_path',
  (fn[0]?.proconfig ?? []).some((c) => c.startsWith('search_path=')),
);

// ── What an attempt says ──────────────────────────────────────────────────
console.log('\n── proved by attempt, every one rolled back ──');

const READS = [
  'student_profiles',
  'student_guardians',
  'fee_challans',
  'ledger_entries',
  'school_users',
  'chat_messages',
];
for (const table of READS) {
  const code = await attemptAs('anon', `select 1 from public.${table} limit 1`);
  check(`anon refused SELECT on ${table}`, code === '42501', `got ${code}`);
}
for (const table of ['student_profiles', 'fee_payments']) {
  const code = await attemptAs('authenticated', `select 1 from public.${table} limit 1`);
  check(`authenticated refused SELECT on ${table}`, code === '42501', `got ${code}`);
}

const del = await attemptAs('anon', 'delete from public.student_profiles where false');
check('anon refused DELETE on student_profiles', del === '42501', `got ${del}`);

const trunc = await attemptAs('anon', 'truncate public.attendance_records');
check('anon refused TRUNCATE on attendance_records', trunc === '42501', `got ${trunc}`);

// ── And what still works ──────────────────────────────────────────────────
console.log('\n── proved still working ──');
const appRows = await sql`select count(*)::int as n from public.student_profiles`;
check(
  `postgres — the application's own role — still reads student_profiles (${appRows[0].n} rows)`,
  appRows[0].n > 0,
);

const signalRead = await attemptAs('authenticated', 'select 1 from public.chat_signals limit 1');
check(
  'authenticated reads chat_signals without error — the policy filters, the grant allows',
  typeof signalRead === 'number',
  `got ${signalRead}`,
);

console.log(`\n${failed === 0 ? 'PASS' : 'FAIL'}  ${ok} passed, ${failed} failed`);
await sql.end();
process.exit(failed === 0 ? 0 : 1);
