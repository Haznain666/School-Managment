#!/usr/bin/env node

/**
 * Applies and proves `0049` — Sprint 33c, the portal work.
 *
 *     node scripts/verify-0049.mjs            inspect only, writes nothing
 *     node scripts/verify-0049.mjs --apply    apply, then prove
 *
 * The documented route since Sprint 18 (STATE.md §5bg): `drizzle-kit migrate`
 * hangs on the literal `@` in DATABASE_URL, so this runs drizzle-orm's own
 * migrator — same statements, same `drizzle.__drizzle_migrations` bookkeeping —
 * against the **pooler on 5432**, session mode. 6543 is transaction mode and
 * will not do DDL.
 *
 * That migrator wraps every pending file *and* the bookkeeping insert in one
 * `session.transaction` (pg-core/dialect.cjs). So `0049`'s DROP INDEX and its
 * partial CREATE commit together and no concurrent transaction ever sees the
 * cell unguarded — which is also why `CONCURRENTLY` would be wrong here: it
 * cannot run inside a transaction block. Do **not** apply this file by pasting
 * its statements into the SQL editor one at a time; that is the version with
 * the window.
 *
 * ── What has to be proved, and why a row count proves none of it ─────────
 *   1. two columns, `NOT NULL DEFAULT CURRENT_DATE`. The claim is
 *      metadata-only — no rewrite, every existing row live. The proof is
 *      `relfilenode` unchanged plus `pg_attribute.attmissingval` (the method
 *      §5cg used for `0046`), then the counts that say no row came out closed;
 *   2. the unique index re-created **partial**. Without its predicate it looks
 *      exactly like success — same name, same columns, `indisunique` true —
 *      and the first supersede at every school is a `23505`. So the predicate
 *      is read back out of `pg_get_indexdef` and then *driven*;
 *   3. `timetable_substitutions` — five FKs, two CHECKs, five indexes, each
 *      proved by attempt rather than by existence;
 *   4. the permission CHECK. CLAUDE.md: *a CHECK dropped and never re-added
 *      leaves every row count identical*.
 *
 * Every attempt runs inside a transaction that is **always rolled back**, and
 * the census is read a third time to show the proofs wrote nothing.
 *
 * ── The deploy-order window, executed rather than argued ─────────────────
 * The migration header claims the old code "behaves identically" against the
 * new schema. That is true of every read and **false of the one write path**:
 * `main`'s deployed route sends a bare `ON CONFLICT (…)` with no `targetWhere`,
 * and a partial index cannot be inferred without its predicate. Both forms are
 * attempted below — the new route's must be accepted, the old route's must
 * fail `42P10` — so the window is a measured fact rather than a paragraph.
 *
 * ── The two traps CLAUDE.md names ────────────────────────────────────────
 * The SQLSTATE is on the error's `cause`, not on the error. And a check that
 * short-circuits — no school, no timetable row — is reported as **not
 * exercised**, never as a pass.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';

const APPLY = process.argv.includes('--apply');

/** Resolved off this file, so it runs from any cwd and from any worktree. */
const MIGRATIONS = fileURLToPath(new URL('../db/migrations', import.meta.url));
const MIGRATION_FILE = `${MIGRATIONS}/0049_sprint33c_portal_work.sql`;
const JOURNAL = `${MIGRATIONS}/meta/_journal.json`;
const TAG = '0049_sprint33c_portal_work';

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
console.log(`  host: ${new URL(url).host}   mode: ${APPLY ? 'APPLY' : 'inspect only'}`);

const client = postgres(url, {
  max: 1,
  prepare: false,
  onnotice: (n) => console.log(`  notice: ${n.message}`),
});

let ok = 0;
let failed = 0;
const notExercised = [];
const warnings = [];

function check(label, condition, detail = '') {
  if (condition) {
    ok += 1;
    console.log(`  ok    ${label}${detail === '' ? '' : `  — ${detail}`}`);
  } else {
    failed += 1;
    console.error(`  FAIL  ${label}${detail === '' ? '' : `  — ${detail}`}`);
  }
}

