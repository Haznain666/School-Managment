/**
 * Sprint 33b's data step — Askari's Main Campus gets one Principal.
 *
 *     node scripts/apply-sprint33b-data.mjs           # reads, changes nothing
 *     node scripts/apply-sprint33b-data.mjs --apply   # writes, in one transaction
 *
 * ── The decision it carries out ──────────────────────────────────────────
 * The product owner, 2026-09-16: **divisions inside a campus are retired**. One
 * Principal and one Vice Principal per campus, everywhere. Askari is the only
 * `principal_model = 'multiple'` school and it has four active Principals on
 * Main Campus, one per division:
 *
 *   · Imran Qureshi     (…+principalmain2)  stays Principal, now of the whole campus;
 *   · Farah Siddiqui    (…+principalmain1)  becomes a Section Head;
 *   · Rukhsana Bano     (…+principalmain3)  becomes a Section Head;
 *   · Tariq Jameel      (…+principalmain4)  becomes a Section Head.
 *
 * Nadia Hameed (Junior Campus) is already compliant and is not touched.
 *
 * ── Where it sits in the deploy ──────────────────────────────────────────
 *   0047  →  code deploy  →  THIS, with --apply  →  0048
 *
 * `0047` widens `school_users_role_check`, so before it this script refuses to
 * apply. The code must be live first so nobody signs in as a role the portal
 * does not know. `0048` creates the one-head indexes and can only do so after
 * this has run.
 *
 * ── What it writes ───────────────────────────────────────────────────────
 *   1. the three accounts' `role` → `section_head`;
 *   2. their in-force `principal_assignments` **ended** (`ends_on` = today),
 *      never deleted — the table is tenure history on purpose;
 *   3. Imran's in-force division assignment(s) ended the same way, and one new
 *      whole-campus assignment inserted: Main Campus, `division_name` null,
 *      `grade_ids` empty (which the resolver reads as every grade), from today;
 *   4. every current `teacher_principals` row pointing at the three ended
 *      (`ended_at` = now). `resolveTeacherPrincipals` re-derives the next time a
 *      KPI screen loads — see the report for why that is enough.
 *
 * ⚠ `ends_on` is **inclusive** everywhere it is read (`ends_on >= today`), so
 * an assignment ended today is still in force for the rest of today. For the
 * KPI screens that does not matter — `liveAssignments` also requires the role
 * to be `principal`, which the three stop being immediately. Payroll's reader
 * does not check the role, so the three drop out of payroll routing tomorrow.
 *
 * ── What it deliberately does not write ──────────────────────────────────
 *   · `staff_kpi_ratings` — append-only, and every row snapshots the rater's
 *     role, so ratings the three gave as Principals keep counting as that.
 *   · `payroll_run_approvals` — a **pending** row belonging to the three makes
 *     the script **refuse to apply**; nothing is reassigned.
 *   · `section_head_coordinators` — nobody has said which coordinators report
 *     to whom. It is reported empty.
 *   · `chat_grants`, `vice_principal_principals`, transfers, desk seats — read
 *     and reported, because each behaves differently once the role changes.
 *
 * ── Selected by email and slug, never by id ──────────────────────────────
 * Every account is found by its address at the school with this slug, and the
 * script refuses to apply unless the state is **exactly** what the decision
 * describes: four active Principals at one campus, these four addresses, no
 * fifth. A re-run after a successful apply finds one Principal and refuses,
 * which is the idempotency: it never writes twice.
 */

import postgres from 'postgres';
import { readFileSync } from 'node:fs';

const APPLY = process.argv.includes('--apply');
const SLUG = 'askari-school-system';

const STAYS = { email: 'dispatchglobally1+principalmain2@gmail.com', name: 'Imran Qureshi' };
const BECOME_SECTION_HEADS = [
  { email: 'dispatchglobally1+principalmain1@gmail.com', name: 'Farah Siddiqui' },
  { email: 'dispatchglobally1+principalmain3@gmail.com', name: 'Rukhsana Bano' },
  { email: 'dispatchglobally1+principalmain4@gmail.com', name: 'Tariq Jameel' },
];

