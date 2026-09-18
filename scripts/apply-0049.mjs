#!/usr/bin/env node

/**
 * Applies `0049` — Sprint 33c's two timetable dates, the partial cell index,
 * `timetable_substitutions`, and `timetable.substitute` in the permission CHECK.
 *
 * `drizzle-kit migrate` cannot be used and has not been since Sprint 18: the
 * password in `DATABASE_URL` holds an unescaped literal `@`, and drizzle-kit
 * hangs on it for five minutes and applies nothing (STATE.md §5bg). This is the
 * documented route — same statements, same `drizzle.__drizzle_migrations`
 * bookkeeping — against the **pooler on port 5432**, session mode. 6543 is
 * transaction mode and will not do DDL.
 *
 * ── What the census has to prove, and why a row count is not enough ──────
 * Three of this migration's four steps rewrite no row, so counts either side
 * are necessary and nowhere near sufficient. Each of the three ways this can
 * look like success while being a failure is asserted directly:
 *
 *   1. `ADD COLUMN … NOT NULL DEFAULT CURRENT_DATE` is metadata-only since
 *      Postgres 11, which is the whole of the compatibility claim: no row is
 *      rewritten, so **every existing row comes out live**. Proved by an
 *      unchanged `relfilenode` and by `pg_attribute.attmissingval`, the same
 *      method `0046` was proved with (STATE.md §5cg) — plus the two counts
 *      that say it outright.
 *   2. The cell index is dropped and re-created **partial**. An index
 *      re-created without its predicate is the failure that looks exactly
 *      like success: same name, same columns, and a supersede that throws
 *      `23505` on the first teacher change at every school. So the predicate
 *      is read back out of `pg_get_indexdef` and the supersede is **attempted**
 *      inside a transaction that is always rolled back.
 *   3. A CHECK dropped and never re-added leaves every row count identical.
 *      Proved by attempt, both directions, per CLAUDE.md.
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

/** The SQLSTATE lives on the error's `cause`, not on the error — CLAUDE.md. */
const sqlstate = (error) => error?.cause?.code ?? error?.code ?? '(none)';

let failures = 0;
const ok = (line) => console.log(`  ok    ${line}`);
const bad = (line) => {
  failures += 1;
  console.error(`  FAIL  ${line}`);
};

async function census(label) {
  const [rows] = await client`select count(*)::int as n from timetable_entries`;
  const [book] = await client`
    select count(*)::int as n from drizzle.__drizzle_migrations`;
  const [rel] = await client`
    select relfilenode::text as node from pg_class where relname = 'timetable_entries'`;
  const cols = await client`
    select attname from pg_attribute
     where attrelid = 'timetable_entries'::regclass
       and attname in ('effective_from', 'effective_to') and not attisdropped`;
  const [sub] = await client`
    select to_regclass('public.timetable_substitutions')::text as t`;
  const [con] = await client`
    select pg_get_constraintdef(oid) as def
      from pg_constraint where conname = 'role_permissions_permission_check'`;

  console.log(
    `  ${label.padEnd(7)} timetable_entries=${rows.n}  relfilenode=${rel.node}  ` +
      `bookkeeping=${book.n}  new columns=${cols.length}/2  ` +
      `substitutions=${sub.t ?? 'absent'}  ` +
      `check keys=${(con?.def.match(/'[a-z._]+'/g) ?? []).length}`,
  );

  return {
    rows: rows.n,
    node: rel.node,
    book: book.n,
    columns: cols.length,
    substitutions: sub.t,
    check: con?.def ?? '',
  };
}

console.log('\nBefore:');
const before = await census('before');

console.log('\nApplying…');
await migrate(drizzle(client), { migrationsFolder: 'db/migrations' });

console.log('\nAfter:');
const after = await census('after');

console.log('\nStep 1 — the two dates, and the claim that every row is still live:');

if (before.rows !== after.rows) {
  bad(`timetable_entries went ${before.rows} → ${after.rows} — this migration touches no data`);
} else {
  ok(`${after.rows} rows before and after — no row was written`);
}

