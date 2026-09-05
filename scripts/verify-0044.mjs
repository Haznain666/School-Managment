#!/usr/bin/env node

/**
 * Applies and proves `0044` — Sprint 28.
 *
 *     node scripts/verify-0044.mjs            inspect only
 *     node scripts/verify-0044.mjs --apply    apply, then prove
 *
 * `drizzle-kit migrate` cannot be used and has not been since Sprint 18: the
 * password in `DATABASE_URL` holds an unescaped literal `@` and drizzle-kit
 * hangs on it for five minutes and applies nothing (STATE.md §5bg). This is the
 * documented route — same statements, same `drizzle.__drizzle_migrations`
 * bookkeeping — against the **pooler on port 5432**, session mode. 6543 is
 * transaction mode and will not do DDL.
 *
 * ── What this migration is, and why existence proves nothing ─────────────
 * `0044` has exactly one effect: `role_permissions_permission_check` is dropped
 * and re-added with a 45th key, `fees.admission`. It creates no table, adds no
 * column and rewrites no row, so **every row count is identical either side by
 * construction** and a census can only ever confirm that nothing was damaged.
 *
 * That makes the usual evidence useless here. Worse, so does reading
 * `pg_constraint`: a constraint that was dropped and never re-added leaves
 * every count identical *and* every insert succeeding, which reads on any
 * dashboard as success; and a constraint that exists may still carry `0043`'s
 * list. Existence is not the question. The question is what it refuses.
 *
 * ── So it is proved by attempt, three ways ───────────────────────────────
 *   1. `fees.admission` must be **accepted** after the migration — the change
 *      itself.
 *   2. `fees.invent` must still be **refused with 23514** — the guard is still
 *      a guard, and was not simply dropped.
 *   3. Every one of the other 44 keys must still be accepted — a re-add that
 *      lost a key would be invisible until some school overrode that one
 *      permission, months later, on a screen that had never failed before.
 *
 * All of it inside transactions that are **always rolled back**, with the
 * `role_permissions` row count read a third time afterwards to show that
 * proving the constraint wrote nothing.
 *
 * ⚠ Two traps, both paid for by earlier sprints: the SQLSTATE is on the error's
 * `cause` and not on the error, so reading `.code` alone reports every failure
 * as unpredicted (STATE.md §5bj); and `check` must be given the *catalogue's*
 * answer rather than the migration's exit code, which says only that no
 * statement threw.
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

const client = postgres(url, { max: 1, prepare: false });

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

/**
 * The 45 keys `0044` must name, read out of the migration file itself.
 *
 * Read rather than retyped: a list typed twice is a list that will disagree
 * with itself, and the whole failure this script exists to catch is a key that
 * silently went missing from one of the two copies.
 */
const MIGRATION = readFileSync(
  'db/migrations/0044_admission_voucher_permission.sql',
  'utf8',
);
const EXPECTED_KEYS = [...MIGRATION.matchAll(/'([a-z]+\.[a-z]+)'/g)].map((m) => m[1]);

/** Only `role_permissions` can be touched by this migration, and must not be. */
const COUNTED = ['role_permissions'];

async function census(label) {
  const counts = {};
  for (const table of COUNTED) {
    const [row] = await client.unsafe(`select count(*)::int as n from ${table}`);
    counts[table] = row.n;
  }
  const [book] = await client`
    select count(*)::int as n from drizzle.__drizzle_migrations`;

  console.log(
    `  ${label.padEnd(7)} bookkeeping=${book.n}  ` +
      COUNTED.map((t) => `${t}=${counts[t]}`).join('  '),
  );
  return { counts, book: book.n };
}

/**
 * The definition of the CHECK as Postgres itself holds it, or null.
 *
 * `pg_get_constraintdef` rather than the source file: what the file says is
 * what was intended, and this is what is actually enforced.
 */
async function constraintDef() {
  const rows = await client`
    select pg_get_constraintdef(c.oid) as def
      from pg_constraint c
      join pg_class t on t.oid = c.conrelid
     where t.relname = 'role_permissions'
       and c.conname = 'role_permissions_permission_check'`;
  return rows[0]?.def ?? null;
}

/**
 * A tenant and role to hang the attempts on.
 *
 * `role_permissions` has a NOT NULL `location_id`, so the row has to be built
 * out of a real school rather than invented — `0043`'s own lesson, where two
 * CHECKs went unexercised because their tables were empty and reporting that
 * as a pass is what CLAUDE.md forbids.
 */
async function aRealSchool() {
  const rows = await client`select location_id from schools limit 1`;
  return rows[0]?.location_id ?? null;
}

/** Runs an insert that must be refused, and requires the exact SQLSTATE. */
async function mustRefuse(label, wanted, locationId, permission) {
  try {
    await client.begin(async (tx) => {
      await tx`
        insert into role_permissions (location_id, role, permission, is_granted)
        values (${locationId}, 'coordinator', ${permission}, true)`;
      throw new Error('__accepted__');
    });
    check(label, false, 'the statement was accepted');
  } catch (error) {
    const code = error?.code ?? error?.cause?.code ?? null;
    if (error?.message === '__accepted__') {
      check(label, false, 'the statement was accepted, so the guard is gone');
    } else {
      check(label, code === wanted, `expected ${wanted}, got ${code ?? error?.message}`);
    }
  }
}