function skip(label, why) {
  notExercised.push(`${label} — ${why}`);
  console.log(`  --    ${label}  — NOT EXERCISED: ${why}`);
}

function warn(label, detail) {
  warnings.push(`${label} — ${detail}`);
  console.log(`  warn  ${label}  — ${detail}`);
}

/** Trap 1: the SQLSTATE is on the cause chain, not on the error. */
function sqlState(error) {
  let current = error;
  for (let depth = 0; depth < 6 && current != null; depth += 1) {
    const code = current.code;
    if (typeof code === 'string' && /^[0-9A-Z]{5}$/.test(code)) return code;
    current = current.cause;
  }
  return null;
}

/** The reason, without postgres-js's copy of the whole statement. */
function reason(error) {
  let current = error;
  for (let depth = 0; depth < 6 && current != null; depth += 1) {
    const message = current.message;
    if (typeof message === 'string' && !message.startsWith('Failed query')) {
      return (message.split('\n')[0] ?? message).slice(0, 160);
    }
    current = current.cause;
  }
  return String(error).slice(0, 160);
}

async function mustRefuse(label, wanted, work) {
  try {
    await client.begin(async (tx) => {
      await work(tx);
      throw Object.assign(new Error('__accepted__'), { accepted: true });
    });
  } catch (error) {
    if (error?.accepted === true) return check(label, false, 'accepted — the guard is gone');
    const code = sqlState(error);
    return check(label, code === wanted, `expected ${wanted}, got ${code ?? reason(error)}`);
  }
  return check(label, false, 'accepted — the guard is gone');
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
    if (!accepted) {
      check(label, false, `refused with ${sqlState(error) ?? reason(error)}`);
      return false;
    }
  }
  if (!quiet) check(label, true, 'accepted, then rolled back');
  return accepted;
}

async function schemaState() {
  const [cols] = await client`
    select count(*) filter (where attname = 'effective_from')::int as ef,
           count(*) filter (where attname = 'effective_to')::int   as et
      from pg_attribute
     where attrelid = 'public.timetable_entries'::regclass
       and attnum > 0 and not attisdropped`;

  const idx = await client`
    select pg_get_indexdef(i.indexrelid) as def,
           i.indisunique, i.indisvalid, i.indpred is not null as partial
      from pg_index i
     where i.indexrelid = to_regclass('public.timetable_entries_location_section_slot_day_idx')`;

  const [subs] = await client`
    select to_regclass('public.timetable_substitutions') is not null as present`;

  const con = await client`
    select pg_get_constraintdef(oid) as def
      from pg_constraint where conname = 'role_permissions_permission_check'`;

  return {
    columns: cols.ef === 1 && cols.et === 1,
    columnDetail: `effective_from=${cols.ef} effective_to=${cols.et}`,
    index: idx[0] ?? null,
    subs: subs.present === true,
    checkDef: con[0]?.def ?? null,
  };
}

async function census(label) {
  const [row] = await client`
    select (select relfilenode from pg_class where oid = 'public.timetable_entries'::regclass) as relfilenode,
           pg_relation_size('public.timetable_entries') as bytes,
           (select count(*) from timetable_entries)::int as entries,
           (select count(*) from role_permissions)::int  as perms,
           (select count(*) from drizzle.__drizzle_migrations)::int as book,
           (select coalesce(max(created_at), 0) from drizzle.__drizzle_migrations) as newest`;

  console.log(
    `  ${label.padEnd(7)} relfilenode=${row.relfilenode}  bytes=${row.bytes}  ` +
      `timetable_entries=${row.entries}  role_permissions=${row.perms}  ` +
      `bookkeeping=${row.book}  newest=${row.newest}`,
  );
  return row;
}

const [env] = await client`
  select version() as version, current_setting('TimeZone') as tz, current_date::text as today`;
