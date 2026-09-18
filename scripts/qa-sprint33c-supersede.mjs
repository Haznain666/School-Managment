#!/usr/bin/env node

/**
 * Exercises the one Sprint 33c path that can only fail in production: the
 * **supersede** branch of `POST /api/school/timetable/entries`.
 *
 *     node scripts/qa-sprint33c-supersede.mjs backdate   arm it
 *     node scripts/qa-sprint33c-supersede.mjs inspect    read the cell's versions
 *     node scripts/qa-sprint33c-supersede.mjs restore    put the cell back
 *
 * ── Why this script has to exist ─────────────────────────────────────────
 * `0049` gives every pre-existing row `effective_from = CURRENT_DATE`, and the
 * route supersedes only when `standing.effectiveFrom < today`. So on the day
 * the migration is applied, **every** teacher change takes the in-place branch
 * and the close-and-open transaction never runs. QA proved that by experiment
 * rather than assuming it.
 *
 * It was expected to become reachable the next calendar day. It did not, and
 * the reason is worth recording: `timetableToday()` is **UTC** and a Pakistani
 * school is **UTC+5**. At 02:33 on 19 September in Karachi it is still
 * 21:33 on the 18th in UTC, so `effectiveFrom === today` and the route
 * correctly declines to supersede. The branch opens at UTC midnight, not at
 * Pakistani midnight.
 *
 * Waiting is not testing. So this backdates **one cell** by a day, which is
 * exactly the state the row will be in tomorrow, and lets the real route run
 * against it through the real API.
 *
 * ── What it will and will not touch ──────────────────────────────────────
 * One row, by primary key, on the QA tenant's Year 3 — A Monday English cell.
 * It writes `effective_from` and nothing else. `restore` puts that column back
 * and removes any row the supersede opened, so the cell ends as it began.
 * Every mode prints the cell's full version history before and after.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import postgres from 'postgres';

const MODE = process.argv[2] ?? 'inspect';

/** The QA tenant's Year 3 — A, Monday, English. */
const CELL = {
  sectionId: 'cb664160-2da6-4171-b429-aadf5641dd5f',
  slotId: '6fe0a4cf-b345-4a49-ba13-6fc1fe3338e5',
  dayOfWeek: 0,
};

function databaseUrl() {
  for (const candidate of [
    fileURLToPath(new URL('../.env.local', import.meta.url)),
    'D:/School-Management-System/.env.local',
  ]) {
    try {
      const match = /^DATABASE_URL=(.*)$/m.exec(readFileSync(candidate, 'utf8'));
      if (match?.[1] !== undefined) {
        return match[1].trim().replace(/^['"]|['"]$/g, '').replace(':6543/', ':5432/');
      }
    } catch {
      // Try the next candidate.
    }
  }
  throw new Error('DATABASE_URL not found');
}

const sql = postgres(databaseUrl(), { max: 1, prepare: false });

async function versions() {
  return sql`
    select e.id,
           e.effective_from::text as effective_from,
           e.effective_to::text   as effective_to,
           e.is_active,
           u.name                 as teacher,
           s.name                 as subject,
           e.created_at
      from timetable_entries e
      join school_users u on u.id = e.teacher_id
      join subjects     s on s.id = e.subject_id
     where e.section_id  = ${CELL.sectionId}
       and e.slot_id     = ${CELL.slotId}
       and e.day_of_week = ${CELL.dayOfWeek}
     order by e.effective_from, e.created_at`;
}

async function show(label) {
  const rows = await versions();
  const [{ n }] = await sql`
    select count(*)::int as n from timetable_entries
     where section_id = ${CELL.sectionId}`;
  console.log(`\n${label}  — ${rows.length} version(s) of this cell, ${n} entries in the section`);
  for (const r of rows) {
    const live = r.effective_to === null ? 'LIVE ' : 'closed';
    console.log(
      `  ${live} ${r.id.slice(0, 8)}  ${r.effective_from} → ${r.effective_to ?? '—'}  ` +
        `${r.subject} · ${r.teacher}`,
    );
  }
  return rows;
}

const [clock] = await sql`
  select current_date::text as db_today, now()::text as db_now`;
console.log(`database CURRENT_DATE = ${clock.db_today}`);
console.log(`node UTC date         = ${new Date().toISOString().slice(0, 10)}`);
console.log(`Pakistan local        = ${new Date(Date.now() + 5 * 3600 * 1000).toISOString().slice(0, 16).replace('T', ' ')} PKT`);

const before = await show('Before');

if (MODE === 'inspect') {
  console.log('\nInspect only. Use `backdate` to arm the supersede, `restore` to undo.');
  await sql.end();
  process.exit(0);
}

if (MODE === 'backdate') {
  const live = before.filter((r) => r.effective_to === null && r.is_active);
  if (live.length !== 1) {
    console.error(`\nREFUSING — expected exactly 1 live version, found ${live.length}.`);
    await sql.end();
    process.exit(1);
  }

  const target = live[0];
  const [{ db_today: today }] = await sql`select current_date::text as db_today`;
  if (target.effective_from !== today) {
    console.log(
      `\nNothing to do — effective_from is ${target.effective_from}, already before ` +
        `today (${today}). The supersede is reachable as it stands.`,
    );
    await sql.end();
    process.exit(0);
  }

  const updated = await sql`
    update timetable_entries
       set effective_from = current_date - 1
     where id = ${target.id}
    returning id, effective_from::text as effective_from`;

  console.log(
    `\nBackdated ${updated[0].id.slice(0, 8)} to ${updated[0].effective_from} — ` +
      'exactly the state it reaches at UTC midnight.',
  );
  await show('After backdating');
  console.log(
    '\nNow change the teacher on this cell through the real API. The route should ' +
      'CLOSE this row and OPEN a new one.',
  );
  await sql.end();
  process.exit(0);
}

if (MODE === 'restore') {
  const rows = before;
  if (rows.length === 0) {
    console.error('REFUSING — no versions of this cell at all.');
    await sql.end();
    process.exit(1);
  }

  // The original is the oldest row; anything newer was opened by the supersede.
  const original = rows[0];
  const opened = rows.slice(1);

  await sql.begin(async (tx) => {
    for (const row of opened) {
      await tx`delete from timetable_entries where id = ${row.id}`;
      console.log(`  removed the superseding row ${row.id.slice(0, 8)}`);
    }
    await tx`
      update timetable_entries
         set effective_from = current_date, effective_to = null, is_active = true
       where id = ${original.id}`;
    console.log(`  reopened ${original.id.slice(0, 8)} and reset effective_from to today`);
  });

  await show('After restore');
  await sql.end();
  process.exit(0);
}

console.error(`Unknown mode "${MODE}". Use backdate | inspect | restore.`);
await sql.end();
process.exit(1);
