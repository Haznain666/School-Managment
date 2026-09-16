/**
 * Sprint 32 — staff KPIs. The rules, then every new statement, executed.
 *
 *     npm run check-sprint32
 *
 * ── Part one needs no database ───────────────────────────────────────────
 * The pure rules in `lib/kpis.ts`: the senior rater counts, a change supersedes,
 * the plain average, who may define for whom, one teacher → one principal, and
 * the permission defaults §5ca fixes (Branch Admin never rates teachers; a Vice
 * Principal never rates a Vice Principal; Finance holds the overall only).
 *
 * ── Part two executes against the real schema ────────────────────────────
 * Printing `toSQL()` proves names; only a server proves a statement (CLAUDE.md).
 * Every read the KPI screens make runs here with a tenant that matches no row.
 * The script reads whether `0045` is applied rather than being told:
 *
 *   · before it, statements touching the new tables must fail with exactly
 *     `42P01` / `42703` — **any other error is a real defect wearing a
 *     predicted failure's clothes**;
 *   · after it, every statement must execute.
 *
 * A statement that is only reached after one of the new tables (the teacher
 * profile, behind `listKpis`) is called directly, so it is never reported as
 * passed while short-circuited (Trap 2).
 */

import { readdirSync, readFileSync } from 'node:fs';

import { sql } from 'drizzle-orm';