const utcToday = new Date().toISOString().slice(0, 10);
console.log(`\n  ${env.version.split(',')[0]}`);
console.log(`  server TimeZone=${env.tz}  CURRENT_DATE=${env.today}  node UTC=${utcToday}`);

/*
 * `timetableToday()` is UTC and the column default is the *server's*
 * CURRENT_DATE. If those name different days, a row inserted without an
 * explicit `effective_from` is invisible to `liveTimetableEntries` until the
 * clocks agree. The route always passes the value, so this is a warning and
 * not a gate — but it is the kind of thing nobody notices later.
 */
if (env.today === utcToday) {
  console.log('  ok    the server date and the application UTC date are the same day');
} else {
  warn(
    'the server date and the application UTC date differ',
    `server ${env.today} (${env.tz}) vs UTC ${utcToday}`,
  );
}

console.log('\nBefore:');
const before = await census('before');
const stateBefore = await schemaState();
console.log(
  `  columns=${stateBefore.columns ? 'yes' : 'no'} (${stateBefore.columnDetail})  ` +
    `index=${stateBefore.index === null ? 'ABSENT' : stateBefore.index.partial ? 'partial' : 'plain'}  ` +
    `timetable_substitutions=${stateBefore.subs ? 'yes' : 'no'}  ` +
    `timetable.substitute=${stateBefore.checkDef?.includes("'timetable.substitute'") ? 'yes' : 'NO'}`,
);
const wasApplied = stateBefore.columns && stateBefore.subs;
console.log(
  `  0049 reads as ${wasApplied ? 'ALREADY APPLIED' : 'PENDING'} — from the catalogue, not from the journal`,
);

console.log('\nPre-flight:');

/*
 * `DROP INDEX` refuses with 2BP01 if the name belongs to a *constraint* rather
 * than a bare index. `0008` used CREATE UNIQUE INDEX, so this should be zero —
 * and the whole migration rolls back on it, so it is read, not assumed.
 */
const [asConstraint] = await client`
  select count(*)::int as n from pg_constraint
   where conname = 'timetable_entries_location_section_slot_day_idx'`;
check(
  'the unique index is an index, not a constraint — DROP INDEX will work',
  asConstraint.n === 0,
  `pg_constraint rows: ${asConstraint.n}`,
);

/*
 * The partial index cannot be created over rows that already violate it. The
 * old non-partial unique index should have made that impossible — "should
 * have" is the phrase this script exists to replace.
 */
const dupSql = stateBefore.columns
  ? `select count(*)::int as n from (
       select 1 from timetable_entries
        where is_active and effective_to is null
        group by location_id, section_id, slot_id, day_of_week having count(*) > 1) d`
  : `select count(*)::int as n from (
       select 1 from timetable_entries
        group by location_id, section_id, slot_id, day_of_week having count(*) > 1) d`;
const [dupes] = await client.unsafe(dupSql);
check(
  'no cell holds two rows — the partial CREATE UNIQUE INDEX can succeed',
  dupes.n === 0,
  `duplicate cells: ${dupes.n}`,
);

/*
 * `ADD CONSTRAINT … CHECK` validates every existing row. A permission key held
 * anywhere the new list does not name aborts the migration with 23514.
 */
const fileKeys = [
  ...readFileSync(MIGRATION_FILE, 'utf8')
    .split('ADD CONSTRAINT "role_permissions_permission_check"')[1]
    .split('"permission" IN (')[1]
    .split(')')[0]
    .matchAll(/'([a-z_.]+)'/g),
].map((m) => m[1]);
check('0049 names 61 permission keys', fileKeys.length === 61, String(fileKeys.length));

const held = await client`select distinct permission from role_permissions order by permission`;
const orphans = held.map((r) => r.permission).filter((p) => !fileKeys.includes(p));
check(
  'every permission key already held is named in 0049 — the ADD CONSTRAINT will validate',
  orphans.length === 0,
  orphans.length === 0
    ? `${held.length} distinct keys in use`
    : `NOT in the list: ${orphans.join(', ')}`,
);

