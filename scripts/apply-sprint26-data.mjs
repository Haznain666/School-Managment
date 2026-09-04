/**
 * Sprint 26's data step. There is no migration.
 *
 *     node scripts/apply-sprint26-data.mjs          # reads, changes nothing
 *     node scripts/apply-sprint26-data.mjs --apply  # writes
 *
 * ── Why a script and not two UPDATE statements in a transcript ───────────
 * Both changes have to be *derived* per school rather than typed, and one of
 * them is derived from a grade's name:
 *
 * 1. **`school_modules` gets a `chat` row.** No school on the platform had one,
 *    which is why the Messages entry was invisible to every administrator,
 *    principal and branch admin while teachers and parents had a working inbox
 *    at the same school. The code half of this sprint makes the flag mean one
 *    thing on all four portals; without this the flag would now hide chat from
 *    everybody instead of from nobody, which is a worse bug than the one being
 *    fixed. **Run this before the deploy, not after.**
 *
 * 2. **`chat_school_settings.student_login_min_grade_sort_order` is set to the
 *    school's own "6".** The product owner's rule is "grade 6 or above", and
 *    `sort_order` is a ladder position, not a grade number: at Lahore Grammar
 *    "Year 6" sits at 9 and at Askari "Class 6" also sits at 9, because both
 *    run three pre-primary years first. A literal `sort_order >= 6` would issue
 *    logins to eight-year-olds at both. So the grade is found **by name**, once,
 *    here — and from then on the stored `sort_order` is the rule, which keeps
 *    meaning the same thing after a rename or an insertion.
 *
 * Both are reversible: delete the module row, null the column.
 */

import postgres from 'postgres';
import { readFileSync } from 'node:fs';

const APPLY = process.argv.includes('--apply');

function loadDatabaseUrl() {
  for (const candidate of [
    'D:/School-Management-System/.env.local',
    '.env.local',
  ]) {
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

/**
 * The grade a school calls "6".
 *
 * Matched on a word boundary so that "Class 16" — which no school has, but the
 * next one might — cannot answer for "Class 6". Returns null when the school
 * has no such grade, and a null is reported rather than guessed at: a school
 * whose ladder this cannot read is one a human has to answer for.
 */
function sixthGrade(grades) {
  return (
    grades.find((grade) => /(?:^|\s)6(?:$|\s)/.test(grade.name.trim())) ?? null
  );
}

const sql = postgres(loadDatabaseUrl(), { prepare: false });

console.log(APPLY ? '\nAPPLYING\n' : '\nDRY RUN — nothing will be written\n');

const schools = await sql`select location_id, name from schools order by name`;

for (const school of schools) {
  console.log(`── ${school.name}`);

  /* 1. The chat module. */
  const existing = await sql`
    select is_enabled from school_modules
     where location_id = ${school.location_id} and module_key = 'chat'`;

  if (existing.length > 0 && existing[0].is_enabled) {
    console.log('   chat module      already on');
  } else if (APPLY) {
    await sql`
      insert into school_modules (location_id, module_key, is_enabled, enabled_at, enabled_by)
      values (${school.location_id}, 'chat', true, now(), 'sprint-26')
      on conflict (location_id, module_key)
        do update set is_enabled = true, enabled_at = now(), enabled_by = 'sprint-26'`;
    console.log('   chat module      SWITCHED ON');
  } else {
    console.log('   chat module      would switch on');
  }

  /* 2. The student-login threshold. */
  const grades = await sql`
    select id, name, sort_order from grades
     where location_id = ${school.location_id} order by sort_order`;

  const six = sixthGrade(grades);

  if (six === null) {
    console.log(
      `   login threshold  NO GRADE NAMED "6" — left alone (${String(grades.length)} grades)`,
    );
    continue;
  }

  const settings = await sql`
    select student_login_min_grade_sort_order as floor from chat_school_settings
     where location_id = ${school.location_id}`;

  const current = settings[0]?.floor ?? null;

  if (current === six.sort_order) {
    console.log(`   login threshold  already ${six.name} (sort_order ${six.sort_order})`);
  } else if (APPLY) {
    await sql`
      insert into chat_school_settings (location_id, student_login_min_grade_sort_order)
      values (${school.location_id}, ${six.sort_order})
      on conflict (location_id)
        do update set student_login_min_grade_sort_order = ${six.sort_order},
                      updated_at = now()`;
    console.log(
      `   login threshold  SET to ${six.name} (sort_order ${six.sort_order}), was ${current ?? 'unset'}`,
    );
  } else {
    console.log(
      `   login threshold  would set to ${six.name} (sort_order ${six.sort_order}), currently ${current ?? 'unset'}`,
    );
  }
}

/* Read it all back, from the tables rather than from what was just printed. */
console.log('\nRead back:');

const readback = await sql`
  select s.name,
         coalesce(m.is_enabled, false) as chat_on,
         c.student_login_min_grade_sort_order as floor,
         g.name as floor_grade
    from schools s
    left join school_modules m
      on m.location_id = s.location_id and m.module_key = 'chat'
    left join chat_school_settings c on c.location_id = s.location_id
    left join grades g
      on g.location_id = s.location_id
     and g.sort_order = c.student_login_min_grade_sort_order
   order by s.name`;

for (const row of readback) {
  console.log(
    `  ${row.name.padEnd(30)} chat=${String(row.chat_on).padEnd(5)} ` +
      `login from ${row.floor_grade ?? '(unset)'}${row.floor === null ? '' : ` [${String(row.floor)}]`}`,
  );
}

await sql.end();
console.log('');
