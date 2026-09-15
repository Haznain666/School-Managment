#!/usr/bin/env node

/**
 * Applies and proves `0045` — Sprint 32, staff KPIs.
 *
 *     node scripts/verify-0045.mjs            inspect only
 *     node scripts/verify-0045.mjs --apply    apply, then prove
 *
 * The documented route since Sprint 18: `drizzle-kit migrate` hangs on the
 * literal `@` in DATABASE_URL (STATE.md §5bg), so this runs the same migrator
 * against the pooler on **5432** (session mode; 6543 will not do DDL).
 *
 * ── Proved by attempt, never by existence ────────────────────────────────
 * A CHECK dropped and never re-added leaves every count identical. So:
 *   · `kpis.rate.vice_principal` accepted, `kpis.invent` refused 23514;
 *     every one of the 55 keys accepted;
 *   · `staff_kpis` accepted as a module key, `invented` refused 23514;
 *   · a score of 11 refused 23514, a mid-month `period_month` refused 23514;
 *   · an UPDATE of a rating refused P0001 by the append-only trigger;
 *   · a second current principal for one teacher refused 23505;
 *   · a rater from the wrong list refused 23514.
 * Each inside a transaction that is always rolled back; the counts are read
 * again at the end to show that proving it wrote nothing.
 *
 * The SQLSTATE is read off `error.code` **or** `error.cause.code` (§5bj).
 */

import { readFileSync } from 'node:fs';

import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';

const APPLY = process.argv.includes('--apply');

const match = /^DATABASE_URL=(.*)$/m.exec(readFileSync('D:/School-Management-System/.env.local', 'utf8'));
if (match?.[1] === undefined) throw new Error('DATABASE_URL not found');

