#!/usr/bin/env node

/**
 * Applies `0052` — Sprint 35: platform billing, the operators, the hand-off.
 *
 *   node scripts/apply-0052.mjs            # inspect only, changes nothing
 *   node scripts/apply-0052.mjs --apply    # apply and prove (owner seeded on first sign-in)
 *
 * `drizzle-kit migrate` cannot be used and has not been since Sprint 18: the
 * password in `DATABASE_URL` holds an unescaped literal `@`, and drizzle-kit
 * hangs on it (STATE.md §5bg). This is the documented route — same statements,
 * same `drizzle.__drizzle_migrations` bookkeeping — against the **pooler on
 * port 5432**, session mode. 6543 is transaction mode and will not do DDL.
 *
 * ── Why this script also seeds a row ─────────────────────────────────────
 * The owner, `haznain666@gmail.com`, is seeded here and not in the migration,
 * because the password hash lives in the environment and the migration is
 * committed to a public repository. The hash is read from the same two
 * variables `lib/super-admin-credentials.ts` reads — `SUPER_ADMIN_PASSWORD_HASH_B64`
 * first, then `SUPER_ADMIN_PASSWORD_HASH` — and repaired the same way, so the
 * owner's password after this is exactly the one that worked before it. Until
 * the row exists the table is empty, and an empty table is the case the login
 * falls back to the environment for: the owner is never locked out by the
 * order these two steps run in.
 *
 * ── What is proved, by attempt ───────────────────────────────────────────
 * A row count proves nothing about a constraint (CLAUDE.md). So, each inside a
 * transaction that is always rolled back:
 *
 *   · deleting the owner is refused — `P0001`, the trigger;
 *   · deactivating the owner is refused — `P0001`;
 *   · a second owner is refused — `23505`, the partial unique index;
 *   · an IBAN that is not Pakistani is refused — `23514`;
 *   · an environment that is neither sandbox nor live is refused — `23514`;
 *   · `central_login` is accepted by the throttle CHECK, and a bogus scope is
 *     still refused — `23514`;
 *
 * then that every school has a sandbox settings row and its three Phase 1
 * modules on, and that **no table in `public` is without RLS** — the property
 * `0050` established and every later table has to keep.
 */

import { readFileSync } from 'node:fs';

import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';

const APPLY = process.argv.includes('--apply');
const OWNER_EMAIL = 'haznain666@gmail.com';

const env = readFileSync('D:/School-Management-System/.env.local', 'utf8');
const read = (name) => {
  const found = new RegExp(`^${name}=(.*)$`, 'm').exec(env);
  return found?.[1]?.trim();
};

const match = read('DATABASE_URL');
if (match === undefined) throw new Error('DATABASE_URL not found');

