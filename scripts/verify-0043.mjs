#!/usr/bin/env node

/**
 * Applies and proves `0043` — Sprint 27.
 *
 * `drizzle-kit migrate` cannot be used and has not been since Sprint 18: the
 * password in `DATABASE_URL` holds an unescaped literal `@` and drizzle-kit
 * hangs on it for five minutes and applies nothing (STATE.md §5bg). This is the
 * documented route — same statements, same `drizzle.__drizzle_migrations`
 * bookkeeping — against the **pooler on port 5432**, session mode. 6543 is
 * transaction mode and will not do DDL.
 *
 * ── What a row count cannot prove, and what this does instead ────────────
 * `0043` rewrites no row, so identical counts either side are necessary and
 * nowhere near sufficient. Three of its statements fail *silently* if they go
 * wrong:
 *
 *   - `fee_challans_student_month_year_idx` is DROPped and re-created
 *     **partial**. A re-creation that lost its `WHERE` is still a unique index,
 *     still passes every row count, and still refuses to re-bill a month after
 *     a cancellation — which is the entire point of Part A. So `pg_index.indpred`
 *     is read, not the index's existence.
 *   - `late_fee_rules.auto_generate_vouchers` must default **false**. A `true`
 *     there starts raising vouchers for every parent at every school with no
 *     screen anywhere saying so.
 *   - `role_permissions_permission_check` dropped and not re-added leaves every
 *     count identical and the table unguarded.
 *
 * So every one of those is read out of the catalogue column by column, and the
 * constraints are proved **by attempt** inside transactions that are always
 * rolled back. `scripts/apply-0042.mjs` is the pattern; this widens it.
 *
 * Run with `--apply` to migrate. Without it, it censuses and proves whatever is
 * already there, which is how you check the state before committing to a change.
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

/** Row counts for every table `0043` touches. None of them may move. */
const COUNTED = [
  'fee_challans',
  'family_challans',
  'late_fee_rules',
  'payroll_runs',
  'payslips',
  'staff',
  'role_permissions',
];

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
 * Runs a statement that must be refused, and requires the exact SQLSTATE.
 *
 * ⚠ The SQLSTATE is on the error's `cause` and not on the error — reading
 * `.code` alone reports every failure as unpredicted. STATE.md §5bj, paid for.
 */