/*
 * The migrator runs **every pending file in one transaction**. If the
 * bookkeeping is behind the schema — §5cg: it was, for a day — this would
 * silently re-run `0047`'s six CHECK rewrites alongside `0049`.
 */
const journal = JSON.parse(readFileSync(JOURNAL, 'utf8')).entries;
const pending = journal.filter((e) => Number(e.when) > Number(before.newest));
const onlyOurs = pending.length === 1 && pending[0].tag === TAG;
if (wasApplied && pending.length === 0) {
  /*
   * Already applied, so there is nothing left to be pending and this gate has
   * no opinion. Reporting it as a failure would make the script red on exactly
   * the database it is meant to certify — which is the state it spends the
   * rest of its run proving is correct.
   */
  skip('exactly one migration is pending', '0049 is already applied — the bookkeeping records it');
} else {
  check(
    'exactly one migration is pending, and it is 0049',
    onlyOurs,
    pending.length === 0
      ? 'none pending — the bookkeeping already records it'
      : pending.map((e) => e.tag).join(', '),
  );
}
if (APPLY && !onlyOurs && !wasApplied) {
  console.error(
    '\nREFUSING TO APPLY — the pending set is not exactly 0049. Fix the bookkeeping first (STATE.md §5cg).',
  );
  await client.end();
  process.exit(1);
}

if (APPLY && onlyOurs) {
  /*
   * Fail fast rather than queue. `ADD COLUMN` takes ACCESS EXCLUSIVE on
   * timetable_entries and the five FKs take SHARE ROW EXCLUSIVE on schools,
   * academic_years, sections, timetable_slots and school_users. Without a
   * lock_timeout one long read holds the migration, and the migration then
   * holds every request behind it in the lock queue.
   */
  await client.unsafe(`set lock_timeout = '5s'`);
  await client.unsafe(`set statement_timeout = '120s'`);
  console.log(
    '\nApplying (lock_timeout 5s — a timeout rolls the whole file back, so just re-run) …',
  );
  await migrate(drizzle(client), { migrationsFolder: MIGRATIONS });
} else if (APPLY) {
  console.log('\nNothing to apply — the bookkeeping already records 0049.');
}

console.log('\nAfter:');
const after = await census('after');
const state = await schemaState();

/*
 * Everything below asserts what `0049` put there. On a database where it is
 * still pending none of it *can* hold, and reporting that as a wall of
 * failures is the mistake CLAUDE.md names: a check that never ran is "not
 * exercised", not a fail. Report it that way, so that a real failure on an
 * applied database is not one red line among ten expected ones.
 */
const proving = wasApplied || (APPLY && onlyOurs);
if (!proving) {
  console.log('\n  0049 is PENDING — every assertion below is reported as not exercised.');
  console.log('  Re-run with --apply to apply it and prove it in the same pass.');
}
const prove = (label, condition, detail = '') =>
  proving ? check(label, condition, detail) : skip(label, '0049 is not applied — run with --apply');

console.log('\nStep 1 — two dates, and the metadata-only claim:');
prove('effective_from and effective_to both exist', state.columns, state.columnDetail);

if (APPLY && onlyOurs) {
  check(
    'relfilenode unchanged — ADD COLUMN did not rewrite the table',
    String(before.relfilenode) === String(after.relfilenode),
    `${before.relfilenode} → ${after.relfilenode}`,
  );
  check(
    'timetable_entries row count unchanged',
    before.entries === after.entries,
    `${before.entries} → ${after.entries}`,
  );
  check('bookkeeping grew by exactly one', after.book === before.book + 1, `${before.book} → ${after.book}`);
  check(
    "the new bookkeeping row's created_at is 0049's journal `when`",
    String(after.newest) === String(journal.find((e) => e.tag === TAG)?.when),
    `${after.newest} — match on created_at, never on id: the id is a serial one ahead of the number (§5cg)`,
  );
} else {
  skip('relfilenode before/after', 'nothing was applied in this run — only an --apply run can compare');
}