/** Runs an insert that must be accepted, and always rolls it back. */
async function mustAccept(label, locationId, permission) {
  let accepted = false;
  try {
    await client.begin(async (tx) => {
      await tx`
        insert into role_permissions (location_id, role, permission, is_granted)
        values (${locationId}, 'coordinator', ${permission}, true)`;
      accepted = true;
      throw new Error('__rollback__');
    });
  } catch (error) {
    if (!accepted) {
      const code = error?.code ?? error?.cause?.code ?? null;
      check(label, false, `refused with ${code ?? error?.message}`);
      return false;
    }
  }
  if (accepted) check(label, true, 'accepted, then rolled back');
  return accepted;
}

console.log(`\nThe migration names ${String(EXPECTED_KEYS.length)} keys.`);
check(
  'the migration file names fees.admission',
  EXPECTED_KEYS.includes('fees.admission'),
);
check(
  'the migration file still names fees.write',
  EXPECTED_KEYS.includes('fees.write'),
);
check('45 keys, not 44', EXPECTED_KEYS.length === 45, String(EXPECTED_KEYS.length));

console.log('\nBefore:');
const before = await census('before');
const defBefore = await constraintDef();
console.log(
  `  the CHECK ${defBefore === null ? 'does NOT exist' : 'exists'}, and it ` +
    `${defBefore?.includes('fees.admission') ? 'ALREADY names' : 'does not name'} fees.admission`,
);

if (APPLY) {
  console.log('\nApplying db/migrations …');
  await migrate(drizzle(client), { migrationsFolder: 'db/migrations' });
}

console.log('\nAfter:');
const after = await census('after');

console.log('\nBookkeeping and row counts:');
check(
  APPLY ? 'bookkeeping grew by exactly one' : 'bookkeeping is unchanged',
  APPLY ? after.book === before.book + 1 : after.book === before.book,
  `${before.book} → ${after.book}`,
);
for (const table of COUNTED) {
  check(
    `${table} row count is unchanged`,
    before.counts[table] === after.counts[table],
    `${before.counts[table]} → ${after.counts[table]}`,
  );
}

console.log('\nThe constraint, read out of the catalogue rather than the file:');
const def = await constraintDef();
check('role_permissions_permission_check exists', def !== null);

const applied = def !== null && def.includes('fees.admission');
console.log(`  ${applied ? '0044 is APPLIED' : '0044 is NOT applied'}`);

if (def !== null) {
  const missing = EXPECTED_KEYS.filter((key) => !def.includes(`'${key}'`));
  check(
    'the enforced CHECK names every key the migration lists',
    applied ? missing.length === 0 : missing.length === 1,
    applied
      ? `missing: ${missing.join(', ') || 'none'}`
      : `before the migration exactly one key is missing, and it is fees.admission: [${missing.join(', ')}]`,
  );
}

console.log('\nProved by attempt, inside transactions that are always rolled back:');
const locationId = await aRealSchool();
check('a real school to hang the attempts on', locationId !== null, locationId ?? '');

if (locationId !== null) {
  if (applied) {
    await mustAccept('fees.admission is ACCEPTED, which is the whole migration', locationId, 'fees.admission');
  } else {
    await mustRefuse(
      'fees.admission is refused with 23514 — correct before the migration',
      '23514',
      locationId,
      'fees.admission',
    );
  }

  // The guard is still a guard. A dropped-and-not-re-added CHECK would accept
  // this, and nothing else in this script would notice.
  await mustRefuse('fees.invent is refused with 23514', '23514', locationId, 'fees.invent');

  // Every other key still accepted. A re-add that lost one would stay invisible
  // until a school happened to override that single permission.
  let survived = 0;
  for (const key of EXPECTED_KEYS) {
    if (key === 'fees.admission' && !applied) continue;
    let accepted = false;
    try {
      await client.begin(async (tx) => {
        await tx`
          insert into role_permissions (location_id, role, permission, is_granted)
          values (${locationId}, 'coordinator', ${key}, true)`;
        accepted = true;
        throw new Error('__rollback__');
      });
    } catch {
      /* always rolled back */
    }
    if (accepted) survived += 1;
    else console.error(`  FAIL  the CHECK refuses ${key}, which it must not`);
  }
  const wanted = applied ? EXPECTED_KEYS.length : EXPECTED_KEYS.length - 1;
  check(
    'every key in the list is accepted, one attempt each',
    survived === wanted,
    `${survived} of ${wanted}`,
  );
}

console.log('\nNothing was written by any of that:');
const third = await census('third');
check(
  'role_permissions row count is the same a third time',
  third.counts.role_permissions === before.counts.role_permissions,
  `${before.counts.role_permissions} → ${third.counts.role_permissions}`,
);

console.log(
  `\n${failed === 0 ? 'PASS' : 'FAIL'} — ${String(ok)} ok, ${String(failed)} failed`,
);

await client.end();
process.exit(failed === 0 ? 0 : 1);