async function mustRefuse(label, wanted, work) {
  try {
    await client.begin(async (tx) => {
      await work(tx);
      throw new Error(`__accepted__`);
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

/** Runs a statement that must be accepted, and always rolls it back. */
async function mustAccept(label, work) {
  let accepted = false;
  try {
    await client.begin(async (tx) => {
      await work(tx);
      accepted = true;
      throw new Error('__rollback__');
    });
  } catch (error) {
    if (!accepted) {
      const code = error?.code ?? error?.cause?.code ?? null;
      check(label, false, `refused with ${code ?? error?.message}`);
      return;
    }
  }
  check(label, true, 'accepted, then rolled back');
}

console.log('\nBefore:');
const before = await census('before');

if (APPLY) {
  console.log('\nApplying db/migrations …');
  await migrate(drizzle(client), { migrationsFolder: 'db/migrations' });
}

console.log('\nAfter:');
const after = await census('after');

console.log('\nBookkeeping and row counts:');
check(
  'bookkeeping grew by exactly one',
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

// ── A1. The two partial unique indexes ───────────────────────────────────
console.log('\nA1 — the billing-document indexes, read as *partial* and not merely present:');

const indexes = await client`
  select i.relname as name,
         ix.indisunique as is_unique,
         ix.indpred is not null as is_partial,
         pg_get_expr(ix.indpred, ix.indrelid) as predicate
    from pg_index ix
    join pg_class i on i.oid = ix.indexrelid
   where i.relname in ('fee_challans_student_month_year_idx', 'family_challans_guardian_month_idx')`;

for (const name of [
  'fee_challans_student_month_year_idx',
  'family_challans_guardian_month_idx',
]) {
  const row = indexes.find((r) => r.name === name);
  check(`${name} exists`, row !== undefined);
  if (row !== undefined) {
    check(`${name} is UNIQUE`, row.is_unique === true);
    check(
      `${name} is PARTIAL — this is the whole of A1`,
      row.is_partial === true,
      row.predicate ?? 'no predicate',
    );
    check(
      `${name} excludes cancelled rows`,
      String(row.predicate ?? '').includes('cancelled'),
      row.predicate ?? '',
    );
  }
}

// ── A3. family_challans.origin ───────────────────────────────────────────
console.log('\nA3 — family_challans.origin:');

const [origin] = await client`
  select data_type, is_nullable, column_default
    from information_schema.columns
   where table_name = 'family_challans' and column_name = 'origin'`;

check('origin exists', origin !== undefined);
if (origin !== undefined) {
  check('origin is text', origin.data_type === 'text', origin.data_type);
  check('origin is NOT NULL', origin.is_nullable === 'NO', origin.is_nullable);
  check(
    "origin defaults to 'combined'",
    String(origin.column_default ?? '').includes('combined'),
    String(origin.column_default),
  );
}

/*
 * ⚠ `family_challans` is empty on this database, so there is no row to mutate.
 * Skipping would report the CHECK as unexercised, which is honest but useless —
 * this is the constraint that decides whether cancelling a voucher releases its
 * members or cancels them, and it has to be *proved*. So the row is built here,
 * inside the transaction that is about to be rolled back, out of real foreign
 * keys. If those do not exist either, that is reported as not-exercised rather
 * than passed.
 */
await mustRefuse("family_challans_origin_check refuses 'invented'", '23514', async (tx) => {
  const [ref] = await tx`
    select g.location_id, g.id as guardian_id,
           (select id from academic_years y where y.location_id = g.location_id limit 1) as year_id
      from student_guardians g limit 1`;
  if (ref?.year_id == null) {
    throw Object.assign(new Error('no guardian/academic year to build a row from'), {
      code: '__skipped__',
    });
  }
  await tx`
    insert into family_challans
      (location_id, guardian_id, academic_year_id, challan_number, due_date, total_amount, origin)
    values (${ref.location_id}, ${ref.guardian_id}, ${ref.year_id},
            'PROBE-0043', '2026-10-10', 0, 'invented')`;
});

// ── A5. The four auto-generation columns, one by one ─────────────────────
console.log('\nA5 — the auto-generation columns, each read individually:');

const autoCols = await client`
  select column_name, data_type, is_nullable, column_default
    from information_schema.columns
   where table_name = 'late_fee_rules'
     and column_name in ('auto_generate_vouchers', 'auto_generate_day',
                         'auto_generate_last_run_on', 'auto_generate_family_vouchers')
   order by column_name`;

const expected = {
  auto_generate_vouchers: { type: 'boolean', nullable: 'NO', dflt: 'false' },
  auto_generate_day: { type: 'integer', nullable: 'NO', dflt: '25' },
  auto_generate_last_run_on: { type: 'date', nullable: 'YES', dflt: null },
  auto_generate_family_vouchers: { type: 'boolean', nullable: 'NO', dflt: 'true' },
};

for (const [name, want] of Object.entries(expected)) {
  const row = autoCols.find((r) => r.column_name === name);
  check(`${name} exists`, row !== undefined);
  if (row === undefined) continue;
  check(`${name} is ${want.type}`, row.data_type === want.type, row.data_type);
  check(`${name} nullable = ${want.nullable}`, row.is_nullable === want.nullable, row.is_nullable);
  if (want.dflt === null) {
    check(`${name} has no default`, row.column_default === null, String(row.column_default));
  } else {
    check(
      `${name} defaults to ${want.dflt}`,
      String(row.column_default ?? '').includes(want.dflt),
      String(row.column_default),
    );
  }
}

/*
 * The one that would be a disaster read the other way round. Every school's
 * stored value is read, not just the column default: a default of false with a
 * row somehow holding true is a school that starts billing on a timer nobody
 * switched on.
 */
const [switchedOn] = await client`
  select count(*)::int as n from late_fee_rules where auto_generate_vouchers`;
check(
  'no school has auto-generation switched on',
  switchedOn.n === 0,
  `${switchedOn.n} school(s) — must be 0 the day this deploys`,
);

// ── B. The three new calendar tables ─────────────────────────────────────
console.log('\nB — the calendar tables:');

for (const table of [
  'holidays',
  'saturday_duty_policies',
  'holiday_notifications',
  'payroll_run_approvals',
]) {
  const [row] = await client`
    select count(*)::int as n from information_schema.tables
     where table_name = ${table} and table_schema = 'public'`;
  check(`${table} exists`, row.n === 1);
}

const [satOrdinals] = await client`
  select data_type, is_nullable, column_default
    from information_schema.columns
   where table_name = 'staff' and column_name = 'saturday_ordinals'`;

check('staff.saturday_ordinals exists', satOrdinals !== undefined);
if (satOrdinals !== undefined) {
  check('staff.saturday_ordinals is an array', satOrdinals.data_type === 'ARRAY', satOrdinals.data_type);
  check('staff.saturday_ordinals is nullable', satOrdinals.is_nullable === 'YES', satOrdinals.is_nullable);
  check(
    'staff.saturday_ordinals has NO default — null and {} must stay different',
    satOrdinals.column_default === null,
    String(satOrdinals.column_default),
  );
}

await mustRefuse('holidays_range_check refuses ends_on before starts_on', '23514', async (tx) => {
  const [school] = await tx`select location_id from schools limit 1`;
  await tx`
    insert into holidays (location_id, name, starts_on, ends_on, holiday_type)
    values (${school.location_id}, 'Backwards', '2026-10-10', '2026-10-01', 'public')`;
});

await mustRefuse('holidays_type_check refuses an invented type', '23514', async (tx) => {
  const [school] = await tx`select location_id from schools limit 1`;
  await tx`
    insert into holidays (location_id, name, starts_on, ends_on, holiday_type)
    values (${school.location_id}, 'Odd', '2026-10-01', '2026-10-01', 'bank_holiday')`;
});

await mustRefuse(
  'holidays_school_wide_idx refuses a second identical school-wide row with 23505',
  '23505',
  async (tx) => {
    const [school] = await tx`select location_id from schools limit 1`;
    await tx`
      insert into holidays (location_id, name, starts_on, ends_on, holiday_type)
      values (${school.location_id}, 'Seed Probe', '2026-08-14', '2026-08-14', 'public')`;
    await tx`
      insert into holidays (location_id, name, starts_on, ends_on, holiday_type)
      values (${school.location_id}, 'Seed Probe', '2026-08-14', '2026-08-14', 'public')`;
  },
);

// ── C. The payroll half ──────────────────────────────────────────────────
console.log('\nC — the payroll status, the approvals and the override:');

const overrideCols = await client`
  select column_name, data_type, is_nullable
    from information_schema.columns
   where table_name = 'payslips'
     and column_name in ('loss_of_pay_override', 'override_reason',
                         'overridden_by', 'overridden_at')
   order by column_name`;

check(
  'all four payslip override columns exist',
  overrideCols.length === 4,
  overrideCols.map((r) => r.column_name).join(', '),
);
for (const row of overrideCols) {
  check(`payslips.${row.column_name} is nullable`, row.is_nullable === 'YES', row.is_nullable);
}

const [runStatus] = await client`
  select pg_get_constraintdef(oid) as def
    from pg_constraint where conname = 'payroll_runs_status_check'`;
check('payroll_runs_status_check exists', runStatus !== undefined);
check(
  'payroll_runs_status_check lists pending_approval',
  String(runStatus?.def ?? '').includes('pending_approval'),
  String(runStatus?.def ?? '').slice(0, 120),
);

/*
 * Same reasoning as `family_challans` above, and the widened CHECK is the one
 * statement in Part C that a row count cannot see at all. Built rather than
 * skipped: `payroll_runs` needs only a school and a month.
 *
 * Both directions are proved — `pending_approval` must be *accepted*, or the
 * whole approval flow is a 23514 the first time a run is submitted, and
 * anything outside the five must still be refused.
 */
await mustAccept('payroll_runs accepts the new pending_approval status', async (tx) => {
  const [school] = await tx`select location_id from schools limit 1`;
  await tx`
    insert into payroll_runs (location_id, payroll_month, payroll_year, status)
    values (${school.location_id}, 10, 2026, 'pending_approval')`;
});

await mustRefuse('payroll_runs_status_check refuses a status outside the five', '23514', async (tx) => {
  const [school] = await tx`select location_id from schools limit 1`;
  await tx`
    insert into payroll_runs (location_id, payroll_month, payroll_year, status)
    values (${school.location_id}, 10, 2026, 'half_approved')`;
});

// ── The permission catalogue, proved by attempt ──────────────────────────
console.log('\nThe permission CHECK, proved by attempt rather than by reading it:');

const [permCheck] = await client`
  select pg_get_constraintdef(oid) as def
    from pg_constraint where conname = 'role_permissions_permission_check'`;

const keyCount = (String(permCheck?.def ?? '').match(/'[a-z_]+\.[a-z_]+'/g) ?? []).length;
check('role_permissions_permission_check exists', permCheck !== undefined);
check('it carries 44 keys', keyCount === 44, `${keyCount} keys`);

for (const key of ['calendar.manage', 'payroll.approve']) {
  await mustAccept(`${key} is accepted`, async (tx) => {
    const [school] = await tx`select location_id from schools limit 1`;
    await tx`
      insert into role_permissions (location_id, role, permission, is_granted)
      values (${school.location_id}, 'vice_principal', ${key}, true)`;
  });
}

await mustRefuse('a key outside the list is refused with 23514', '23514', async (tx) => {
  const [school] = await tx`select location_id from schools limit 1`;
  await tx`
    insert into role_permissions (location_id, role, permission, is_granted)
    values (${school.location_id}, 'teacher', 'fees.invent', true)`;
});

// ── Everything above was rolled back. Prove it. ──────────────────────────
console.log('\nResidue — every attempt above was inside a rolled-back transaction:');
const final = await census('final');
for (const table of COUNTED) {
  check(
    `${table} is back where it started`,
    final.counts[table] === before.counts[table],
    `${before.counts[table]} → ${final.counts[table]}`,
  );
}
const [holidayRows] = await client`select count(*)::int as n from holidays`;
check('holidays is empty — the probes left nothing', holidayRows.n === 0, `${holidayRows.n} row(s)`);

await client.end();

console.log(`\n${failed === 0 ? 'PASS' : 'FAIL'} — ${ok} ok, ${failed} failed\n`);
process.exit(failed === 0 ? 0 : 1);