const [missing] = await client`
  select atthasmissing, attmissingval::text as val, attnotnull
    from pg_attribute
   where attrelid = 'public.timetable_entries'::regclass and attname = 'effective_from'`;

if (missing === undefined) {
  skip('attmissingval on effective_from', 'the column does not exist — 0049 is not applied');
} else if (after.entries === 0) {
  skip('attmissingval on effective_from', 'timetable_entries is empty — no existing row reads through it');
} else {
  check('effective_from is NOT NULL', missing.attnotnull === true);
  check(
    'existing rows read effective_from through attmissingval — no rewrite',
    missing.atthasmissing === true,
    `atthasmissing=${missing.atthasmissing} attmissingval=${missing.val}`,
  );
}

if (!state.columns) {
  skip('every existing row is live', 'the columns do not exist yet');
} else {
  const [live] = await client`
    select count(*)::int as total,
           count(*) filter (where effective_to is not null)::int as closed,
           count(*) filter (where effective_from is null)::int   as undated,
           count(*) filter (where effective_to is null and effective_from <= current_date)::int as live_today
      from timetable_entries`;
  check('no row came out closed — effective_to is not null: 0', live.closed === 0, String(live.closed));
  check('no row came out undated — effective_from is null: 0', live.undated === 0, String(live.undated));
  check(
    'every row is live today — liveTimetableEntries() matches what the old reads matched',
    live.live_today === live.total,
    `${live.live_today} of ${live.total}`,
  );
}

console.log('\nStep 2 — the unique index and its predicate:');
if (state.index === null) {
  prove(
    'timetable_entries_location_section_slot_day_idx exists',
    false,
    'ABSENT — the DROP ran and the CREATE did not',
  );
} else {
  const def = state.index.def;
  const flat = def.replace(/\s+/g, ' ');
  console.log(`  def: ${def}`);
  prove('it is UNIQUE', state.index.indisunique === true);
  prove('it is valid', state.index.indisvalid === true);
  prove('it carries a predicate at all (indpred is not null)', state.index.partial === true);
  prove(
    'the predicate is WHERE effective_to IS NULL AND is_active',
    /WHERE\s+\(?\(?effective_to IS NULL\)?\s+AND\s+is_active\)?/i.test(flat),
    def.includes('WHERE')
      ? def.slice(def.indexOf('WHERE'))
      : 'no WHERE clause — the failure that looks exactly like success',
  );
  prove(
    'it still covers the four grid columns in order',
    /\(location_id,\s*section_id,\s*slot_id,\s*day_of_week\)/.test(flat),
  );
}

const [historyIdx] = await client`
  select pg_get_indexdef(indexrelid) as def
    from pg_index where indexrelid = to_regclass('public.timetable_entries_history_idx')`;
prove('timetable_entries_history_idx exists', historyIdx !== undefined, historyIdx?.def ?? 'absent');

console.log('\nStep 2 — the supersede, driven against a real row:');
const cells = state.columns
  ? await client`
      select id, location_id, academic_year_id, section_id, subject_id, teacher_id, slot_id, day_of_week
        from timetable_entries
       where is_active and effective_to is null
       limit 1`
  : [];
const cell = cells[0];

const copyOpen = (tx, id) => tx`
  insert into timetable_entries
    (location_id, academic_year_id, section_id, subject_id, teacher_id, slot_id, day_of_week, room, effective_from, effective_to)
  select location_id, academic_year_id, section_id, subject_id, teacher_id, slot_id, day_of_week, room, current_date, null
    from timetable_entries where id = ${id}`;