function loadDatabaseUrl(): void {
  if (process.env.DATABASE_URL !== undefined) return;
  for (const candidate of ['D:/School-Management-System/.env.local', '.env.local']) {
    try {
      const match = /^DATABASE_URL=(.*)$/m.exec(readFileSync(candidate, 'utf8'));
      if (match?.[1] !== undefined) {
        process.env.DATABASE_URL = match[1].trim().replace(/^['"]|['"]$/g, '');
        return;
      }
    } catch {
      // next
    }
  }
  throw new Error('DATABASE_URL not found');
}

const NOBODY = '00000000-0000-0000-0000-000000000000';
const TENANT = 'no-such-tenant-sprint32';

let passes = 0;
let failures = 0;

function pass(label: string, detail = ''): void {
  passes += 1;
  console.log(`  ok    ${label}${detail === '' ? '' : ` — ${detail}`}`);
}

function fail(label: string, detail: string): void {
  failures += 1;
  console.error(`  FAIL  ${label}\n        ${detail}`);
}

function assert(label: string, condition: boolean, detail = ''): void {
  if (condition) pass(label);
  else fail(label, detail);
}

/** The SQLSTATE lives on the error's `cause` chain, not on the error. */
function sqlState(error: unknown): string | null {
  let current: unknown = error;
  for (let depth = 0; depth < 6 && current != null; depth += 1) {
    const code = (current as { code?: unknown }).code;
    if (typeof code === 'string' && /^[0-9A-Z]{5}$/.test(code)) return code;
    current = (current as { cause?: unknown }).cause;
  }
  return null;
}

function reason(error: unknown): string {
  let current: unknown = error;
  for (let depth = 0; depth < 6 && current != null; depth += 1) {
    const message = (current as { message?: unknown }).message;
    if (typeof message === 'string' && !message.startsWith('Failed query')) {
      return message.split('\n')[0]!.slice(0, 120);
    }
    current = (current as { cause?: unknown }).cause;
  }
  return String(error).slice(0, 120);
}

/**
 * Runs one statement. `needsMigration` says whether it touches `0045`'s tables:
 * before the migration only 42P01/42703 is acceptable, after it nothing is.
 */
async function execute(
  label: string,
  needsMigration: boolean,
  applied: boolean,
  run: () => Promise<unknown>,
): Promise<void> {
  try {
    const value = await run();
    if (needsMigration && !applied) {
      fail(label, 'executed although 0045 is not applied — the prediction is wrong');
      return;
    }
    pass(label, Array.isArray(value) ? `${String(value.length)} row(s)` : 'executed');
  } catch (error) {
    const code = sqlState(error);
    if (needsMigration && !applied && (code === '42P01' || code === '42703')) {
      pass(label, `predicted ${code} before 0045`);
      return;
    }
    fail(label, `${code ?? '?'} ${reason(error)}`);
  }
}

async function main(): Promise<void> {
  /* ══════════════════════════════════════════════ part one: the rules */

  const kpis = await import('../lib/kpis');
  const { DEFAULT_ROLE_PERMISSIONS, PERMISSIONS, PERMISSION_GROUPS, PERMISSION_LABELS } =
    await import('../lib/permissions');
  const { PLATFORM_MODULE_KEYS } = await import('../lib/platform-modules');

  console.log('\nThe module and the keys:');
  assert('staff_kpis is a platform module', PLATFORM_MODULE_KEYS.includes('staff_kpis'));

  /*
   * Counted from the catalogue rather than written as a literal.
   *
   * It said `=== 10`, which was true until Sprint 33b gave the Section Head a
   * KPI target role and `kpis.rate.section_head` with it. The claim worth
   * asserting is not "there are ten" — it is **one rate key per target role
   * that has one, plus the four that are not rate keys**, which stays true the
   * next time a role joins.
   */
  const kpiKeys = PERMISSIONS.filter((key) => key.startsWith('kpis.'));
  const rateKeys = kpis.STAFF_KPI_TARGET_ROLES.filter((role) => kpis.rateKeyFor(role) !== null);
  assert(
    'one kpis.rate.* key per rateable role, plus read/create/delete/overall',
    kpiKeys.length === rateKeys.length + 4,
    kpiKeys.join(', '),
  );
  assert(
    'every kpis.* key is in a permission group and has a label',
    kpiKeys.every(
      (key) =>
        PERMISSION_GROUPS.some((group) => group.permissions.includes(key)) &&
        PERMISSION_LABELS[key] !== '',
    ),
  );

  /*
   * `0045` is still the authority on the **module** key, which nothing since
   * has touched. It is no longer the authority on the permission list:
   * `0047` rewrote `role_permissions_permission_check` for
   * `kpis.rate.section_head`, so asking `0045` about that key reports it as
   * missing from a file that is not the one enforcing it any more. The same
   * lesson `check-branch-scope` learnt in CI when `0040` widened the
   * constraint — look the file up rather than naming it.
   */
  const migration = readFileSync('db/migrations/0045_sprint32_staff_kpis.sql', 'utf8');
  assert('0045 names the module key', migration.includes("'staff_kpis'"));

  const needle = 'ADD CONSTRAINT "role_permissions_permission_check"';
  const constraintFile =
    readdirSync('db/migrations')
      .filter((name) => name.endsWith('.sql'))
      .sort()
      .reverse()
      .find((name) => readFileSync(`db/migrations/${name}`, 'utf8').includes(needle)) ?? '(none)';

  const constraint =
    constraintFile === '(none)' ? '' : readFileSync(`db/migrations/${constraintFile}`, 'utf8');

  assert(
    `the newest CHECK (${constraintFile}) names every kpis.* key`,
    kpiKeys.every((key) => constraint.includes(`'${key}'`)),
    kpiKeys.filter((key) => !constraint.includes(`'${key}'`)).join(', '),
  );

  console.log('\nThe default grid (§5ca):');
  const holds = (role: keyof typeof DEFAULT_ROLE_PERMISSIONS, key: string): boolean =>
    (DEFAULT_ROLE_PERMISSIONS[role] as readonly string[]).includes(key);

  assert('Branch Admin never rates teachers', !holds('branch_admin', 'kpis.rate.teacher'));
  assert(
    'Branch Admin rates coordinators and non-teaching staff',
    ['kpis.rate.coordinator', 'kpis.rate.hr_manager', 'kpis.rate.accountant', 'kpis.rate.marketing'].every(
      (key) => holds('branch_admin', key),
    ),
  );
  assert('Principal rates the Vice Principal', holds('principal', 'kpis.rate.vice_principal'));
  assert(
    'Vice Principal never rates a Vice Principal',
    !holds('vice_principal', 'kpis.rate.vice_principal'),
  );
  assert(
    'Vice Principal holds the Principal’s other KPI keys (rule 7c)',
    kpiKeys
      .filter((key) => key !== 'kpis.rate.vice_principal')
      .every((key) => holds('principal', key) === holds('vice_principal', key)),
  );
  assert(
    'Coordinator reads and rates teachers, never creates or deletes',
    holds('coordinator', 'kpis.read') &&
      holds('coordinator', 'kpis.rate.teacher') &&
      !holds('coordinator', 'kpis.create') &&
      !holds('coordinator', 'kpis.delete'),
  );
  assert(
    'Finance holds the overall and nothing else',
    DEFAULT_ROLE_PERMISSIONS.accountant.filter((key) => key.startsWith('kpis.')).join() === 'kpis.overall',
  );
  assert('HR reads scores', holds('hr_manager', 'kpis.read'));
  assert('no rate key exists for principals or branch admins', kpis.rateKeyFor('principal') === null && kpis.rateKeyFor('branch_admin') === null);

  console.log('\nWho may define for whom (rule 3):');
  // Counted from the list rather than written as a literal: Sprint 33b added
  // `section_head` to it, and a number typed here is a number that goes stale
  // the next time a role joins.
  assert(
    'School Admin defines for every role',
    kpis.definableTargets('school_admin').length === kpis.STAFF_KPI_TARGET_ROLES.length,
  );
  for (const role of ['principal', 'branch_admin'] as const) {
    const targets = kpis.definableTargets(role);
    assert(
      `${role}: not for Principal or Branch Admin`,
      !targets.includes('principal') && !targets.includes('branch_admin') && targets.includes('teacher'),
      targets.join(','),
    );
  }
  assert(
    'Vice Principal: not for Principal, Branch Admin or Vice Principal',
    !kpis.definableTargets('vice_principal').some((role) =>
      ['principal', 'branch_admin', 'vice_principal'].includes(role),
    ),
  );
  assert('Coordinator defines for nobody', kpis.definableTargets('coordinator').length === 0);

  console.log('\nThe senior rater counts (rule 5), a change supersedes:');
  const rating = (
    id: string,
    raterRole: string,
    score: number,
    createdAt: string,
    raterUserId = raterRole,
  ): import('../lib/kpis').RatingRecord => ({
    id,
    kpiId: 'k',
    ratedUserId: 't',
    month: '2026-09',
    score,
    comment: null,
    raterUserId,
    raterRole,
    raterName: raterRole,
    createdAt,
  });

  const coordinatorFirst = rating('c1', 'coordinator', 9, '2026-09-10T00:00:00Z');
  const principal = rating('p1', 'principal', 7, '2026-09-11T00:00:00Z');
  const coordinatorLater = rating('c2', 'coordinator', 10, '2026-09-12T00:00:00Z');

  assert(
    'Principal outranks a later coordinator rating',
    kpis.countingRating(kpis.currentRatings([coordinatorFirst, principal, coordinatorLater]))?.id === 'p1',
  );
  assert(
    'a rater’s latest row is their answer',
    kpis.currentRatings([coordinatorFirst, coordinatorLater]).map((row) => row.id).join() === 'c2',
  );
  assert(
    'Vice Principal outranks Branch Admin; School Admin outranks all',
    kpis.seniorityOf('vice_principal') > kpis.seniorityOf('branch_admin') &&
      kpis.seniorityOf('school_admin') > kpis.seniorityOf('principal') &&
      kpis.seniorityOf('principal') > kpis.seniorityOf('vice_principal'),
  );

  console.log('\nThe plain average (rule 6) and the worked example:');
  const counting = kpis.countingByCell([
    { ...rating('a', 'coordinator', 10, '2026-09-10T00:00:00Z'), kpiId: 'punctuality' },
    { ...rating('b', 'coordinator', 6, '2026-09-10T00:00:00Z'), kpiId: 'planning' },
    { ...rating('c', 'principal', 8, '2026-09-10T00:00:00Z'), kpiId: 'conduct', month: null },
  ]);
  const periods = new Map<string, 'monthly' | 'annual'>([
    ['punctuality', 'monthly'],
    ['planning', 'monthly'],
    ['conduct', 'annual'],
  ]);
  const summary = kpis.summarise('t', counting, periods, '2026-09');
  assert('Punctuality 10/10 is 100%', kpis.scorePercent(10) === 100);
  assert('monthly overall averages monthly KPIs only: (10+6)/2 = 80%', summary.monthly === 80, String(summary.monthly));
  assert('yearly overall averages every score: (10+6+8)/3 = 80%', summary.yearly === 80, String(summary.yearly));
  assert('nothing rated is null, never 0%', kpis.averageScore([]) === null && kpis.formatPercent(null) === '—');

  console.log('\nOne teacher, one principal (rule 7b):');
  const matric = { principalUserId: 'P-matric', branchId: 'B1', gradeIds: ['g8'] };
  const olevels = { principalUserId: 'P-olevels', branchId: 'B1', gradeIds: ['o1'] };
  const overall = { principalUserId: 'P-overall', branchId: null, gradeIds: [] as string[] };

  const most = kpis.derivePrincipal(
    [matric, olevels, overall],
    [
      { gradeId: 'g8', branchId: 'B1', periods: 6 },
      { gradeId: 'o1', branchId: 'B1', periods: 4 },
    ],
    [],
  );
  assert(
    'most periods wins, and the overall head does not dilute it',
    most.principalUserId === 'P-matric' && most.reason === 'most_periods',
    JSON.stringify(most),
  );

  const tie = kpis.derivePrincipal(
    [matric, olevels],
    [
      { gradeId: 'g8', branchId: 'B1', periods: 5 },
      { gradeId: 'o1', branchId: 'B1', periods: 5 },
    ],
    [{ gradeId: 'o1', branchId: 'B1' }],
  );
  assert('a tie goes to the class-teacher section’s principal', tie.principalUserId === 'P-olevels' && tie.reason === 'class_teacher');

  const unbroken = kpis.derivePrincipal(
    [matric, olevels],
    [
      { gradeId: 'g8', branchId: 'B1', periods: 5 },
      { gradeId: 'o1', branchId: 'B1', periods: 5 },
    ],
    [],
  );
  assert('an unbroken tie is nobody’s, for the School Admin', unbroken.principalUserId === null && unbroken.reason === 'tie');

  const idle = kpis.derivePrincipal([matric, olevels], [], []);
  assert('no periods and no class is unassigned, not hidden', idle.principalUserId === null && idle.reason === 'no_periods');

  const otherCampus = kpis.principalsForGrade([{ principalUserId: 'P2', branchId: 'B2', gradeIds: [] }], 'g8', 'B1');
  assert('a campus-wide head does not reach another campus’s grades', otherCampus.length === 0);

  console.log('\nRule 7’s settings:');
  assert('defaults: nobody rates principals or branch admins', !kpis.DEFAULT_KPI_SETTINGS.ratePrincipals && !kpis.DEFAULT_KPI_SETTINGS.rateBranchAdmins);
  assert(
    'the Vice Principal is not offered as a principal rater',
    !(kpis.PRINCIPAL_RATER_OPTIONS as readonly string[]).includes('vice_principal'),
  );
  assert(
    'a rater from the wrong list is refused',
    typeof kpis.parseKpiSettings({
      ratePrincipals: true,
      principalRaters: ['principal'],
      rateBranchAdmins: false,
      branchAdminRaters: [],
    }) === 'string',
  );
  assert('a future month key is well-formed but month 13 is not', kpis.isMonthKey('2026-12') && !kpis.isMonthKey('2026-13'));

  /* ══════════════════════════════════ part two: against the real schema */

  loadDatabaseUrl();
  const { db } = await import('../lib/drizzle');

  const regclass = (await db.execute(sql`select to_regclass('public.staff_kpi_ratings') as t`)) as unknown as Array<{ t: string | null }>;
  const applied = regclass[0]?.t != null;
  console.log(`\n0045 is ${applied ? 'APPLIED' : 'NOT applied'} — ${applied ? 'every statement must execute' : 'new-table statements must fail with 42P01/42703'}`);

  const access = await import('../lib/kpi-access');
  const board = await import('../lib/kpi-board');

  console.log('\nReads on tables that already exist:');
  await execute('listStaffPeople', false, applied, () => access.listStaffPeople(TENANT));
  await execute('liveAssignments — principal_assignments ⋈ school_users', false, applied, () => access.liveAssignments(TENANT));
  await execute('listYears', false, applied, () => access.listYears(TENANT));
  await execute(
    'teacherProfile — timetable ⋈ sections ⋈ grades ⋈ subjects, register, leave, lesson plans',
    false,
    applied,
    () =>
      board.teacherProfile(
        TENANT,
        {
          userId: NOBODY,
          name: 'Nobody',
          role: 'teacher',
          branchId: null,
          branchName: null,
          staffId: NOBODY,
          designation: null,
        },
        '2026-09',
      ),
  );

  console.log('\nReads on 0045’s tables:');
  await execute('getKpiSettings', true, applied, () => access.getKpiSettings(TENANT));
  await execute('listKpis — staff_kpis ⋈ branches ⋈ school_users', true, applied, () => access.listKpis(TENANT, null));
  await execute('listKpis, campus-scoped', true, applied, () => access.listKpis(TENANT, [NOBODY]));
  await execute('getKpi', true, applied, () => access.getKpi(TENANT, NOBODY));
  await execute('listRatings', true, applied, () => access.listRatings(TENANT, NOBODY, [NOBODY]));
  await execute(
    'resolveTeacherPrincipals — the period count ⋈ grades, class teachers, current rows',
    true,
    applied,
    () =>
      access.resolveTeacherPrincipals(
        TENANT,
        'multiple',
        [{ userId: NOBODY, name: 'Nobody', role: 'teacher', branchId: null, branchName: null, staffId: null, designation: null }],
        [],
        [],
      ),
  );
  await execute('loadKpiContext (school admin)', true, applied, () =>
    access.loadKpiContext(TENANT, { uid: NOBODY, role: 'school_admin', branchId: null }),
  );

  if (applied) {
    const ctx = await access.loadKpiContext(TENANT, { uid: NOBODY, role: 'school_admin', branchId: null });
    await execute('buildBoard', true, applied, () => board.buildBoard(ctx, '2026-09'));
    await execute('buildSetup + listTransfers', true, applied, () => board.buildSetup({ ...ctx, model: 'multiple' }));
  } else {
    console.log('  --    buildBoard / buildSetup — not exercised: they start from loadKpiContext, which needs 0045');
  }

  console.log(`\n${failures === 0 ? 'PASS' : 'FAIL'} — ${String(passes)} passed, ${String(failures)} failed.`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
