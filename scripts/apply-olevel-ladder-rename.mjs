/**
 * The O-Levels ladder rename. There is no migration.
 *
 *     node scripts/apply-olevel-ladder-rename.mjs          # reads, changes nothing
 *     node scripts/apply-olevel-ladder-rename.mjs --apply  # writes
 *
 * ── What it does ─────────────────────────────────────────────────────────
 * `lib/predefined-grades.ts` used to end its Cambridge ladder
 * `… Year 8, Year 9, O Level 1, O Level 2` — the Matric shape with Cambridge
 * names pasted over the last two rungs. A Cambridge school runs Year 8 and
 * then **O1, O2, O3**: there is no Year 9, and the O-Level course is three
 * years, not two.
 *
 * The branch form (`lib/branch-classes.ts`) had said `O1, O2, O3` after
 * Grade 8 since it was written, and `scripts/check-forms.ts` asserted it. So
 * the two halves of the product disagreed about the same curriculum, and an
 * operator who declared a campus running `O1-O3` got a `Year 9` nobody asked
 * for and no `O3` to put the leaving year into.
 *
 * The code half is fixed. This is the estate that already exists.
 *
 * ── It is a rename, not a reordering ─────────────────────────────────────
 * The ladder is fourteen rungs before and after. Only the names at positions
 * 12, 13 and 14 change, and `grades` is keyed `(branch_id, sort_order)` — so
 * every row keeps its id, its sections, its enrolments, its timetable and its
 * results. Nothing is inserted and nothing is deleted.
 *
 * Matched **by sort order, on O_LEVELS and A_LEVELS branches only**, never by
 * name. A school that renamed a rung by hand still has it at position 12, and
 * a Matric branch's `Class 9` at position 12 must not be touched — which is
 * why the curriculum is part of the where clause rather than assumed.
 *
 * ── The display names come off ───────────────────────────────────────────
 * `grades.display_name` is the school's own override, and it is honoured
 * everywhere. LGS's Defence Branch had `O1`, `O2`, `O3` typed into it — a
 * head of school correcting the product by hand, one grade at a time, which is
 * the clearest possible evidence for this change. Once the canonical name says
 * the same thing the override is noise, so an override that now equals its own
 * grade's name is cleared. An override that says anything else is the school's
 * decision and is left exactly alone.
 *
 * ── Idempotent ───────────────────────────────────────────────────────────
 * The second run finds every row already named correctly and writes nothing.
 *
 * Reversible: the reverse map is printed for every row it touches.
 */

import postgres from 'postgres';
import { readFileSync } from 'node:fs';

const APPLY = process.argv.includes('--apply');

function loadDatabaseUrl() {
  for (const candidate of ['D:/School-Management-System/.env.local', '.env.local']) {
    try {
      const text = readFileSync(candidate, 'utf8');
      const match = /^DATABASE_URL=(.*)$/m.exec(text);
      if (match?.[1] !== undefined) {
        return match[1].trim().replace(/^['"]|['"]$/g, '');
      }
    } catch {
      // Try the next candidate.
    }
  }
  throw new Error('DATABASE_URL not found');
}

const sql = postgres(loadDatabaseUrl(), { prepare: false });

/**
 * Position -> the name that position now carries.
 *
 * Only the three that changed are listed. Positions 1-11 are identical in the
 * old ladder and the new one, so naming them here would be three more chances
 * to mistype a rung that needs no change.
 */
const RENAMES = new Map([
  [12, { from: 'Year 9', to: 'O1' }],
  [13, { from: 'O Level 1', to: 'O2' }],
  [14, { from: 'O Level 2', to: 'O3' }],
]);

const CAMBRIDGE = ['O_LEVELS', 'A_LEVELS'];

async function main() {
  console.log(`mode: ${APPLY ? 'APPLY' : 'dry run — nothing is written'}\n`);

  const rows = await sql`
    select g.id,
           g.name,
           g.display_name,
           g.sort_order,
           g.curriculum_level,
           b.name as branch_name,
           s.name as school_name
      from grades g
      join branches b on b.id = g.branch_id
      join schools  s on s.location_id = g.location_id
     where g.curriculum_level in ${sql(CAMBRIDGE)}
       and g.sort_order in ${sql([...RENAMES.keys()])}
     order by s.name, b.name, g.sort_order
  `;

  if (rows.length === 0) {
    console.log('No Cambridge grade sits at position 12, 13 or 14. Nothing to do.');
    return;
  }

  const planned = [];
  const unexpected = [];

  for (const row of rows) {
    const rename = RENAMES.get(row.sort_order);
    const where = `${row.school_name} / ${row.branch_name}`;

    // Already renamed — a second run, or a school that got there first.
    const nameSettled = row.name === rename.to;
    // An override equal to the canonical name is now redundant.
    const overrideRedundant =
      row.display_name !== null && row.display_name === rename.to;

    if (nameSettled && !overrideRedundant) {
      console.log(`  = ${where}  #${row.sort_order} already "${rename.to}"`);
      continue;
    }

    /*
     * A name that is neither the old one nor the new one is a school that
     * renamed the rung itself. Reported and skipped: this script knows the
     * ladder, not what a head of school meant, and overwriting a deliberate
     * name to satisfy a script is the kind of tidy-up nobody asked for.
     */
    if (!nameSettled && row.name !== rename.from) {
      unexpected.push({ where, sortOrder: row.sort_order, name: row.name });
      continue;
    }

    planned.push({
      id: row.id,
      where,
      sortOrder: row.sort_order,
      from: row.name,
      to: rename.to,
      clearDisplayName: overrideRedundant,
      displayName: row.display_name,
    });
  }

  for (const item of planned) {
    const override = item.clearDisplayName
      ? `, clearing display name "${item.displayName}" (now says what the name says)`
      : '';
    console.log(
      `  ${APPLY ? '→' : '·'} ${item.where}  #${item.sortOrder}  "${item.from}" -> "${item.to}"${override}`,
    );
  }

  for (const item of unexpected) {
    console.log(
      `  ! ${item.where}  #${item.sortOrder} is named "${item.name}" — not the ladder's old name. Left alone.`,
    );
  }

  console.log(
    `\n${planned.length} grade row(s) to rename, ${unexpected.length} left alone.`,
  );

  if (!APPLY) {
    console.log('\nDry run. Re-run with --apply to write.');
    return;
  }

  if (planned.length === 0) {
    console.log('Nothing to write.');
    return;
  }

  await sql.begin(async (tx) => {
    for (const item of planned) {
      // Two statements rather than one with a conditional expression in it:
      // `grades` has no `updated_at`, the override is only sometimes touched,
      // and a column list that changes shape per row is how the wrong column
      // gets written. Both run inside the one transaction either way.
      if (item.clearDisplayName) {
        await tx`
          update grades set name = ${item.to}, display_name = null
           where id = ${item.id}
        `;
      } else {
        await tx`update grades set name = ${item.to} where id = ${item.id}`;
      }
    }
  });

  console.log(`\nWritten. Reverse with:`);
  for (const item of planned) {
    const override = item.clearDisplayName
      ? `, display_name = '${item.displayName}'`
      : '';
    console.log(
      `  update grades set name = '${item.from}'${override} where id = '${item.id}';`,
    );
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => sql.end());