if (cell === undefined) {
  skip(
    'closing a row and opening its replacement',
    'no live timetable_entries row anywhere — the supersede is NOT proved',
  );
  skip('a second OPEN row for one cell is refused 23505', 'no live timetable_entries row anywhere');
  skip('two CLOSED versions of one cell are accepted', 'no live timetable_entries row anywhere');
  skip('ON CONFLICT with and without the predicate', 'no live timetable_entries row anywhere');
} else {
  console.log(`  using entry ${cell.id} at ${cell.location_id}, day ${cell.day_of_week}`);

  await mustAccept(
    'closing a row and opening its replacement is accepted — the point of the partial index',
    async (tx) => {
      await tx`update timetable_entries set effective_to = current_date - 1 where id = ${cell.id}`;
      await copyOpen(tx, cell.id);
    },
  );

  await mustRefuse('a second OPEN row for the same cell is refused', '23505', (tx) =>
    copyOpen(tx, cell.id),
  );

  await mustAccept('two CLOSED versions of one cell are accepted — history is unconstrained', async (tx) => {
    await tx`update timetable_entries set effective_to = current_date - 1 where id = ${cell.id}`;
    await tx`
      insert into timetable_entries
        (location_id, academic_year_id, section_id, subject_id, teacher_id, slot_id, day_of_week, room, effective_from, effective_to)
      select location_id, academic_year_id, section_id, subject_id, teacher_id, slot_id, day_of_week, room,
             current_date - 30, current_date - 20
        from timetable_entries where id = ${cell.id}`;
  });

  /*
   * `ON CONFLICT` cannot infer a *partial* index unless the statement repeats
   * the predicate. The first of these is what the new route sends; the second
   * is what the **currently deployed** route sends, and it is 42P10. That is
   * the deploy-order window, executed rather than argued.
   */
  await mustAccept(
    'ON CONFLICT … WHERE effective_to IS NULL AND is_active infers the index (the NEW route)',
    (tx) => tx`
      insert into timetable_entries
        (location_id, academic_year_id, section_id, subject_id, teacher_id, slot_id, day_of_week, effective_from)
      values (${cell.location_id}, ${cell.academic_year_id}, ${cell.section_id}, ${cell.subject_id},
              ${cell.teacher_id}, ${cell.slot_id}, ${cell.day_of_week}, current_date)
      on conflict (location_id, section_id, slot_id, day_of_week)
        where effective_to is null and is_active
      do update set updated_at = now()`,
  );

  await mustRefuse(
    "the OLD route's bare ON CONFLICT no longer infers it — 42P10, the deploy-order window",
    '42P10',
    (tx) => tx`
      insert into timetable_entries
        (location_id, academic_year_id, section_id, subject_id, teacher_id, slot_id, day_of_week, effective_from)
      values (${cell.location_id}, ${cell.academic_year_id}, ${cell.section_id}, ${cell.subject_id},
              ${cell.teacher_id}, ${cell.slot_id}, ${cell.day_of_week}, current_date)
      on conflict (location_id, section_id, slot_id, day_of_week)
      do update set updated_at = now()`,
  );
}

console.log('\nStep 3 — timetable_substitutions:');
prove('the table exists', state.subs === true);

