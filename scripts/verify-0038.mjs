#!/usr/bin/env node

/**
 * Read-only verification of what `0038` left behind.
 *
 * The success message from a migrator says a file ran. It does not say the
 * rows it was written for were the rows it found, and Sprint 21's whole
 * subject is a repair that would report success while matching nothing if its
 * two steps were ever reordered. So every claim in `SPRINT-21-DDL-NOTES.md` is
 * asserted here against the catalogue and the rows themselves.
 */

import { readFileSync } from 'node:fs';
import postgres from 'postgres';

const match = /^DATABASE_URL=(.*)$/m.exec(
  readFileSync('D:/School-Management-System/.env.local', 'utf8'),
);
const sql = postgres(match[1].trim().replace(/^['"]|['"]$/g, ''), { max: 1, prepare: false });

const STUDENT_1_ROW = '9ebacf91-76da-4216-bb35-aec7a229ef95';
const FATHER_1_ROW = '2c329df7-3b88-4804-8872-c4b4d77e343b';

let failures = 0;
const assert = (ok, label, detail) => {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label}${detail === undefined ? '' : ` — ${detail}`}`);
  if (!ok) failures += 1;
};

console.log('\nThe index:');
const idx = await sql`
  select indexdef from pg_indexes
   where tablename = 'school_users' and indexname = 'school_users_location_email_active_idx'`;
assert(idx.length === 1, 'school_users_location_email_active_idx exists');
if (idx.length === 1) {
  const def = idx[0].indexdef;
  assert(def.includes('UNIQUE'), 'it is UNIQUE');
  assert(def.includes('lower(email)'), 'it is on lower(email)');
  assert(def.includes('WHERE'), 'it is partial', def.slice(def.indexOf('WHERE')));
}

console.log('\nStep 2 — the child got their sentinel back, and the account is unbound:');
const s1 = await sql`
  select su.phone, su.email, su.auth_user_id, su.role, sp.student_id
    from school_users su join student_profiles sp on sp.school_user_id = su.id
   where su.id = ${STUDENT_1_ROW}`;
assert(s1.length === 1, 'the Student 1 directory row is still there');
if (s1.length === 1) {
  assert(s1[0].phone === `student:${s1[0].student_id}`, 'phone is the sentinel', s1[0].phone);
  assert(s1[0].email === null, 'email is NULL', String(s1[0].email));
  assert(s1[0].auth_user_id === null, 'auth_user_id is NULL', String(s1[0].auth_user_id));
  assert(s1[0].role === 'student', 'role is untouched');
}

console.log('\nStep 1 — the father owns all five of his children:');
const kids = await sql`
  select su.name from student_guardians sg
    join student_profiles sp on sp.id = sg.student_profile_id
    join school_users su on su.id = sp.school_user_id
   where sg.school_user_id = ${FATHER_1_ROW} order by su.name`;
assert(kids.length === 5, 'five guardian rows point at the parent row',
  kids.map((r) => r.name).join(', '));

console.log('\nNo guardian is linked to a child, at any school:');
const wrong = await sql`
  select count(*)::int as n from student_guardians sg
    join school_users su on su.id = sg.school_user_id
   where su.role = 'student'`;
assert(wrong[0].n === 0, 'zero guardian rows linked to a student directory row', String(wrong[0].n));

console.log('\nNo duplicate address survives, at any school:');
const dupes = await sql`
  select location_id, lower(email) as e, count(*)::int as n
    from school_users
   where email is not null and email <> '' and is_active
   group by location_id, lower(email) having count(*) > 1`;
assert(dupes.length === 0, 'zero duplicated addresses among active rows',
  dupes.map((r) => `${r.e} x${r.n}`).join(', '));

console.log('\nNo other student row was disturbed:');
const others = await sql`
  select count(*)::int as n from school_users su
    join student_profiles sp on sp.school_user_id = su.id
   where su.role = 'student' and su.phone <> 'student:' || sp.student_id`;
assert(others[0].n === 0, 'every student directory row now carries its sentinel', String(others[0].n));

console.log('\nAnd the constraint has teeth:');
try {
  await sql.begin(async (tx) => {
    const [a] = await tx`select id, location_id, email from school_users
       where email is not null and email <> '' and is_active limit 1`;
    await tx`update school_users set email = ${a.email.toUpperCase()}
              where id = (select id from school_users
                           where location_id = ${a.location_id} and id <> ${a.id}
                             and is_active limit 1)`;
    throw new Error('the index did not refuse a case-varied duplicate');
  });
  assert(false, 'a duplicate address is refused');
} catch (error) {
  const code = error?.cause?.code ?? error?.code ?? null;
  assert(code === '23505', 'a duplicate address is refused with 23505',
    code ?? error.message);
}

console.log(`\n${failures === 0 ? 'PASS' : 'FAIL'} — ${failures} failed assertion(s)\n`);
await sql.end();
process.exit(failures === 0 ? 0 : 1);