function loadDatabaseUrl() {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  for (const candidate of ['D:/School-Management-System/.env.local', '.env.local']) {
    try {
      const match = /^DATABASE_URL=(.*)$/m.exec(readFileSync(candidate, 'utf8'));
      if (match?.[1] !== undefined) return match[1].trim().replace(/^['"]|['"]$/g, '');
    } catch {
      // Try the next candidate.
    }
  }
  throw new Error('DATABASE_URL not found');
}

const sql = postgres(loadDatabaseUrl(), { prepare: false, max: 1 });

const problems = [];
const refuse = (message) => problems.push(message);
const line = (text = '') => console.log(text);
const table = (rows) => (rows.length === 0 ? line('    (none)') : console.table(rows));

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

async function readState(locationId, branchId, userIds) {
  const [users, assignments, teacherLinks] = await Promise.all([
    sql`
      select su.id, su.name, su.email, su.role, su.is_active, su.branch_id, b.name as branch
        from school_users su
        left join branches b on b.id = su.branch_id
       where su.location_id = ${locationId}
         and (su.id = any(${userIds}) or (su.role in ('principal', 'vice_principal') and su.is_active and su.branch_id = ${branchId}))
       order by su.role, su.name`,
    sql`
      select pa.id, su.name, pa.branch_id, pa.division_name, cardinality(pa.grade_ids) as grades,
             pa.starts_on::text as starts_on, pa.ends_on::text as ends_on
        from principal_assignments pa
        join school_users su on su.id = pa.school_user_id
       where pa.location_id = ${locationId}
         and pa.school_user_id = any(${userIds})
       order by su.name, pa.starts_on`,
    sql`
      select su.name as principal, count(*)::int as current_teachers,
             string_agg(distinct tp.source, ',') as sources
        from teacher_principals tp
        join school_users su on su.id = tp.principal_user_id
       where tp.location_id = ${locationId}
         and tp.principal_user_id = any(${userIds})
         and tp.ended_at is null
       group by su.name
       order by su.name`,
  ]);
  return { users, assignments, teacherLinks };
}

function printState(title, state) {
  line(`\n── ${title} ──`);
  line('  accounts:');
  table(state.users.map(({ id, ...rest }) => ({ id: id.slice(0, 8), ...rest })));
  line('  principal_assignments (every row, ended ones included):');
  table(state.assignments.map(({ id, branch_id, ...rest }) => ({ id: id.slice(0, 8), branch: branch_id?.slice(0, 8) ?? null, ...rest })));
  line('  current teacher_principals rows pointing at them:');
  table(state.teacherLinks);
}

async function main() {
  line(`Sprint 33b data step — ${APPLY ? 'APPLY' : 'DRY RUN (nothing is written)'}`);

  const schools = await sql`
    select location_id, name, principal_model from schools where slug = ${SLUG}`;
  if (schools.length !== 1) throw new Error(`expected one school with slug ${SLUG}, found ${schools.length}`);
  const school = schools[0];
  line(`school: ${school.name} (${school.location_id}), principal_model = ${school.principal_model}`);

  const wanted = [STAYS, ...BECOME_SECTION_HEADS];
  const accounts = await sql`
    select su.id, su.name, lower(su.email) as email, su.role, su.is_active, su.branch_id, b.name as branch
      from school_users su
      left join branches b on b.id = su.branch_id
     where su.location_id = ${school.location_id}
       and lower(su.email) = any(${wanted.map((person) => person.email.toLowerCase())})`;

  const byEmail = new Map(accounts.map((row) => [row.email, row]));
  for (const person of wanted) {
    const row = byEmail.get(person.email.toLowerCase());
    if (row === undefined) {
      refuse(`no account for ${person.email}`);
      continue;
    }
    if (row.name !== person.name) refuse(`${person.email} is "${row.name}", expected "${person.name}"`);
    if (row.role !== 'principal') refuse(`${row.name} is ${row.role}, expected principal`);
    if (!row.is_active) refuse(`${row.name} is not active`);
  }

  const branchIds = [...new Set(accounts.map((row) => row.branch_id))];
  if (branchIds.length !== 1 || branchIds[0] === null) {
    refuse(`the four accounts are not all at one campus (${JSON.stringify(branchIds)})`);
  }
  const branchId = branchIds[0] ?? null;
  const branchName = accounts[0]?.branch ?? '(unknown)';

  const activePrincipals = branchId === null ? [] : await sql`
    select lower(email) as email, name from school_users
     where location_id = ${school.location_id} and branch_id = ${branchId}
       and role = 'principal' and is_active`;
  if (activePrincipals.length !== 4) {
    refuse(`${branchName} has ${activePrincipals.length} active principal(s), expected exactly 4`);
  }
  const strangers = activePrincipals.filter((row) => !wanted.some((person) => person.email.toLowerCase() === row.email));
  if (strangers.length > 0) refuse(`unexpected principal(s) at ${branchName}: ${strangers.map((row) => row.name).join(', ')}`);

  const imran = byEmail.get(STAYS.email.toLowerCase());
  const heads = BECOME_SECTION_HEADS.map((person) => byEmail.get(person.email.toLowerCase())).filter(Boolean);
  const headIds = heads.map((row) => row.id);
  const allIds = accounts.map((row) => row.id);

  line(`campus: ${branchName} (${branchId})`);

  const before = await readState(school.location_id, branchId, allIds);
  printState('BEFORE', before);

  const today = todayIso();
  const inForce = before.assignments.filter((row) => row.ends_on === null || row.ends_on >= today);
  const futureStarts = inForce.filter((row) => row.starts_on > today);
  if (futureStarts.length > 0) {
    refuse(`assignment(s) starting after today cannot be ended today: ${futureStarts.map((row) => row.id.slice(0, 8)).join(', ')}`);
  }

  /* ── Refusals and reports on what else holds these ids ─────────────── */

  line('\n── What else points at the three ──');

  const pendingPayroll = await sql`
    select pra.id, su.name, pra.status, pr.payroll_month, pr.payroll_year, pr.status as run_status
      from payroll_run_approvals pra
      join school_users su on su.id = pra.principal_user_id
      join payroll_runs pr on pr.id = pra.payroll_run_id
     where pra.location_id = ${school.location_id}
       and pra.principal_user_id = any(${headIds})
     order by pr.payroll_year, pr.payroll_month`;
  line('  payroll_run_approvals (all statuses):');
  table(pendingPayroll.map(({ id, ...rest }) => ({ id: id.slice(0, 8), ...rest })));
  const pending = pendingPayroll.filter((row) => row.status === 'pending');
  if (pending.length > 0) refuse(`${pending.length} PENDING payroll approval(s) belong to the three — payroll is not reassigned by this script`);

  const grants = await sql`
    select cg.id, su.name, cg.effect, cg.scope_type, cg.granted_by_role, cg.granted_by_rank,
           cg.ends_at, cg.revoked_at
      from chat_grants cg
      join school_users su on su.id = cg.granted_by
     where cg.location_id = ${school.location_id}
       and cg.granted_by = any(${headIds})
       and cg.revoked_at is null
       and (cg.ends_at is null or cg.ends_at > now())`;
  line('  live chat_grants they issued (rank is snapshotted — these keep rank 80):');
  table(grants.map(({ id, ...rest }) => ({ id: id.slice(0, 8), ...rest })));

  const scopedGrants = await sql`
    select count(*)::int as n from chat_grants
     where location_id = ${school.location_id} and scope_type = 'school_user'
       and scope_id = any(${headIds.map(String)}) and revoked_at is null`;
  line(`  live chat_grants naming them as the subject: ${scopedGrants[0].n}`);

  const deputies = await sql`
    select vp.name as vice_principal, su.name as serves
      from vice_principal_principals vpp
      join school_users vp on vp.id = vpp.vice_principal_user_id
      join school_users su on su.id = vpp.principal_user_id
     where vpp.location_id = ${school.location_id}
       and vpp.principal_user_id = any(${headIds})`;
  line('  vice_principal_principals serving one of the three (would serve nobody):');
  table(deputies);

  const transfers = await sql`
    select tpt.id, t.name as teacher, f.name as from_principal, p.name as to_principal
      from teacher_principal_transfers tpt
      join school_users t on t.id = tpt.teacher_user_id
      left join school_users f on f.id = tpt.from_principal_user_id
      join school_users p on p.id = tpt.to_principal_user_id
     where tpt.location_id = ${school.location_id}
       and tpt.status = 'requested'
       and (tpt.from_principal_user_id = any(${headIds}) or tpt.to_principal_user_id = any(${headIds}))`;
  line('  open teacher_principal_transfers involving them:');
  table(transfers.map(({ id, ...rest }) => ({ id: id.slice(0, 8), ...rest })));

  const deskSeats = await sql`
    select su.name, cc.role_inbox, count(*)::int as open_threads
      from chat_participants cp
      join chat_conversations cc on cc.id = cp.conversation_id
      join school_users su on su.id = cp.school_user_id
     where cp.location_id = ${school.location_id}
       and cp.school_user_id = any(${headIds})
       and cp.left_at is null
       and cc.role_inbox is not null
     group by su.name, cc.role_inbox`;
  line('  desk-thread seats (Principal Office is answered by principal/vice_principal only):');
  table(deskSeats);

  const ratings = await sql`
    select su.name, count(*)::int as ratings_given
      from staff_kpi_ratings r join school_users su on su.id = r.rater_user_id
     where r.location_id = ${school.location_id} and r.rater_user_id = any(${headIds})
     group by su.name`;
  line('  staff_kpi_ratings they gave (left alone — rater_role is snapshotted):');
  table(ratings);

  const staffRows = await sql`
    select su.name, s.employee_code, s.designation
      from staff s join school_users su on su.id = s.school_user_id
     where s.location_id = ${school.location_id} and s.school_user_id = any(${headIds})`;
  line('  staff records (designation text is not changed):');
  table(staffRows);

  const chainTable = await sql`select to_regclass('public.section_head_coordinators') as t`;
  if (chainTable[0].t === null) {
    line('  section_head_coordinators: table absent (0047 not applied) — no links would be created anyway');
  } else {
    const links = await sql`
      select count(*)::int as n from section_head_coordinators where location_id = ${school.location_id}`;
    line(`  section_head_coordinators at Askari: ${links[0].n} — nobody has said which coordinators report to whom, so none are created`);
  }

  const roleCheck = await sql`
    select pg_get_constraintdef(oid) as def from pg_constraint where conname = 'school_users_role_check'`;
  const widened = (roleCheck[0]?.def ?? '').includes('section_head');
  line(`\n0047 applied (school_users_role_check admits section_head): ${widened ? 'YES' : 'NO'}`);
  if (!widened) refuse('0047 is not applied: school_users_role_check does not admit section_head yet');

  /* ── The plan ───────────────────────────────────────────────────────── */

  const imranInForce = inForce.filter((row) => imran !== undefined && row.name === imran.name);
  const headsInForce = inForce.filter((row) => heads.some((head) => head.name === row.name));
  const imranWholeCampus = imranInForce.find(
    (row) => row.branch_id === branchId && row.division_name === null && row.grades === 0,
  );

  line('\n── Plan ──');
  line(`  1. role → section_head: ${heads.map((row) => row.name).join(', ')}`);
  line(`  2. end ${headsInForce.length} in-force assignment(s) of theirs (ends_on = ${today})`);
  line(`  3. end ${imranInForce.filter((row) => row !== imranWholeCampus).length} in-force division assignment(s) of Imran's; ${imranWholeCampus ? 'he already has a whole-campus assignment — none inserted' : `insert one whole-campus assignment at ${branchName} from ${today}`}`);
  const headLinks = before.teacherLinks.filter((row) => heads.some((head) => head.name === row.principal));
  line(
    `  4. end ${headLinks.reduce((sum, row) => sum + row.current_teachers, 0)} current teacher_principals row(s) pointing at the three (${headLinks.map((row) => `${row.principal} ${row.current_teachers}`).join(', ') || 'none'}); Imran's are left as they are`,
  );
  line('     derivation: resolveTeacherPrincipals ends a derived row whose principal is not wanted and inserts');
  line('     the derived one; with Imran whole-campus every Main teacher derives to him. It runs on the next');
  line('     KPI screen load (loadKpiContext). No explicit row is needed unless a teacher also teaches at');
  line('     Junior Campus with equal periods — that is a tie, and the School Admin settles it on Setup.');

  if (problems.length > 0) {
    line('\n── REFUSED ──');
    for (const problem of problems) line(`  ✗ ${problem}`);
    if (APPLY) {
      line('\nNothing was written.');
      process.exitCode = 1;
    } else {
      line('\nDry run: --apply would refuse until every line above is resolved.');
    }
    return;
  }

  if (!APPLY) {
    line('\nDry run: every precondition holds. Re-run with --apply to write.');
    return;
  }

  /* ── Apply, in one transaction ──────────────────────────────────────── */

  await sql.begin(async (tx) => {
    const roled = await tx`
      update school_users set role = 'section_head', updated_at = now()
       where location_id = ${school.location_id} and id = any(${headIds})
         and role = 'principal' and is_active
      returning id`;
    if (roled.length !== 3) throw new Error(`expected 3 role changes, got ${roled.length}`);

    const endIds = [...headsInForce, ...imranInForce.filter((row) => row !== imranWholeCampus)].map((row) => row.id);
    if (endIds.length > 0) {
      const ended = await tx`
        update principal_assignments set ends_on = ${today}, updated_at = now()
         where location_id = ${school.location_id} and id = any(${endIds})
           and (ends_on is null or ends_on >= ${today})
        returning id`;
      if (ended.length !== endIds.length) throw new Error(`expected ${endIds.length} assignments ended, got ${ended.length}`);
    }

    if (!imranWholeCampus) {
      await tx`
        insert into principal_assignments (location_id, school_user_id, branch_id, division_name, grade_ids, starts_on)
        values (${school.location_id}, ${imran.id}, ${branchId}, null, ARRAY[]::text[], ${today})`;
    }

    await tx`
      update teacher_principals set ended_at = now()
       where location_id = ${school.location_id}
         and principal_user_id = any(${headIds})
         and ended_at is null`;
  });

  const after = await readState(school.location_id, branchId, allIds);
  printState('AFTER', after);
  line('\nApplied. Next: apply 0048, and read its NOTICE/WARNINGs.');
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => sql.end());