if (state.subs === true) {
  const idxNames = (
    await client`
      select indexname from pg_indexes
       where schemaname = 'public' and tablename = 'timetable_substitutions'
       order by indexname`
  ).map((r) => r.indexname);
  for (const name of [
    'timetable_substitutions_pkey',
    'timetable_substitutions_location_id_idx',
    'timetable_substitutions_location_date_idx',
    'timetable_substitutions_cover_teacher_date_idx',
    'timetable_substitutions_cell_date_idx',
  ]) {
    prove(`index ${name}`, idxNames.includes(name), idxNames.join(', '));
  }

  const [cellIdx] = await client`
    select indisunique from pg_index
     where indexrelid = to_regclass('public.timetable_substitutions_cell_date_idx')`;
  prove('the cell/date index is UNIQUE', cellIdx?.indisunique === true);

  const cons = await client`
    select conname, contype, confdeltype,
           (select relname from pg_class where oid = confrelid) as refs
      from pg_constraint
     where conrelid = 'public.timetable_substitutions'::regclass
     order by contype, conname`;
  /*
   * Eight, not five: `school_users` is referenced three times over — the
   * teacher who was down to take it, the one covering, and whoever arranged
   * it — and those three are the whole point of the row. Counting the *tables*
   * rather than the columns is how this first read as five.
   */
  const fks = cons.filter((c) => c.contype === 'f');
  prove('eight foreign keys', fks.length === 8, fks.map((f) => `${f.refs}:${f.confdeltype}`).join(' '));
  prove(
    'the two teacher columns are NO ACTION — a cover is not deleted with a person',
    fks.filter((f) => f.refs === 'school_users' && f.confdeltype === 'a').length === 2,
    fks.filter((f) => f.refs === 'school_users').map((f) => f.confdeltype).join(','),
  );
  prove(
    'entry_id is ON DELETE SET NULL',
    fks.some((f) => f.refs === 'timetable_entries' && f.confdeltype === 'n'),
    fks
      .filter((f) => f.refs === 'timetable_entries')
      .map((f) => f.confdeltype)
      .join(',') || 'no FK to timetable_entries',
  );
  prove('location_id is ON DELETE CASCADE', fks.some((f) => f.refs === 'schools' && f.confdeltype === 'c'));
  prove('arranged_by is ON DELETE SET NULL', fks.some((f) => f.refs === 'school_users' && f.confdeltype === 'n'));
  prove(
    'two CHECK constraints',
    cons.filter((c) => c.contype === 'c').length === 2,
    cons.filter((c) => c.contype === 'c').map((c) => c.conname).join(', '),
  );
}

if (state.subs !== true || cell === undefined) {
  skip(
    'the substitution guards',
    state.subs !== true ? 'the table does not exist' : 'no live timetable row to arrange cover against',
  );
} else {
  const others = await client`
    select id from school_users where location_id = ${cell.location_id} and id <> ${cell.teacher_id} limit 1`;
  const cover = others[0]?.id ?? cell.teacher_id;
  const original = others[0] === undefined ? null : cell.teacher_id;
  if (others[0] === undefined) {
    skip(
      'the distinct-teacher CHECK',
      'this school has one school_users row — the free-period case is used instead',
    );
  }

  const insertSub = (tx, over = {}) => {
    const row = {
      entry_id: cell.id,
      day_of_week: cell.day_of_week,
      cover_date: '2026-09-21',
      original_teacher_id: original,
      cover_teacher_id: cover,
      ...over,
    };
    return tx`
      insert into timetable_substitutions
        (location_id, academic_year_id, entry_id, section_id, slot_id, day_of_week,
         cover_date, original_teacher_id, cover_teacher_id)
      values (${cell.location_id}, ${cell.academic_year_id}, ${row.entry_id}, ${cell.section_id},
              ${cell.slot_id}, ${row.day_of_week}, ${row.cover_date},
              ${row.original_teacher_id}, ${row.cover_teacher_id})
      returning id`;
  };

  await mustAccept('an ordinary cover row is accepted', (tx) => insertSub(tx));
  await mustAccept('a free period — original_teacher_id null — is accepted', (tx) =>
    insertSub(tx, { original_teacher_id: null }),
  );
  await mustRefuse('day_of_week 5 is refused', '23514', (tx) => insertSub(tx, { day_of_week: 5 }));
  if (others[0] !== undefined) {
    await mustRefuse('covering for yourself is refused', '23514', (tx) =>
      insertSub(tx, { original_teacher_id: cover }),
    );
  }
  await mustRefuse('a second cover for the same cell on the same date is refused', '23505', async (tx) => {
    await insertSub(tx);
    await insertSub(tx, { original_teacher_id: null });
  });
  await mustAccept('the same cell on a different date is accepted', async (tx) => {
    await insertSub(tx);
    await insertSub(tx, { cover_date: '2026-09-22' });
  });

  /* The FK's whole point: the cover outlives the lesson it was arranged from. */
  await mustAccept('deleting the lesson sets entry_id null and keeps the cover', async (tx) => {
    const [sub] = await insertSub(tx);
    await tx`delete from timetable_entries where id = ${cell.id}`;
    const [back] = await tx`select entry_id from timetable_substitutions where id = ${sub.id}`;
    if (back === undefined) throw new Error('the substitution row was deleted with the lesson');
    if (back.entry_id !== null) throw new Error(`entry_id is ${back.entry_id}, not null`);
  });
}