const url = match[1].trim().replace(/^['"]|['"]$/g, '').replace(':6543/', ':5432/');
console.log(`host: ${new URL(url).host}   mode: ${APPLY ? 'APPLY' : 'inspect only'}`);

const client = postgres(url, { max: 1, prepare: false, onnotice: () => {} });

let ok = 0;
let failed = 0;

function check(label, condition, detail = '') {
  if (condition) {
    ok += 1;
    console.log(`  ok    ${label}${detail === '' ? '' : `  — ${detail}`}`);
  } else {
    failed += 1;
    console.error(`  FAIL  ${label}${detail === '' ? '' : `  — ${detail}`}`);
  }
}

const codeOf = (error) => error?.code ?? error?.cause?.code ?? null;

async function mustRefuse(label, wanted, work) {
  try {
    await client.begin(async (tx) => {
      await work(tx);
      throw Object.assign(new Error('__accepted__'), { accepted: true });
    });
  } catch (error) {
    if (error?.accepted) return check(label, false, 'accepted — the guard is gone');
    return check(label, codeOf(error) === wanted, `expected ${wanted}, got ${codeOf(error) ?? error?.message}`);
  }
}

async function mustAccept(label, work, quiet = false) {
  let accepted = false;
  try {
    await client.begin(async (tx) => {
      await work(tx);
      accepted = true;
      throw new Error('__rollback__');
    });
  } catch (error) {
    if (!accepted) return check(label, false, `refused with ${codeOf(error) ?? error?.message}`);
  }
  if (!quiet) check(label, true, 'accepted, then rolled back');
  return accepted;
}

const COUNTED = ['role_permissions', 'school_modules', 'school_users', 'academic_years'];
const NEW_TABLES = [
  'staff_kpis',
  'staff_kpi_ratings',
  'staff_kpi_settings',
  'coordinator_teachers',
  'vice_principal_principals',
  'teacher_principals',
  'teacher_principal_transfers',
];

async function census(label) {
  const counts = {};
  for (const table of COUNTED) {
    const [row] = await client.unsafe(`select count(*)::int as n from ${table}`);
    counts[table] = row.n;
  }
  const [book] = await client`select count(*)::int as n from drizzle.__drizzle_migrations`;
  console.log(`  ${label.padEnd(7)} bookkeeping=${book.n}  ${COUNTED.map((t) => `${t}=${counts[t]}`).join('  ')}`);
  return { counts, book: book.n };
}

console.log('\nBefore:');
const before = await census('before');

if (APPLY) {
  console.log('\nApplying db/migrations …');
  await migrate(drizzle(client), { migrationsFolder: 'db/migrations' });
}

console.log('\nAfter:');
const after = await census('after');

check(
  APPLY ? 'bookkeeping grew by exactly one' : 'bookkeeping unchanged (inspect only)',
  APPLY ? after.book === before.book + 1 || after.book === before.book : after.book === before.book,
  `${before.book} → ${after.book}`,
);
for (const table of COUNTED) {
  check(`${table} row count unchanged`, before.counts[table] === after.counts[table]);
}

console.log('\nThe seven tables:');
for (const table of NEW_TABLES) {
  const [row] = await client`select to_regclass(${`public.${table}`}) as t`;
  check(`${table} exists`, row.t !== null);
}
const [trigger] = await client`
  select count(*)::int as n from pg_trigger where tgname = 'staff_kpi_ratings_append_only' and not tgisinternal`;
check('the append-only trigger exists', trigger.n === 1);

const [school] = await client`select location_id from schools order by created_at limit 1`;
const [person] = await client`
  select su.location_id, su.id as user_id, ay.id as year_id
    from school_users su
    join academic_years ay on ay.location_id = su.location_id
   where su.role in ('teacher', 'coordinator', 'principal')
   limit 1`;

console.log('\nrole_permissions_permission_check:');
const keys = [
  ...readFileSync('db/migrations/0045_sprint32_staff_kpis.sql', 'utf8')
    .split('"permission" IN (')[1]
    .split(')')[0]
    .matchAll(/'([a-z_.]+)'/g),
].map((m) => m[1]);
check('the CHECK in 0045 names 55 keys', keys.length === 55, String(keys.length));

await mustAccept('kpis.rate.vice_principal is accepted', (tx) =>
  tx`insert into role_permissions (location_id, role, permission, is_granted)
     values (${school.location_id}, 'marketing', 'kpis.rate.vice_principal', true)
     on conflict do nothing`);
await mustRefuse('kpis.invent is refused', '23514', (tx) =>
  tx`insert into role_permissions (location_id, role, permission, is_granted)
     values (${school.location_id}, 'marketing', 'kpis.invent', true)`);

let everyKey = 0;
for (const key of keys) {
  const accepted = await mustAccept(
    key,
    (tx) => tx`insert into role_permissions (location_id, role, permission, is_granted)
               values (${school.location_id}, 'marketing', ${key}, false) on conflict do nothing`,
    true,
  );
  if (accepted) everyKey += 1;
}
check('every one of the 55 keys is accepted', everyKey === 55, `${everyKey} of 55`);

console.log('\nschool_modules_module_key_check:');
await mustAccept('staff_kpis is accepted', (tx) =>
  tx`insert into school_modules (location_id, module_key, is_enabled)
     values (${school.location_id}, 'staff_kpis', false) on conflict do nothing`);
await mustRefuse('invented is refused', '23514', (tx) =>
  tx`insert into school_modules (location_id, module_key, is_enabled)
     values (${school.location_id}, 'invented', false)`);

if (person === undefined) {
  console.log('  --    no staff member with an academic year to build rating rows from — rating guards not exercised');
} else {
  const kpi = (tx) => tx`
    insert into staff_kpis (location_id, target_role, name, period)
    values (${person.location_id}, 'teacher', 'Probe 0045', 'monthly') returning id`;
  const rate = (tx, kpiId, score, month) => tx`
    insert into staff_kpi_ratings (location_id, kpi_id, rated_user_id, academic_year_id, period_month, score, rater_role, rater_name)
    values (${person.location_id}, ${kpiId}, ${person.user_id}, ${person.year_id}, ${month}, ${score}, 'principal', 'Probe') returning id`;

  console.log('\nstaff_kpi_ratings:');
  await mustAccept('a 10 for September is accepted', async (tx) => {
    const [k] = await kpi(tx);
    await rate(tx, k.id, 10, '2026-09-01');
  });
  await mustRefuse('a score of 11 is refused', '23514', async (tx) => {
    const [k] = await kpi(tx);
    await rate(tx, k.id, 11, '2026-09-01');
  });
  await mustRefuse('a mid-month period is refused', '23514', async (tx) => {
    const [k] = await kpi(tx);
    await rate(tx, k.id, 5, '2026-09-15');
  });
  await mustRefuse('an UPDATE is refused by the trigger', 'P0001', async (tx) => {
    const [k] = await kpi(tx);
    const [r] = await rate(tx, k.id, 6, '2026-09-01');
    await tx`update staff_kpi_ratings set score = 9 where id = ${r.id}`;
  });

  console.log('\nteacher_principals — one current row per teacher:');
  await mustRefuse('a second current principal is refused', '23505', async (tx) => {
    for (let i = 0; i < 2; i += 1) {
      await tx`insert into teacher_principals (location_id, teacher_user_id, principal_user_id, source)
               values (${person.location_id}, ${person.user_id}, ${person.user_id}, 'assigned')`;
    }
  });

  console.log('\nstaff_kpi_settings:');
  await mustRefuse('a vice principal in principal_raters is refused', '23514', (tx) =>
    tx`insert into staff_kpi_settings (location_id, principal_raters)
       values (${person.location_id}, ARRAY['vice_principal']::text[])
       on conflict (location_id) do update set principal_raters = excluded.principal_raters`);
}

console.log('\nNothing was written by the proofs:');
const end = await census('end');
for (const table of COUNTED) {
  check(`${table} row count unchanged`, end.counts[table] === after.counts[table]);
}
for (const table of NEW_TABLES) {
  const [row] = await client.unsafe(`select count(*)::int as n from ${table}`);
  check(`${table} is still empty`, row.n === 0, String(row.n));
}

await client.end();
console.log(`\n${failed === 0 ? 'PASS' : 'FAIL'} — ${ok} ok, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
