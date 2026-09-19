#!/usr/bin/env node

/**
 * Removes the one row Sprint 33c's QA left behind that should not stand.
 *
 *     node scripts/qa-sprint33c-cleanup.mjs           read it back, delete nothing
 *     node scripts/qa-sprint33c-cleanup.mjs --apply   delete it
 *
 * ── What it is, and why it has to go ─────────────────────────────────────
 * `90f26c75-c838-40e6-ac6e-464be9a4d9da` is QA finding F2's evidence: a cover
 * arranged on 2026-09-18 putting **Hina Aslam, of Askari Junior Campus**, in
 * front of **Year 3 — A at Askari Main Campus** for a 07:45 period. It was
 * accepted because the candidate pool was scoped to the caller's campus rather
 * than the lesson's. That defect is fixed and re-proved; the row it produced is
 * still there, and Hina still has the bell notification and the chat message
 * telling her to turn up.
 *
 * ── Why a delete here, and not a `cancelled` flag ────────────────────────
 * `timetable_substitutions` has no status column and the product has no cancel
 * — QA recorded that as an open gap. So there is no in-product way to withdraw
 * this, and leaving it means a teacher is rostered to a class at a site she
 * does not work at.
 *
 * **This is not the ledger.** `CLAUDE.md`'s append-only rule governs
 * `ledger_transactions` and `ledger_entries`, where a correction is a reversing
 * entry because a school must be able to answer for a figure months later. A
 * substitution is an operational roster row, no money moved, and nothing
 * downstream reads history from it.
 *
 * ── The guardrails ───────────────────────────────────────────────────────
 * It deletes **one row, by primary key**, and only after reading it back and
 * checking it is the row described above — same id, same cover teacher, same
 * date. Anything else and it refuses. The count is read before and after, and
 * a delete that removed other than exactly one row rolls back.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import postgres from 'postgres';

const APPLY = process.argv.includes('--apply');

/** The row, and the facts that identify it beyond its id alone. */
const TARGET = {
  id: '90f26c75-c838-40e6-ac6e-464be9a4d9da',
  coverDate: '2026-09-18',
  coverTeacherName: 'Hina Aslam',
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

const [before] = await sql`select count(*)::int as n from timetable_substitutions`;
console.log(`timetable_substitutions holds ${before.n} row(s)\n`);

const rows = await sql`
  select s.id,
         s.cover_date::text        as cover_date,
         s.day_of_week,
         sec.name                  as section_name,
         g.name                    as grade_name,
         sb.name                   as section_campus,
         cover.name                as cover_teacher,
         cb.name                   as cover_campus,
         orig.name                 as original_teacher,
         by_who.name               as arranged_by,
         slot.name                 as slot_name
    from timetable_substitutions s
    join sections     sec   on sec.id   = s.section_id
    join grades       g     on g.id     = sec.grade_id
    left join branches sb   on sb.id    = g.branch_id
    join school_users cover on cover.id = s.cover_teacher_id
    left join staff   cs    on cs.school_user_id = cover.id
    left join branches cb   on cb.id    = cs.branch_id
    left join school_users orig   on orig.id   = s.original_teacher_id
    left join school_users by_who on by_who.id = s.arranged_by
    join timetable_slots slot on slot.id = s.slot_id
   where s.id = ${TARGET.id}`;

const row = rows[0];

if (row === undefined) {
  console.log(`Row ${TARGET.id} is already gone. Nothing to do.`);
  await sql.end();
  process.exit(0);
}

console.log('The row:');
console.log(`  class          ${row.grade_name} — ${row.section_name}  (${row.section_campus ?? 'no campus'})`);
console.log(`  period         ${row.slot_name}, ${row.cover_date}`);
console.log(`  cover teacher  ${row.cover_teacher}  (${row.cover_campus ?? 'no campus'})`);
console.log(`  instead of     ${row.original_teacher ?? '(free period)'}`);
console.log(`  arranged by    ${row.arranged_by ?? '(unknown)'}\n`);

/* Identity, checked on more than the id — an id in a script is a typo waiting. */
if (row.cover_teacher !== TARGET.coverTeacherName || row.cover_date !== TARGET.coverDate) {
  console.error(
    `REFUSING — this is not the row this script was written for.\n` +
      `  expected ${TARGET.coverTeacherName} on ${TARGET.coverDate}\n` +
      `  found    ${row.cover_teacher} on ${row.cover_date}`,
  );
  await sql.end();
  process.exit(1);
}

if (row.section_campus === row.cover_campus) {
  console.error(
    'REFUSING — the cover teacher and the class are at the SAME campus, so this is ' +
      'not F2 evidence and may be a real cover somebody arranged.',
  );
  await sql.end();
  process.exit(1);
}

console.log(
  `Cross-campus confirmed: the class is at ${row.section_campus} and the cover ` +
    `teacher works at ${row.cover_campus}.\n`,
);

if (!APPLY) {
  console.log('Inspect only — nothing was deleted. Re-run with --apply.');
  await sql.end();
  process.exit(0);
}

await sql.begin(async (tx) => {
  const deleted = await tx`
    delete from timetable_substitutions where id = ${TARGET.id} returning id`;
  if (deleted.length !== 1) {
    throw new Error(`expected to delete exactly 1 row, deleted ${deleted.length} — rolling back`);
  }
  console.log(`Deleted ${deleted.length} row: ${deleted[0].id}`);
});

const [after] = await sql`select count(*)::int as n from timetable_substitutions`;
const [gone] = await sql`
  select count(*)::int as n from timetable_substitutions where id = ${TARGET.id}`;

console.log(`\ntimetable_substitutions: ${before.n} → ${after.n}`);
console.log(`the row is ${gone.n === 0 ? 'GONE' : 'STILL THERE'}`);

/*
 * The notification and the chat message are deliberately left alone. Hina was
 * told; deleting the telling would not untell her, and a school's record of
 * what it sent is not something a cleanup script should quietly rewrite.
 */
console.log(
  '\nNote: the bell notification and the chat message sent to Hina Aslam are left in\n' +
    'place. She was told, and deleting the record of it would not untell her.',
);

await sql.end();
process.exit(after.n === before.n - 1 && gone.n === 0 ? 0 : 1);