console.log('\nStep 4 — role_permissions_permission_check, proved by attempt:');
if (state.checkDef === null) {
  prove(
    'the constraint exists',
    false,
    'gone — dropped and never re-added, which no row count would show',
  );
} else {
  const liveKeys = (state.checkDef.match(/'[a-z_.]+'/g) ?? []).map((s) => s.slice(1, -1));
  prove('the live constraint names 61 keys', liveKeys.length === 61, String(liveKeys.length));
  prove(
    'the live constraint and 0049 name the same set',
    fileKeys.every((k) => liveKeys.includes(k)) && liveKeys.every((k) => fileKeys.includes(k)),
    `in the file only: ${fileKeys.filter((k) => !liveKeys.includes(k)).join(', ') || 'none'}; ` +
      `in the database only: ${liveKeys.filter((k) => !fileKeys.includes(k)).join(', ') || 'none'}`,
  );
}

const [school] = await client`select location_id from schools order by created_at limit 1`;
if (!proving) {
  /*
   * The bogus key would still be refused here and `timetable.substitute` would
   * still be refused — correctly, because `0049` has not widened the CHECK yet.
   * Attempting either would report a *predicted* refusal as a failure, which is
   * the "predicted failure wearing a defect's clothes" mistake in reverse.
   */
  skip('the permission CHECK by attempt', '0049 is not applied — the CHECK is still 0047’s 60 keys');
} else if (school === undefined) {
  skip('the permission CHECK by attempt', 'no school row — nothing to insert a permission against');
} else {
  await mustRefuse('a key outside the list is refused', '23514', (tx) =>
    tx`insert into role_permissions (location_id, role, permission, is_granted)
       values (${school.location_id}, 'teacher', 'timetable.not_a_real_key', true)`,
  );

  await mustAccept('timetable.substitute is accepted', (tx) =>
    tx`insert into role_permissions (location_id, role, permission, is_granted)
       values (${school.location_id}, 'marketing', 'timetable.substitute', true)
       on conflict do nothing`,
  );

  let every = 0;
  for (const key of fileKeys) {
    const accepted = await mustAccept(
      key,
      (tx) => tx`insert into role_permissions (location_id, role, permission, is_granted)
                 values (${school.location_id}, 'marketing', ${key}, false) on conflict do nothing`,
      true,
    );
    if (accepted) every += 1;
  }
  prove(
    `every one of the ${fileKeys.length} keys is accepted`,
    every === fileKeys.length,
    `${every} of ${fileKeys.length}`,
  );
}

console.log('\nNothing was written by the proofs:');
const end = await census('end');
check('timetable_entries row count unchanged', end.entries === after.entries, `${after.entries} → ${end.entries}`);
check('role_permissions row count unchanged', end.perms === after.perms, `${after.perms} → ${end.perms}`);
check('relfilenode unchanged by the proofs', String(end.relfilenode) === String(after.relfilenode));
if (state.subs === true) {
  const [subRows] = await client`select count(*)::int as n from timetable_substitutions`;
  check('timetable_substitutions is still empty', subRows.n === 0, String(subRows.n));
}

await client.end();

if (warnings.length > 0) {
  console.log('\nWarnings:');
  for (const line of warnings) console.log(`  warn  ${line}`);
}
if (notExercised.length > 0) {
  console.log('\nNot exercised — neither passed nor failed:');
  for (const line of notExercised) console.log(`  --    ${line}`);
}

console.log(
  `\n${failed === 0 ? 'PASS' : 'FAIL'} — ${ok} ok, ${failed} failed, ${notExercised.length} not exercised`,
);
process.exit(failed === 0 ? 0 : 1);