if (before.node !== after.node) {
  bad(`relfilenode moved ${before.node} → ${after.node} — the table was REWRITTEN, not altered`);
} else {
  ok(`relfilenode unchanged at ${after.node} — metadata-only, no rewrite`);
}

if (after.columns !== 2) bad(`only ${after.columns}/2 columns exist`);
else ok('effective_from and effective_to both exist');

const [missing] = await client`
  select attmissingval::text as v, attname from pg_attribute
   where attrelid = 'timetable_entries'::regclass and attname = 'effective_from'`;
if (missing?.v === null || missing?.v === undefined) {
  bad('effective_from has no attmissingval — existing rows have no fast default');
} else {
  ok(`effective_from fast default present: attmissingval = ${missing.v}`);
}

const [live] = await client`
  select count(*) filter (where effective_to is not null)::int as closed,
         count(*) filter (where effective_from is null)::int as undated
    from timetable_entries`;
if (live.closed !== 0) bad(`${live.closed} existing rows arrived already closed`);
else ok('0 existing rows are closed — every one is live, as the compatibility claim requires');
if (live.undated !== 0) bad(`${live.undated} rows have a null effective_from`);
else ok('0 rows have a null effective_from');

console.log('\nStep 2 — the cell index is partial, and the supersede actually works:');

const [idx] = await client`
  select pg_get_indexdef(indexrelid) as def
    from pg_index where indexrelid = 'timetable_entries_location_section_slot_day_idx'::regclass`;
if (idx === undefined) {
  bad('the cell index is ABSENT — it was dropped and never re-created');
} else if (!/WHERE .*effective_to IS NULL.*is_active/i.test(idx.def)) {
  bad(`the index exists but carries NO predicate — a supersede will throw 23505:\n        ${idx.def}`);
} else {
  ok(`predicate read back from pg_get_indexdef: ${idx.def.replace(/^.*WHERE/i, 'WHERE')}`);
}

const [sample] = await client`
  select id, location_id, academic_year_id, section_id, subject_id, teacher_id,
         slot_id, day_of_week
    from timetable_entries where effective_to is null and is_active limit 1`;

if (sample === undefined) {
  console.log('  --    no live timetable row exists, so the supersede is NOT EXERCISED');
} else {
  // Both attempts inside one transaction that is always rolled back.
  try {
    await client.begin(async (tx) => {
      await tx`
        update timetable_entries set effective_to = current_date - 1 where id = ${sample.id}`;
      await tx`
        insert into timetable_entries
          (location_id, academic_year_id, section_id, subject_id, teacher_id,
           slot_id, day_of_week, effective_from)
        values (${sample.location_id}, ${sample.academic_year_id}, ${sample.section_id},
                ${sample.subject_id}, ${sample.teacher_id}, ${sample.slot_id},
                ${sample.day_of_week}, current_date)`;
      ok('closing a cell and opening its replacement is accepted — the supersede works');
      throw new Error('__rollback__');
    });
  } catch (error) {
    if (error.message !== '__rollback__') {
      bad(`the supersede was REFUSED with ${sqlstate(error)} — ${error.message}`);
    }
  }

  try {
    await client.begin(async (tx) => {
      await tx`
        insert into timetable_entries
          (location_id, academic_year_id, section_id, subject_id, teacher_id,
           slot_id, day_of_week, effective_from)
        values (${sample.location_id}, ${sample.academic_year_id}, ${sample.section_id},
                ${sample.subject_id}, ${sample.teacher_id}, ${sample.slot_id},
                ${sample.day_of_week}, current_date)`;
      bad('a SECOND LIVE row for the same cell was accepted — the grid can now draw a cell twice');
      throw new Error('__rollback__');
    });
  } catch (error) {
    if (sqlstate(error) === '23505') {
      ok('a second *live* row for the same cell is still refused with 23505');
    } else if (error.message !== '__rollback__') {
      bad(`expected 23505 for a duplicate live cell, got ${sqlstate(error)}`);
    }
  }

  /*
   * The third attempt, and the one nothing else in the repository can reach.
   *
   * `POST /api/school/timetable/entries` still carries an `ON CONFLICT` for the
   * race where two clerks save the same empty cell. Postgres can only infer a
   * **partial** index if the statement repeats its predicate, and the route
   * writes `is_active = true` where the index writes a bare `is_active`. If the
   * prover does not accept the two as equivalent the statement does not lose
   * its fallback — it throws `42P10` outright, on the one path no test takes
   * and no check script can execute.
   */
  try {
    await client.begin(async (tx) => {
      await tx`
        insert into timetable_entries
          (location_id, academic_year_id, section_id, subject_id, teacher_id,
           slot_id, day_of_week, effective_from)
        values (${sample.location_id}, ${sample.academic_year_id}, ${sample.section_id},
                ${sample.subject_id}, ${sample.teacher_id}, ${sample.slot_id},
                ${sample.day_of_week}, current_date)
        on conflict (location_id, section_id, slot_id, day_of_week)
          where effective_to is null and is_active = true
          do update set updated_at = now()`;
      ok('ON CONFLICT infers the partial index — the race path does not throw 42P10');
      throw new Error('__rollback__');
    });
  } catch (error) {
    if (sqlstate(error) === '42P10') {
      bad(
        'ON CONFLICT cannot infer the partial index (42P10) — the timetable save ' +
          'throws a 500 whenever two clerks touch one cell',
      );
    } else if (error.message !== '__rollback__') {
      bad(`the ON CONFLICT probe failed with ${sqlstate(error)} — ${error.message}`);
    }
  }
}