const url = match.replace(/^['"]|['"]$/g, '').replace(':6543/', ':5432/');
console.log(`host: ${new URL(url).host}   mode: ${APPLY ? 'APPLY' : 'inspect only'}`);

/** Mirrors `normalizeBcryptHash` + `readConfiguredHash` in lib/super-admin-hash-shape.ts. */
function configuredHash() {
  const repair = (value) => {
    if (value === undefined) return undefined;
    let out = value.trim();
    if (out.length >= 2 && (out[0] === '"' || out[0] === "'") && out[0] === out[out.length - 1]) {
      out = out.slice(1, -1);
    }
    return out.replace(/\\(?=\$)/g, '');
  };

  const b64 = read('SUPER_ADMIN_PASSWORD_HASH_B64');
  if (b64 !== undefined && b64 !== '') {
    try {
      const decoded = Buffer.from(b64.replace(/^['"]|['"]$/g, ''), 'base64').toString('utf8').trim();
      if (decoded !== '') return repair(decoded);
    } catch {
      // fall through to the plain variable
    }
  }
  return repair(read('SUPER_ADMIN_PASSWORD_HASH'));
}

const client = postgres(url, { max: 1, prepare: false, connect_timeout: 20 });

let failed = 0;
function check(label, ok, detail = '') {
  if (ok) console.log(`  ok    ${label}${detail === '' ? '' : `  -- ${detail}`}`);
  else {
    failed += 1;
    console.error(`  FAIL  ${label}${detail === '' ? '' : `  -- ${detail}`}`);
  }
}

const TABLES = [
  'super_admin_users',
  'school_billing_settings',
  'school_role_rates',
  'school_module_rates',
  'platform_invoices',
  'platform_invoice_lines',
  'platform_invoice_discounts',
  'platform_invoice_receipts',
  'platform_invoice_emails',
  'platform_bank_accounts',
  'billing_reminders',
  'school_access_events',
  'login_handoff_tokens',
];

async function census(label) {
  const present = [];
  for (const table of TABLES) {
    const [row] = await client`select to_regclass(${`public.${table}`}) is not null as ok`;
    if (row.ok) present.push(table);
  }
  const [column] = await client`
    select count(*)::int as n from information_schema.columns
     where table_schema = 'public' and table_name = 'schools' and column_name = 'access_blocked_at'`;
  const [schools] = await client`select count(*)::int as n from schools`;
  const [book] = await client`select count(*)::int as n from drizzle.__drizzle_migrations`;

  console.log(
    `  ${label.padEnd(7)} new tables=${present.length}/${TABLES.length}  ` +
      `schools.access_blocked_at=${column.n === 1 ? 'present' : 'ABSENT'}  ` +
      `schools=${schools.n}  bookkeeping=${book.n}`,
  );
  return { tables: present.length, column: column.n === 1, schools: schools.n, book: book.n };
}

/** Runs `attempt` in a transaction that is always rolled back; returns the SQLSTATE or 'ok'. */
async function attempt(run) {
  let state = 'ok';
  try {
    await client.begin(async (tx) => {
      try {
        await run(tx);
      } catch (error) {
        state = error?.code ?? `threw: ${String(error?.message ?? error).slice(0, 80)}`;
      }
      throw new Error('__rollback__');
    });
  } catch (error) {
    if (error?.message !== '__rollback__') state = error?.code ?? String(error);
  }
  return state;
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

check('all thirteen tables exist', after.tables === TABLES.length, `${after.tables}/${TABLES.length}`);
check('schools.access_blocked_at exists', after.column);
check('the bookkeeping moved', after.book > before.book || before.tables === TABLES.length, `${before.book} -> ${after.book}`);

/* -- The owner ---------------------------------------------------------- */

// Not seeded by default. This script reads the LOCAL .env.local, and a
// production hash that differed from it would silently become the owner's
// password. The owner's row is seeded by the running deployment instead, on
// the owner's first sign-in after 0052 (seedOwnerFromEnvironment in
// lib/super-admin-accounts.ts), with the hash that deployment accepted.
// --seed-owner keeps the old behaviour for a local database.
console.log('\nThe owner:');
if (process.argv.includes('--seed-owner')) {
  const hash = configuredHash();
  if (hash === undefined || hash.length !== 60 || !hash.startsWith('$2')) {
    console.warn('  WARN  no well-formed SUPER_ADMIN_PASSWORD_HASH(_B64) in .env.local — not seeded.');
  } else {
    const seeded = await client`
      insert into super_admin_users (email, name, password_hash, is_owner, permissions, is_active)
      values (${OWNER_EMAIL}, 'Platform owner', ${hash}, true, '{}'::jsonb, true)
      on conflict (email) do nothing
      returning id`;
    console.log(`  --    ${seeded.length === 1 ? 'seeded' : 'already present'}: ${OWNER_EMAIL}`);
  }
} else {
  console.log('  --    not seeded here: the first owner sign-in on the deployment seeds it.');
}

const [owner] = await client`
  select id, email, is_owner, is_active from super_admin_users where is_owner`;
check(
  'at most one owner row, and if present it is active with the owner’s address',
  owner === undefined || (owner.email === OWNER_EMAIL && owner.is_active === true),
  owner?.email ?? '(none yet)',
);

/* -- Proved by attempt -------------------------------------------------- */

console.log('\nProved by attempt (every one rolled back):');

// Against the real owner when there is one, otherwise against a probe owner
// inserted inside the same rolled-back transaction.
const PROBE = 'apply-0052-owner-probe@sprint35.invalid';
const withOwner = (act) => async (tx) => {
  let id = owner?.id;
  if (id === undefined) {
    const [row] = await tx`insert into super_admin_users (email, name, password_hash, is_owner)
                           values (${PROBE}, 'probe', 'not-a-hash', true) returning id`;
    id = row.id;
  }
  await act(tx, id);
};

check(
  'deleting the owner is refused by the trigger',
  (await attempt(withOwner((tx, id) => tx`delete from super_admin_users where id = ${id}`))) === 'P0001',
);
check(
  'deactivating the owner is refused by the trigger',
  (await attempt(withOwner((tx, id) => tx`update super_admin_users set is_active = false where id = ${id}`))) === 'P0001',
);
check(
  'changing the owner’s email is refused by the trigger',
  (await attempt(withOwner((tx, id) => tx`update super_admin_users set email = 'someone@else.test' where id = ${id}`))) === 'P0001',
);
check(
  'a second owner is refused by the unique index',
  (await attempt(
    withOwner((tx) => tx`insert into super_admin_users (email, name, password_hash, is_owner)
                         values ('apply-0052-probe@sprint35.invalid', 'probe', 'not-a-hash', true)`),
  )) === '23505',
);

check(
  'a non-Pakistani IBAN is refused',
  (await attempt(
    (tx) => tx`insert into platform_bank_accounts (bank_name, account_title, account_number, iban, position)
               values ('Probe', 'Probe', '1', 'GB82WEST12345698765432', 1)`,
  )) === '23514',
);
check(
  'a fourth bank account slot is refused',
  (await attempt(
    (tx) => tx`insert into platform_bank_accounts (bank_name, account_title, account_number, iban, position)
               values ('Probe', 'Probe', '1', 'PK36SCBL0000001123456702', 4)`,
  )) === '23514',
);

const [anySchool] = await client`select location_id from schools limit 1`;
if (anySchool !== undefined) {
  check(
    'an environment that is neither sandbox nor live is refused',
    (await attempt((tx) => tx`update school_billing_settings set environment = 'staging' where location_id = ${anySchool.location_id}`)) === '23514',
  );
  check(
    'Live without a live_since is fine only in sandbox — sandbox with a date is refused',
    (await attempt((tx) => tx`update school_billing_settings set environment = 'sandbox', live_since = '2026-10-01' where location_id = ${anySchool.location_id}`)) === '23514',
  );
}

check(
  'the throttle accepts central_login',
  (await attempt((tx) => tx`insert into auth_attempts (scope, identifier, ip_hash, succeeded) values ('central_login', 'apply-0052', 'probe', false)`)) === 'ok',
);
check(
  'and still refuses a scope it does not know',
  (await attempt((tx) => tx`insert into auth_attempts (scope, identifier, ip_hash, succeeded) values ('bogus', 'apply-0052', 'probe', false)`)) === '23514',
);

/* -- The backfills ------------------------------------------------------ */

console.log('\nBackfills:');
const [settings] = await client`
  select count(*)::int as total, count(*) filter (where environment = 'sandbox')::int as sandbox
    from school_billing_settings`;
check('every school has a settings row', settings.total === after.schools, `${settings.total}/${after.schools}`);
check('and every one is sandbox (E8)', settings.sandbox === settings.total, `${settings.sandbox}/${settings.total}`);

const [phaseOne] = await client`
  select count(*)::int as n from school_modules
   where module_key in ('admissions', 'fee_management', 'academics') and is_enabled`;
check('Phase 1 is on for every school (E9)', phaseOne.n === after.schools * 3, `${phaseOne.n}/${after.schools * 3}`);

/* -- RLS ---------------------------------------------------------------- */

console.log('\nRow level security:');
const rls = await client`
  select c.relname, c.relrowsecurity as enabled
    from pg_class c join pg_namespace ns on ns.oid = c.relnamespace
   where ns.nspname = 'public' and c.relname = any(${TABLES})`;
check('RLS is on for all thirteen', rls.length === TABLES.length && rls.every((row) => row.enabled), rls.filter((row) => !row.enabled).map((row) => row.relname).join(', '));

const exposed = await client`
  select table_name, grantee, privilege_type from information_schema.role_table_grants
   where table_schema = 'public' and table_name = any(${TABLES}) and grantee in ('anon', 'authenticated')`;
check('anon and authenticated hold nothing on them', exposed.length === 0, exposed.map((r) => `${r.table_name}:${r.grantee}`).join(', '));

const [unprotected] = await client`
  select count(*)::int as n
    from pg_class c join pg_namespace ns on ns.oid = c.relnamespace
   where ns.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity`;
check('and no table in public is left without RLS', unprotected.n === 0, `${unprotected.n} unprotected`);

await client.end({ timeout: 10 });

if (failed > 0) {
  console.error(`\nFAIL -- ${failed} check(s) failed.`);
  process.exit(1);
}

console.log('\n0052 applied and proved by attempt.');
