#!/usr/bin/env node

/**
 * Read-only verification of what `0039` left behind.
 *
 * A migrator's success message says a file ran. It does not say the columns are
 * there, are the right type, or defaulted the way the code assumes — and for
 * `allow_shared_principal_grades` a default of `true` would switch the whole
 * new rule off at every school with nothing on any screen saying so. So every
 * claim in `SPRINT-23-DDL-NOTES.md` is asserted here against the catalogue and
 * the rows themselves.
 *
 * The one refusal there is to provoke — the NOT NULL — is taken inside a
 * SAVEPOINT, because a refusal aborts the whole transaction otherwise and
 * everything after it reports the test's failure rather than the schema's
 * (STATE.md §5bh).
 */

import { readFileSync } from 'node:fs';
import postgres from 'postgres';

const match = /^DATABASE_URL=(.*)$/m.exec(
  readFileSync('D:/School-Management-System/.env.local', 'utf8'),
);
const sql = postgres(match[1].trim().replace(/^['"]|['"]$/g, ''), { max: 1, prepare: false });

let failures = 0;
const assert = (ok, label, detail) => {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label}${detail === undefined ? '' : ` — ${detail}`}`);
  if (!ok) failures += 1;
};

console.log('\nBookkeeping — the journal entry, stamped to match `_journal.json`:');
const books = await sql`select count(*)::int as n from drizzle.__drizzle_migrations`;
assert(books[0].n === 40, 'drizzle.__drizzle_migrations holds 40 rows', String(books[0].n));
const newest = await sql`
  select id, created_at from drizzle.__drizzle_migrations order by id desc limit 1`;
assert(Number(newest[0].id) === 40, 'newest id is 40', String(newest[0].id));
assert(Number(newest[0].created_at) === 1788609600000,
  'newest created_at is 1788609600000, the journal stamp for idx 39',
  String(newest[0].created_at));

console.log('\nStep 1 — schools.allow_shared_principal_grades, out of information_schema:');
const [flag] = await sql`
  select data_type, is_nullable, column_default from information_schema.columns
   where table_schema = 'public' and table_name = 'schools'
     and column_name = 'allow_shared_principal_grades'`;
assert(flag !== undefined, 'the column exists');
if (flag !== undefined) {
  assert(flag.data_type === 'boolean', 'data_type is boolean', flag.data_type);
  assert(flag.is_nullable === 'NO', 'is_nullable is NO', flag.is_nullable);
  assert(flag.column_default === 'false', "column_default is false", String(flag.column_default));
}

console.log('\nStep 2 — staff.photo_url, out of information_schema:');
const [photo] = await sql`
  select data_type, is_nullable, column_default from information_schema.columns
   where table_schema = 'public' and table_name = 'staff' and column_name = 'photo_url'`;
assert(photo !== undefined, 'the column exists');
if (photo !== undefined) {
  assert(photo.data_type === 'text', 'data_type is text', photo.data_type);
  assert(photo.is_nullable === 'YES', 'is_nullable is YES', photo.is_nullable);
  assert(photo.column_default === null, 'there is no default', String(photo.column_default));
}

console.log('\nEvery existing school got the safe default, and none got null:');
const [s] = await sql`
  select count(*) filter (where allow_shared_principal_grades is null)::int as nulls,
         count(*) filter (where allow_shared_principal_grades)::int as sharing,
         count(*)::int as schools
    from schools`;
assert(s.nulls === 0, 'zero schools hold null', String(s.nulls));
assert(s.sharing === 0, 'zero schools are sharing — the default arrived as false', String(s.sharing));
console.log(`       (${s.schools} school row(s) in total)`);

console.log('\nEvery existing staff row survived with a null photograph:');
const [st] = await sql`select count(*)::int as staff, count(photo_url)::int as with_photo from staff`;
assert(st.with_photo === 0, 'no staff row was given a photo_url', String(st.with_photo));
console.log(`       (${st.staff} staff row(s) in total)`);

console.log('\nNothing was unassigned:');
const [pa] = await sql`select count(*)::int as n from principal_assignments`;
assert(pa.n === 5, 'principal_assignments still holds the 5 rows counted before the migration',
  String(pa.n));

console.log('\nGrandfathered overlaps — grades held by more than one head today:');
const overlaps = await sql`
  select pa.location_id, g as grade_id, count(distinct pa.school_user_id)::int as heads
    from principal_assignments pa, unnest(pa.grade_ids) as g
   where pa.starts_on <= current_date
     and (pa.ends_on is null or pa.ends_on >= current_date)
   group by 1, 2 having count(distinct pa.school_user_id) > 1`;
console.log(`       ${overlaps.length} overlapping grade(s)${overlaps.length === 0 ? '' : ': ' + overlaps.map((r) => `${r.grade_id} x${r.heads}`).join(', ')}`);

console.log('\nAnd the NOT NULL has teeth (inside a SAVEPOINT, per §5bh):');
try {
  await sql.begin(async (tx) => {
    await tx`savepoint a`;
    let code = null;
    try {
      await tx`update schools set allow_shared_principal_grades = null`;
    } catch (error) {
      code = error?.cause?.code ?? error?.code ?? null;
    }
    await tx`rollback to a`;
    assert(code === '23502', 'a null is refused with 23502', code ?? '(no error raised)');
    const [after] = await tx`
      select count(*) filter (where allow_shared_principal_grades)::int as sharing,
             count(*)::int as n from schools`;
    assert(after.sharing === 0 && after.n === s.schools,
      'the rollback left every school row exactly as it was', `${after.n} rows, ${after.sharing} sharing`);
    throw new Error('__rollback__');
  });
} catch (error) {
  if (error.message !== '__rollback__') throw error;
}

const [finalCount] = await sql`
  select count(*) filter (where allow_shared_principal_grades)::int as sharing,
         count(*)::int as n from schools`;
assert(finalCount.n === s.schools && finalCount.sharing === 0,
  'and the outer transaction rolled back too — nothing was written',
  `${finalCount.n} rows, ${finalCount.sharing} sharing`);

console.log(`\n${failures === 0 ? 'PASS' : 'FAIL'} — ${failures} failed assertion(s)\n`);
await sql.end();
process.exit(failures === 0 ? 0 : 1);