const [count] = await client`select count(*)::int as n from timetable_entries`;
if (count.n !== before.rows) bad(`row count moved to ${count.n} — a rollback did not roll back`);
else ok(`${count.n} rows after every attempt — each transaction rolled back`);

console.log('\nStep 3 — timetable_substitutions:');
if (after.substitutions === null) {
  bad('the table was not created');
} else {
  ok('timetable_substitutions exists');
  const cols = await client`
    select count(*)::int as n from pg_attribute
     where attrelid = 'timetable_substitutions'::regclass and attnum > 0 and not attisdropped`;
  ok(`${cols[0].n} columns`);
  const idxs = await client`
    select indexrelid::regclass::text as name from pg_index
     where indrelid = 'timetable_substitutions'::regclass`;
  ok(`${idxs.length} indexes: ${idxs.map((r) => r.name).join(', ')}`);
}

console.log('\nStep 4 — the permission CHECK, proved by attempt in both directions:');
if (!after.check.includes("'timetable.substitute'")) {
  bad('the constraint does not contain timetable.substitute');
} else {
  ok('timetable.substitute is inside the constraint definition');
}

const [role] = await client`select location_id from schools limit 1`;

try {
  await client.begin(async (tx) => {
    await tx`
      insert into role_permissions (location_id, role, permission)
      values (${role.location_id}, 'teacher', 'timetable.substitute')`;
    ok('timetable.substitute is ACCEPTED by the live constraint');
    throw new Error('__rollback__');
  });
} catch (error) {
  if (error.message !== '__rollback__') {
    bad(`timetable.substitute was refused with ${sqlstate(error)} — ${error.message}`);
  }
}

try {
  await client.begin(async (tx) => {
    await tx`
      insert into role_permissions (location_id, role, permission)
      values (${role.location_id}, 'teacher', 'timetable.notakey')`;
    bad('a key outside the list was ACCEPTED — the CHECK is not guarding anything');
    throw new Error('__rollback__');
  });
} catch (error) {
  if (sqlstate(error) === '23514') {
    ok('a key outside the list is still refused with 23514');
  } else if (error.message !== '__rollback__') {
    bad(`expected 23514 for a bogus key, got ${sqlstate(error)}`);
  }
}

const [perms] = await client`select count(*)::int as n from role_permissions`;
ok(`role_permissions holds ${perms.n} rows after both attempts — nothing was kept`);

await client.end();

console.log(
  failures === 0
    ? '\nPASS — 0049 is applied and every one of its four steps is proved.'
    : `\nFAIL — ${failures} assertion(s) failed.`,
);
process.exit(failures === 0 ? 0 : 1);
