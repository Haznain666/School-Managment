/**
 * Sprint 33b — the rules, then every new or widened statement, executed.
 *
 *     npm run check-sprint33b
 *
 * ── Part one needs no database ───────────────────────────────────────────
 * The rules this part turns on, and the places where a rule is only a rule
 * because both sides ask the same function:
 *
 *   · `section_head` exists everywhere `USER_ROLES` obliges it to, ranks 45 in
 *     chat and second-from-bottom in KPI seniority, and **cannot ban a named
 *     person** — 45 < the Branch Admin's 50, which is the threshold. Decision
 *     14, asserted rather than assumed.
 *   · `0047` rewrites **six** CHECK constraints. The spec named three; the
 *     other three — invitations, `role_permissions.role` and the Saturday duty
 *     roster — are each reached only by a school that has configured
 *     something, which is the case no default-driven test touches. A missing
 *     one is a 23514 on a screen that has never failed.
 *   · the chain of command resolves upward and **skips a missing level**, and
 *     a teacher under several coordinators routes past them. That is a rule,
 *     not an error, and it is where every junior teacher lands.
 *   · the day counter, the pro-rated entitlement and the 180-day probation
 *     ceiling, which the form, the API and this script all call.
 *
 * ── Part two executes against the real schema ────────────────────────────
 * Printing `toSQL()` proves the names; only a server proves a statement
 * (CLAUDE.md). An ambiguous column reference is a *planning* error, so a
 * statement that has been read and not run is evidence about spelling and
 * nothing else — which is how 42702 shipped three times. `listLeaveForSchool`
 * is the one to watch here: it joins `school_users` for the decider's name
 * beside `staff`, `branches` and `leave_types`.
 *
 * The script reads whether `0047` is applied rather than being told, so one
 * command works on both sides of it. Before it, a statement touching the new
 * tables must fail with exactly `42P01` and one touching `staff.permanent_from`
 * with exactly `42703` — **any other error is a real defect wearing a predicted
 * failure's clothes**.
 *
 * ── What is deliberately not executed, and why it is said here ───────────
 *  · `claimEndedProbations`, `sweepProbations`, `setHolidaySpan`,
 *    `ensureStaffCalendars`. All four write. `check-sprint24`'s header states
 *    the rule this follows: a check script that issues an `UPDATE` against a
 *    live database is one edit away from issuing one that matches.
 *  · `listApprovalInbox` and `getLeaveForDecision` **short-circuit** on a
 *    tenant that matches no row — they return before they reach the chain
 *    reads. They are reported as *not exercised* rather than passed, because a
 *    broken statement hiding behind an early return is exactly the trap this
 *    pattern was written for. Their reads are covered directly by
 *    `loadChainIndex` and `listChainSetup` below.
 *
 * Two traps, both paid for the first time this pattern was written: the
 * SQLSTATE is on the error's `cause` and not on the error, so reading `.code`
 * reports every failure as unpredicted; and a read that short-circuits must be
 * reported rather than counted.
 *
 * Reads `DATABASE_URL` from the main checkout's `.env.local`, because a
 * worktree has no env of its own.
 */

import { readdirSync, readFileSync } from 'node:fs';

import { sql } from 'drizzle-orm';

function loadDatabaseUrl(): void {
  if (process.env.DATABASE_URL !== undefined) return;

  for (const candidate of [
    'D:/School-Management-System/.env.local',
    '../../../.env.local',
    '.env.local',
  ]) {
    try {
      const match = /^DATABASE_URL=(.*)$/m.exec(readFileSync(candidate, 'utf8'));
      if (match?.[1] !== undefined) {
        process.env.DATABASE_URL = match[1].trim().replace(/^['"]|['"]$/g, '');
        console.log(`  using DATABASE_URL from ${candidate}`);
        return;
      }
    } catch {
      // Try the next candidate.
    }
  }

  throw new Error('DATABASE_URL not found — set it, or run from a checkout with .env.local');
}

/** A syntactically valid id that belongs to no tenant and no row. */
const NOBODY = '00000000-0000-0000-0000-000000000000';
const TENANT = 'no-such-tenant-sprint33b';

/** "Undefined table" and "undefined column" — what `0047` fixes. */
const UNDEFINED_TABLE = '42P01';
const UNDEFINED_COLUMN = '42703';

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

/** The SQLSTATE lives on the error's `cause` chain, not on the error. Trap 1. */
function sqlState(error: unknown): string | null {
  let current: unknown = error;
  for (let depth = 0; depth < 6 && current != null; depth += 1) {
    const code = (current as { code?: unknown }).code;
    if (typeof code === 'string' && /^[0-9A-Z]{5}$/.test(code)) return code;
    current = (current as { cause?: unknown }).cause;
  }
  return null;
}

/** The reason, without postgres-js's copy of the whole statement. */
function reason(error: unknown): string {
  let current: unknown = error;
  for (let depth = 0; depth < 6 && current != null; depth += 1) {
    const message = (current as { message?: unknown }).message;
    if (typeof message === 'string' && !message.startsWith('Failed query')) {
      return (message.split('\n')[0] ?? message).slice(0, 120);
    }
    current = (current as { cause?: unknown }).cause;
  }
  return String(error).slice(0, 120);
}

/** A statement whose execution is the whole assertion. */
async function mustRun(label: string, run: () => Promise<unknown>): Promise<void> {
  try {
    const value = await run();
    pass(label, Array.isArray(value) ? `${String(value.length)} row(s)` : 'executed');
  } catch (error) {
    fail(label, `${sqlState(error) ?? '?'} ${reason(error)}`);
  }
}

/**
 * A statement that touches something `0047` adds.
 *
 * Applied: it must execute. Not applied: it must fail with **exactly** the
 * SQLSTATE predicted for it — `42P01` for the four new tables, `42703` for the
 * seven new columns on `staff`. A different one is a different defect, and
 * treating it as the predicted one is how a real fault hides behind an expected
 * failure.
 */
function afterMigration(applied: boolean, expected: string) {
  return async (label: string, run: () => Promise<unknown>): Promise<void> => {
    if (applied) {
      await mustRun(label, run);
      return;
    }

    try {
      await run();
      fail(label, 'it executed although 0047 is not applied — the prediction is wrong');
    } catch (error) {
      const state = sqlState(error);
      if (state === expected) {
        pass(label, `predicted ${expected} — waiting on 0047`);
        return;
      }
      fail(label, `expected ${expected} before 0047, got ${state ?? '?'} ${reason(error)}`);
    }
  };
}

/**
 * Source text, always LF.
 *
 * The repository is developed on Windows with `core.autocrlf=true`, so the
 * working tree is CRLF and git stores LF. A pattern anchored on `\n` therefore
 * matches in one checkout and silently matches **nothing** in another —
 * `scripts/check-branch-scope.ts` normalises for the same reason and its
 * docblock records the cost. Found here when QA round 1's F5 assertion passed
 * in the build agent's worktree and failed in the session's.
 */
const source = (path: string): string =>
  readFileSync(path, 'utf8').split('\r\n').join('\n');

async function main(): Promise<void> {
  /* ══════════════════════════════════════════════ part one: the rules */

  const { USER_ROLES, ROLE_HOME_ROUTES, ROLE_LABELS, ADMIN_PORTAL_ROLES, INVITABLE_ROLES } =
    await import('../types/school-auth');
  const { GRANT_RANKS } = await import('../db/schema/chat-grants');
  const kpis = await import('../lib/kpis');
  const { PERMISSIONS, DEFAULT_ROLE_PERMISSIONS, PERMISSION_GROUPS, PERMISSION_LABELS } =
    await import('../lib/permissions');

  console.log('\nB1 — section_head is a role everywhere a role has to be:');

  assert('it is in USER_ROLES', (USER_ROLES as readonly string[]).includes('section_head'));
  assert('it lands on /dashboard', ROLE_HOME_ROUTES.section_head === '/dashboard');
  assert('it is called Section Head', ROLE_LABELS.section_head === 'Section Head');
  assert(
    'it shares the administrative portal, and can be invited',
    ADMIN_PORTAL_ROLES.includes('section_head') && INVITABLE_ROLES.includes('section_head'),
  );
  assert(
    'it is a KPI target role, with a rate key',
    (kpis.STAFF_KPI_TARGET_ROLES as readonly string[]).includes('section_head') &&
      kpis.rateKeyFor('section_head') === 'kpis.rate.section_head',
  );

  console.log('\nDecision 14 — rank 45, and what it deliberately cannot do:');

  assert('the chat grant rank is 45', GRANT_RANKS.section_head === 45, String(GRANT_RANKS.section_head));
  assert(
    'below the Branch Admin and above the Coordinator',
    GRANT_RANKS.section_head < GRANT_RANKS.branch_admin &&
      GRANT_RANKS.section_head > GRANT_RANKS.coordinator,
  );
  assert(
    'so a Section Head cannot ban a named person from chat',
    GRANT_RANKS.section_head < GRANT_RANKS.branch_admin,
    'the threshold is RANK_TO_BAN_A_PERSON = GRANT_RANKS.branch_admin',
  );
  assert(
    'and the threshold is still tied to the Branch Admin, not to a literal',
    /const RANK_TO_BAN_A_PERSON = GRANT_RANKS\.branch_admin;/.test(source('lib/chat-grant-scope.ts')),
  );
  assert(
    'KPI seniority ranks it under the Branch Admin',
    kpis.seniorityOf('section_head') < kpis.seniorityOf('branch_admin') &&
      kpis.seniorityOf('section_head') > kpis.seniorityOf('coordinator'),
  );

  console.log('\nB3 — the four leave keys, and who holds them:');

  const holds = (role: keyof typeof DEFAULT_ROLE_PERMISSIONS, key: string): boolean =>
    (DEFAULT_ROLE_PERMISSIONS[role] as readonly string[]).includes(key);

  for (const key of ['leave.read', 'leave.request', 'leave.approve', 'leave.manage'] as const) {
    assert(`${key} is in the catalogue`, (PERMISSIONS as readonly string[]).includes(key));
    assert(`${key} has a label`, (PERMISSION_LABELS[key] ?? '') !== '');
    assert(
      `${key} is on the matrix`,
      PERMISSION_GROUPS.some((group) => (group.permissions as readonly string[]).includes(key)),
    );
  }

  assert(
    'every approving role holds leave.approve',
    (['coordinator', 'section_head', 'vice_principal', 'branch_admin', 'principal'] as const).every(
      (role) => holds(role, 'leave.approve'),
    ),
  );
  assert(
    'the Branch Admin holds it — Part A’s QA finding, which is what this key is for',
    holds('branch_admin', 'leave.approve'),
  );
  assert(
    'and it was NOT fixed by granting them hr.write',
    !holds('branch_admin', 'hr.write'),
    'a campus office has been handed the whole HR module',
  );
  assert(
    'HR manages leave and does not approve it',
    holds('hr_manager', 'leave.manage') && !holds('hr_manager', 'leave.approve'),
  );
  assert(
    'a teacher applies and reads nobody else’s',
    holds('teacher', 'leave.request') && !holds('teacher', 'leave.read'),
  );
  assert(
    'every staff role can apply for their own leave',
    (
      [
        'branch_admin',
        'principal',
        'vice_principal',
        'section_head',
        'coordinator',
        'teacher',
        'accountant',
        'hr_manager',
        'marketing',
      ] as const
    ).every((role) => holds(role, 'leave.request')),
  );
  assert(
    'a pupil and a parent hold none of them',
    (['student', 'parent'] as const).every(
      (role) => !DEFAULT_ROLE_PERMISSIONS[role].some((key) => key.startsWith('leave.')),
    ),
  );

  console.log('\n0047 — six CHECK constraints, and each one missed is a 23514:');

  const migration = source('db/migrations/0047_sprint33b_section_head_leave.sql');

  for (const constraint of [
    'school_users_role_check',
    'school_invitations_role_check',
    'role_permissions_role_check',
    'saturday_duty_policies_role_check',
    'staff_kpis_target_role_check',
    'role_permissions_permission_check',
  ]) {
    assert(
      `${constraint} is dropped and re-added`,
      migration.includes(`DROP CONSTRAINT IF EXISTS "${constraint}"`) &&
        migration.includes(`ADD CONSTRAINT "${constraint}"`),
      'a school that has configured anything meets a 23514 on a screen that has never failed',
    );
  }

  /*
   * ⚠ The permission list is checked against the **newest** migration that
   * defines the constraint, not against `0047`.
   *
   * This is the third time the same repair has been needed and the docblock
   * for it is already in this file: `check-sprint32` and `check-branch-scope`
   * both once named `0045` by filename and both reported keys as missing from
   * a file that no longer enforced anything. `0047` was the authority when
   * this assertion was written; Sprint 33c's `0049` rewrote the same CHECK to
   * admit `timetable.substitute`, so `0047` stopped being the authority the
   * moment that file landed.
   *
   * The roles below are still read from `0047`, and correctly: nothing since
   * has touched `school_users_role_check`.
   */
  const permissionCheckFile =
    readdirSync('db/migrations')
      .filter((name) => name.endsWith('.sql'))
      .sort()
      .reverse()
      .find((name) =>
        source(`db/migrations/${name}`).includes(
          'ADD CONSTRAINT "role_permissions_permission_check"',
        ),
      ) ?? '(none)';

  const permissionCheck =
    permissionCheckFile === '(none)' ? '' : source(`db/migrations/${permissionCheckFile}`);

  const missing = PERMISSIONS.filter((key) => !permissionCheck.includes(`'${key}'`));
  assert(
    `every permission key is admitted by the newest CHECK (${permissionCheckFile})`,
    missing.length === 0,
    `${missing.join(', ')} would be a 23514 the first time a school overrides it`,
  );

  const rolesMissing = USER_ROLES.filter(
    (role) => !new RegExp(`'${role}'`).test(migration),
  );
  assert('every role is admitted too', rolesMissing.length === 0, rolesMissing.join(', '));

  assert(
    '0047 does NOT create the one-head indexes — they must wait for the data script',
    !migration.includes('school_users_one_principal') &&
      !migration.includes('school_users_one_vice_principal'),
    'in 0047 they run before Askari’s three extra Principals can become Section Heads',
  );

  console.log('\n0048 — one head per campus, after the data script:');

  // Comments stripped: the header *describes* `CREATE UNIQUE INDEX` before the
  // block runs one, and an ordering test over prose asserts nothing.
  const oneHead = source('db/migrations/0048_sprint33b_one_head_per_campus.sql').replace(
    /--.*$/gm,
    '',
  );
  const { ONE_HEAD_INDEXES, isOneHeadIndexConflict, isHeadRole } = await import(
    '../lib/one-head-per-campus'
  );

  assert(
    '0048 creates all four indexes',
    ONE_HEAD_INDEXES.every((name) => oneHead.includes(`"${name}"`)),
  );
  assert(
    'and counts first, reporting duplicates as warnings instead of failing',
    oneHead.includes('HAVING count(*) > 1') &&
      oneHead.includes('RAISE WARNING') &&
      oneHead.indexOf('RETURN;') < oneHead.indexOf('CREATE UNIQUE INDEX'),
    'a CREATE UNIQUE INDEX that throws on live data leaves nobody sure what state they are in',
  );
  assert('and deletes nothing', !/\bDELETE\b|\bUPDATE\b/i.test(oneHead.replace(/--.*$/gm, '')));

  const journalText = source('db/migrations/meta/_journal.json');
  assert(
    '0048 is in the journal, after 0047',
    journalText.indexOf('0048_sprint33b_one_head_per_campus') >
      journalText.indexOf('0047_sprint33b_section_head_leave'),
  );

  assert('only the two head roles are unique per campus', isHeadRole('principal') && isHeadRole('vice_principal') && !isHeadRole('section_head'));
  assert(
    'a violation of one of the four is recognised through the cause chain',
    isOneHeadIndexConflict({
      message: 'Failed query',
      cause: { code: '23505', constraint_name: 'school_users_one_principal_per_branch_idx' },
    }),
  );
  assert(
    'and the address index is not mistaken for it',
    !isOneHeadIndexConflict({
      cause: { code: '23505', constraint_name: 'school_users_location_email_active_idx' },
    }),
  );

  for (const path of [
    'lib/school-member-accounts.ts',
    'lib/staff-portal-access.ts',
    'lib/school-bootstrap.ts',
    'app/api/school/users/route.ts',
    'app/api/school/users/[userId]/route.ts',
    'app/api/school/invitations/[inviteRef]/accept/route.ts',
    'app/api/super-admin/schools/[schoolId]/users/[userId]/route.ts',
  ]) {
    const text = source(path);
    assert(
      `${path} names the existing head before it writes`,
      text.includes('headConflict('),
      'a second head would meet 0048’s index as a raw 23505',
    );
  }
  for (const path of [
    'lib/school-member-accounts.ts',
    'lib/school-bootstrap.ts',
    'app/api/school/users/route.ts',
    'app/api/school/users/[userId]/route.ts',
    'app/api/school/invitations/[inviteRef]/accept/route.ts',
    'app/api/super-admin/schools/[schoolId]/users/[userId]/route.ts',
  ]) {
    assert(`${path} catches the race`, source(path).includes('isOneHeadIndexConflict('));
  }
  assert(
    'the probation ceiling is in the database, not only in the API',
    migration.includes('staff_probation_days_check') && migration.includes('180'),
  );
  assert(
    '0047 is in the journal',
    source('db/migrations/meta/_journal.json').includes('0047_sprint33b_section_head_leave'),
  );

  console.log('\nB2 — the chain resolves upward and skips what is missing:');

  const { resolveChain, decisionRefusal, reachableStaffIds } = await import('../lib/approval-chain');

  const index = {
    locationId: TENANT,
    coordinatorsOfTeacher: new Map([
      ['teacher-one', ['coordinator-one']],
      ['teacher-shared', ['coordinator-one', 'coordinator-two']],
    ]),
    sectionHeadsOfCoordinator: new Map([['coordinator-one', ['head-one']]]),
    heads: [
      { userId: 'head-one', role: 'section_head' as const, branchId: 'campus-a' },
      { userId: 'deputy', role: 'vice_principal' as const, branchId: 'campus-a' },
      { userId: 'office', role: 'branch_admin' as const, branchId: 'campus-a' },
      { userId: 'boss', role: 'principal' as const, branchId: 'campus-a' },
      { userId: 'owner', role: 'school_admin' as const, branchId: null },
    ],
  };

  const teacher = {
    staffId: 'staff-one',
    schoolUserId: 'teacher-one',
    role: 'teacher' as const,
    branchId: 'campus-a',
    name: 'Laraib',
  };

  const plain = resolveChain(index, teacher);
  assert(
    'a teacher goes coordinator → section head → deputy → principal → owner',
    plain.levels.map((level) => level.role).join(' → ') ===
      'coordinator → section_head → vice_principal → principal → school_admin',
    plain.levels.map((level) => level.role).join(' → '),
  );

  const shared = resolveChain(index, { ...teacher, schoolUserId: 'teacher-shared' });
  assert(
    'a teacher under two coordinators skips that rung',
    !shared.levels.some((level) => level.role === 'coordinator') && shared.note !== null,
    shared.levels.map((level) => level.role).join(' → '),
  );

  const junior = resolveChain(index, { ...teacher, schoolUserId: null, role: null });
  assert(
    'a junior teacher — no login at all — goes to the deputy and above',
    junior.levels[0]?.role === 'vice_principal' && junior.note !== null,
    junior.levels.map((level) => level.role).join(' → '),
  );

  const coordinator = resolveChain(index, {
    staffId: 'staff-two',
    schoolUserId: 'coordinator-one',
    role: 'coordinator',
    branchId: 'campus-a',
    name: 'Aqsa',
  });
  assert(
    'a coordinator goes to their section head first',
    coordinator.levels[0]?.role === 'section_head',
    coordinator.levels.map((level) => level.role).join(' → '),
  );

  const clerk = resolveChain(index, {
    staffId: 'staff-three',
    schoolUserId: 'clerk',
    role: 'accountant',
    branchId: 'campus-a',
    name: 'Wajahat',
  });
  assert(
    'a non-teaching person goes to the Branch Admin, who heads them (decision 3)',
    clerk.levels[0]?.role === 'branch_admin',
    clerk.levels.map((level) => level.role).join(' → '),
  );

  const empty = resolveChain(
    { ...index, heads: [] },
    { ...teacher, schoolUserId: 'nobody', role: 'teacher' },
  );
  assert('a school with nobody set up has an empty chain, not a wrong one', empty.levels.length === 0);

  assert(
    'the Principal is in every chain at their campus',
    [plain, shared, junior, coordinator, clerk].every((chain) =>
      chain.approverUserIds.includes('boss'),
    ),
  );

  assert(
    'the coordinator may decide their own teacher',
    decisionRefusal(plain, { schoolUserId: 'coordinator-one', role: 'coordinator' }) === null,
  );
  assert(
    'another coordinator may not',
    decisionRefusal(plain, { schoolUserId: 'coordinator-two', role: 'coordinator' }) !== null,
  );
  assert(
    'and nobody decides their own leave',
    decisionRefusal(coordinator, { schoolUserId: 'coordinator-one', role: 'coordinator' }) !== null,
  );
  assert(
    'a signed-out caller is refused rather than admitted',
    decisionRefusal(plain, { schoolUserId: null, role: 'principal' }) !== null,
  );

  const reachable = reachableStaffIds(index, [teacher], {
    schoolUserId: 'head-one',
    role: 'section_head',
  });
  assert('a section head reaches their coordinator’s teachers', reachable.has('staff-one'));

  console.log('\nB3 — the day counter, the quota, and the holiday rules:');

  const quota = await import('../lib/leave-quota');
  const eid = new Set(['2026-03-20', '2026-03-21']);

  assert(
    'a five-day range including one holiday costs five when the campus includes them',
    quota.countLeaveDays('2026-03-18', '2026-03-22', eid, 'include').days === 5,
  );
  assert(
    'and three when it skips them',
    quota.countLeaveDays('2026-03-18', '2026-03-22', eid, 'skip').days === 3,
  );
  assert(
    'a single day on a gazetted holiday is refused (decision 11)',
    quota.holidayProblem('2026-03-20', '2026-03-20', eid) !== null,
  );
  assert(
    'a range whose first day is a holiday is accepted',
    quota.holidayProblem('2026-03-20', '2026-03-24', eid) === null,
  );
  assert(
    'a single ordinary day is accepted',
    quota.holidayProblem('2026-03-25', '2026-03-25', eid) === null,
  );

  const existing = [
    { id: 'a', startDate: '2026-03-18', endDate: '2026-03-20', status: 'approved', leaveTypeName: 'Casual Leave' },
    { id: 'b', startDate: '2026-04-01', endDate: '2026-04-02', status: 'rejected', leaveTypeName: 'Casual Leave' },
  ];
  assert(
    'a day already on approved leave is refused',
    quota.overlapProblem('2026-03-20', '2026-03-22', existing) !== null,
  );
  assert(
    'a rejected request frees its days again',
    quota.overlapProblem('2026-04-01', '2026-04-02', existing) === null,
  );

  const year = { startMonth: 8, startYear: 2026, endMonth: 7, endYear: 2027 };
  assert(
    'null permanent_from is the whole year — every staff row in production holds it',
    quota.proratedEntitlement({ annualQuotaDays: 12, permanentFrom: null, year }) === 12,
  );
  assert(
    'permanent before the year starts is also the whole year',
    quota.proratedEntitlement({ annualQuotaDays: 12, permanentFrom: '2025-01-01', year }) === 12,
  );
  assert(
    'permanent after it ends is nothing',
    quota.proratedEntitlement({ annualQuotaDays: 12, permanentFrom: '2028-01-01', year }) === 0,
  );

  const halfway = quota.proratedEntitlement({
    annualQuotaDays: 12,
    permanentFrom: '2027-02-01',
    year,
  });
  assert(
    'and halfway through is pro-rated, to the half day',
    halfway > 5 && halfway < 7 && halfway * 2 === Math.round(halfway * 2),
    String(halfway),
  );

  const spent = quota.computeQuota({
    annualQuotaDays: 10,
    permanentFrom: null,
    year,
    takenDays: 6,
    pendingDays: 2,
  });
  assert('pending is subtracted as well as taken', spent.remaining === 2, String(spent.remaining));
  assert(
    'and the refusal carries the numbers',
    (quota.quotaProblem(spent, 3, 'Casual Leave') ?? '').includes('2 days'),
    quota.quotaProblem(spent, 3, 'Casual Leave') ?? '(none)',
  );
  assert(
    'an uncapped head never refuses — it is what somebody out of entitlement applies for',
    quota.quotaProblem(
      quota.computeQuota({ annualQuotaDays: 0, permanentFrom: null, year, takenDays: 40, pendingDays: 0 }),
      5,
      'Unpaid Leave',
    ) === null,
  );

  console.log('\nB4 — probation: 180 calendar days, holidays included:');

  const probation = await import('../lib/probation');

  assert('the ceiling is 180', probation.MAX_PROBATION_DAYS === 180);
  assert(
    'day one is the start date — 90 days from 1 January ends on 31 March',
    probation.probationEndDate('2026-01-01', 90) === '2026-03-31',
    probation.probationEndDate('2026-01-01', 90) ?? '(null)',
  );
  assert(
    '180 days is accepted',
    probation.probationProblem({
      isOnProbation: true,
      startedOn: '2026-01-01',
      days: 180,
      extendedDays: 0,
    }) === null,
  );
  assert(
    '181 is not',
    probation.probationProblem({
      isOnProbation: true,
      startedOn: '2026-01-01',
      days: 181,
      extendedDays: 0,
    }) !== null,
  );
  assert(
    'and an extension counts towards the total, not on top of it',
    probation.probationProblem({
      isOnProbation: true,
      startedOn: '2026-01-01',
      days: 120,
      extendedDays: 90,
    }) !== null,
  );
  assert(
    'somebody not on probation needs no dates at all',
    probation.probationProblem({
      isOnProbation: false,
      startedOn: null,
      days: null,
      extendedDays: 0,
    }) === null,
  );

  assert(
    'the sweep claims with a conditional UPDATE … RETURNING, and reverts on a throw',
    /\.update\(staff\)[\s\S]{0,900}\.returning\(/.test(source('lib/probation-notifier.ts')) &&
      source('lib/probation-notifier.ts').includes('releaseClaim'),
    'a read-then-if sends seven emails — production runs seven schedulers',
  );
  assert(
    'and it is started once per process',
    source('instrumentation.ts').includes('startProbationNotifier'),
  );

  console.log('\nThe two findings Part A deferred here:');

  const entries = source('app/api/school/timetable/entries/route.ts');
  assert(
    'the cross-schedule 409 names the class being placed as well as the other',
    entries.includes('That teacher cannot take ${placing}') ||
      /cannot take \$\{placing\}/.test(entries),
    'it named only the other class, which is the class the clerk is not looking at',
  );

  const teacherPage = source('app/(teacher)/teacher/leave/page.tsx');
  assert(
    'the teacher portal applies for leave rather than pointing at the office',
    teacherPage.includes('LeaveSelfService') &&
      !teacherPage.includes('is done through your school office'),
    'the read-only docblock now contradicts the feature beside it',
  );

  console.log('\nOne delivery path, not two:');

  const overrides = source('app/api/school/staff-calendars/[calendarId]/overrides/route.ts');
  assert(
    'the override route sends nothing itself',
    !overrides.includes('sendAnnouncement'),
    'a second delivery path is a second place the opt-outs are decided',
  );
  assert(
    'the screen fires the announcement route that already exists',
    source('components/hr/StaffCalendarManager.tsx').includes('/notify'),
  );

  /* ─────────────────────────────────────────────── QA round 1, 2026-09-16 */

  console.log('\nQA round 1 · F1 — no second door that skips the leave rules:');

  const legacyList = source('app/api/school/hr/leave-requests/route.ts');
  const legacyOne = source('app/api/school/hr/leave-requests/[requestId]/route.ts');
  const writesLeave = (text: string): boolean =>
    /\.insert\(leaveRequests\)|\.update\(leaveRequests\)/.test(text);

  assert(
    'the legacy POST refuses (410) and writes nothing',
    /export const POST[\s\S]*?'moved'[\s\S]*?410/.test(legacyList) && !writesLeave(legacyList),
    'HR could file a single-day request on Iqbal Day and for another campus through it',
  );
  assert(
    'the legacy PATCH refuses (410) and decides nothing',
    /export const PATCH[\s\S]*?'moved'[\s\S]*?410/.test(legacyOne) && !writesLeave(legacyOne),
    'HR decided a request it holds no leave.approve for through it',
  );
  assert(
    'the legacy reads are kept',
    legacyList.includes('export const GET') && legacyOne.includes('export const GET'),
  );

  const leaveManager = source('components/hr/LeaveManager.tsx');
  assert(
    'the HR screen files and lists through the new route, not the legacy one',
    // A call, not the docblock that explains why the call went away.
    !/schoolFetch(<[^>]*>)?\(\s*['`]\/api\/school\/hr\/leave-requests/.test(leaveManager) &&
      leaveManager.includes('/api/school/leave/requests?scope=all'),
  );
  assert(
    'and decides only through the decision endpoint, only for leave.approve',
    leaveManager.includes('/decision') && leaveManager.includes('if (canApprove)'),
  );
  assert(
    'payroll still reads leave_requests directly, not through a route',
    source('lib/hr-queries.ts').includes('export async function unpaidLeaveDaysByStaff'),
  );

  console.log('\nQA round 1 · F3 — leave types are managed under the leave keys:');

  const typesRoute = source('app/api/school/hr/leave-types/route.ts');
  const typeRoute = source('app/api/school/hr/leave-types/[leaveTypeId]/route.ts');
  assert(
    'create and seed need leave.manage',
    /export const POST[\s\S]*?permission: 'leave\.manage'/.test(typesRoute),
  );
  assert('edit and retire need leave.manage', /permission: 'leave\.manage'/.test(typeRoute));
  assert('reading the heads needs leave.read', /export const GET[\s\S]*?permission: 'leave\.read'/.test(typesRoute));
  assert(
    'no leave-type route is still gated on the hr keys',
    !/permission: 'hr\./.test(typesRoute) && !/permission: 'hr\./.test(typeRoute),
  );
  assert('there is no DELETE — retiring is inactive', !/export const DELETE/.test(typeRoute));
  assert(
    'nobody who held hr.write by default loses the leave types',
    (Object.keys(DEFAULT_ROLE_PERMISSIONS) as Array<keyof typeof DEFAULT_ROLE_PERMISSIONS>)
      .filter((role) => holds(role, 'hr.write'))
      .every((role) => holds(role, 'leave.manage')),
  );
  assert(
    'the screen has create, edit and retire',
    leaveManager.includes("'/api/school/hr/leave-types'") &&
      leaveManager.includes('/api/school/hr/leave-types/${') &&
      leaveManager.includes('isActive'),
  );

  console.log('\nQA round 1 · F2, F4, F5:');

  const calendarScreen = source('components/hr/StaffCalendarManager.tsx');
  assert(
    'F2: "Create both calendars" names a campus, never an empty body',
    calendarScreen.includes('JSON.stringify({ branchId })') &&
      !calendarScreen.includes("body: JSON.stringify({}) }"),
  );
  assert(
    'F2: controls are drawn only where the write can succeed',
    calendarScreen.includes('canWriteBranch('),
  );
  for (const path of [
    'app/api/school/staff-calendars/[calendarId]/overrides/route.ts',
    'app/api/school/staff-calendars/[calendarId]/overrides/[overrideId]/route.ts',
  ]) {
    assert(`F2: ${path} checks the campus through the caller’s scope`, source(path).includes('calendarWriteRefusal('));
  }
  assert(
    'F4: an existing record’s probation, with the extension, can be edited',
    source('components/hr/ProbationCard.tsx').includes('probationExtendedDays') &&
      source('app/(school-admin)/dashboard/hr/staff/[staffId]/page.tsx').includes('<ProbationCard'),
  );
  const selfService = source('components/leave/LeaveSelfService.tsx');
  assert(
    'F5: "Days used" is counted by the server as the dates change',
    selfService.includes('useLeaveCount(') && source('app/api/school/leave/count/route.ts').includes('countLeaveFor('),
  );
  assert(
    'F5: and the write counts with the same function',
    source('app/api/school/leave/requests/route.ts').includes('countLeaveFor('),
  );
  assert(
    // Both banners clear: the page-level one and, since QA round 2's N2, the
    // form's own. An assertion that pinned those two statements together would
    // have failed on a change that improves the screen, so the middle line is
    // optional here.
    'F5: a refusal about the old dates is cleared when the dates change',
    (
      selfService.match(
        /setError\(null\);\n\s*(?:setApplyError\(null\);\n\s*)?setDraft\(\{ \.\.\.draft, (?:start|end)Date/g,
      ) ?? []
    ).length === 2,
  );
  assert(
    'N2: a refused application is reported beside the button that was pressed',
    selfService.includes('setApplyError(') &&
      source('components/hr/LeaveManager.tsx').includes('setFileError('),
  );
  assert(
    // N1 is the read half of F2. The write has been guarded since round 1; the
    // GET checked the tenant and stopped there, so another campus's overrides
    // came back to anybody holding `leave.read` and a calendar id.
    'N1: the override GET scopes the read to the campus, not just the tenant',
    source('app/api/school/staff-calendars/[calendarId]/overrides/route.ts').includes(
      'calendarIsVisible(',
    ),
  );
  assert(
    'N1: ensureStaffCalendars returns only the calendars the caller may see',
    source('app/api/school/staff-calendars/route.ts').includes('effectiveBranchIds(scope)') &&
      source('lib/staff-calendar-queries.ts').includes('visibleBranchIds'),
  );

  /* ══════════════════════════════════ part two: against the real schema */

  loadDatabaseUrl();
  const { db } = await import('../lib/drizzle');

  const tables = (await db.execute(sql`
    select to_regclass('public.section_head_coordinators') as chain,
           to_regclass('public.staff_calendars') as calendars,
           to_regclass('public.branch_leave_settings') as settings`)) as unknown as Array<{
    chain: string | null;
    calendars: string | null;
    settings: string | null;
  }>;

  const columns = (await db.execute(sql`
    select column_name
      from information_schema.columns
     where table_schema = 'public'
       and table_name = 'staff'
       and column_name in ('permanent_from', 'is_on_probation', 'probation_ends_on')`)) as unknown as Array<{
    column_name: string;
  }>;

  const applied =
    tables[0]?.chain != null && tables[0]?.calendars != null && tables[0]?.settings != null;
  const columnsApplied = columns.length === 3;

  console.log(
    `\n0047 is ${applied && columnsApplied ? 'APPLIED' : 'NOT applied'} — tables ${
      applied ? 'present' : 'absent'
    }, staff columns ${String(columns.length)}/3`,
  );

  const newTable = afterMigration(applied, UNDEFINED_TABLE);
  const newColumn = afterMigration(columnsApplied, UNDEFINED_COLUMN);

  const leave = await import('../lib/leave-queries');
  const chain = await import('../lib/approval-chain');
  const calendars = await import('../lib/staff-calendar-queries');
  const notifier = await import('../lib/probation-notifier');

  console.log('\nStatements over tables that already exist:');

  await mustRun(
    'listLeaveForSchool — leave_requests ⋈ staff ⋈ leave_types ⋈ branches ⋈ school_users (the decider)',
    () => leave.listLeaveForSchool(TENANT),
  );
  await mustRun('listLeaveForSchool — one state, one campus, one window', () =>
    leave.listLeaveForSchool(TENANT, {
      status: 'pending',
      branchIds: [NOBODY],
      from: '2026-01-01',
      to: '2026-12-31',
    }),
  );
  await mustRun('leaveSpansFor — the overlap test’s input', () =>
    leave.leaveSpansFor(TENANT, NOBODY),
  );
  await mustRun('countPendingLeave', () => leave.countPendingLeave(TENANT));
  await mustRun('probationRecipients — HR, or the owner when there is no HR', () =>
    notifier.probationRecipients(TENANT),
  );
  await mustRun('quotasFor — leave_types ⋈ leave_requests over the active year', () =>
    leave.quotasFor(TENANT, { staffId: NOBODY, permanentFrom: null, branchId: null }),
  );

  console.log('\nStatements 0047’s four tables are for:');

  await newTable('loadChainIndex — coordinator_teachers ⋈ section_head_coordinators ⋈ school_users', () =>
    chain.loadChainIndex(TENANT),
  );
  await newTable('listChainSetup — the reporting-line screen, with the duplicate report', () =>
    chain.listChainSetup(TENANT),
  );
  await newTable('listChainSetup — campus-scoped', () => chain.listChainSetup(TENANT, [NOBODY]));
  await newTable('listStaffCalendars — staff_calendars ⋈ branches, with override counts', () =>
    calendars.listStaffCalendars(TENANT),
  );
  await newTable('resolveCalendarFor', () => calendars.resolveCalendarFor(TENANT, NOBODY, 'teaching'));
  await newTable('listCalendarOverrides — overrides ⋈ holidays', () =>
    calendars.listCalendarOverrides(TENANT, NOBODY),
  );
  await newTable('staffHolidayDates — the person’s own calendar over the school’s holidays', () =>
    calendars.staffHolidayDates(TENANT, {
      branchId: null,
      role: 'teacher',
      from: '2026-01-01',
      to: '2026-12-31',
    }),
  );
  await newTable('holidaySpanFor — the campus rule, falling back to the school’s', () =>
    leave.holidaySpanFor(TENANT, NOBODY),
  );
  await newTable('listHolidaySpans — every campus and what it inherits', () =>
    leave.listHolidaySpans(TENANT),
  );

  console.log('\nStatements 0047’s columns on `staff` are for:');

  await newColumn('getLeaveApplicant — staff ⋈ school_users ⋈ branches, with permanent_from', () =>
    leave.getLeaveApplicant(TENANT, NOBODY),
  );
  await newColumn('listLeaveApplicants — the same, in one read for the inbox', () =>
    leave.listLeaveApplicants(TENANT, [NOBODY]),
  );
  await newColumn('listFileableStaff — everybody HR may file for, campus-scoped', () =>
    leave.listFileableStaff(TENANT, [NOBODY]),
  );

  /*
   * 0048 — read from the catalogue, never assumed.
   *
   * Three states are legal and one is not. Not applied, with or without
   * duplicates: fine, the data script has not run. Applied (all four indexes
   * present): there can be no duplicate left, because the DO block refuses to
   * create them otherwise. Some but not all four indexes: something ran half of
   * it, which is a real defect. Any duplicate alongside an index: impossible,
   * and reported as one.
   */
  console.log('\n0048 — the one-head-per-campus indexes:');

  const headIndexes = (await db.execute(sql`
    select indexname from pg_indexes
     where schemaname = 'public' and tablename = 'school_users'
       and indexname like 'school_users_one_%'`)) as unknown as Array<{ indexname: string }>;

  const duplicates = (await db.execute(sql`
    select su.role, count(*)::int as holders
      from school_users su
     where su.role in ('principal', 'vice_principal') and su.is_active
     group by su.location_id, su.branch_id, su.role
    having count(*) > 1`)) as unknown as Array<{ role: string; holders: number }>;

  const present = headIndexes.map((row) => row.indexname);
  const { ONE_HEAD_INDEXES: expectedIndexes, headConflict, headsAtBranch } = await import(
    '../lib/one-head-per-campus'
  );

  console.log(
    `  --    ${String(present.length)}/4 indexes present; ${String(duplicates.length)} campus(es) with more than one active head`,
  );

  assert(
    'the indexes are all there or none are',
    present.length === 0 || expectedIndexes.every((name) => present.includes(name)),
    present.join(', '),
  );
  assert(
    'and never alongside a duplicate the DO block should have refused',
    present.length === 0 || duplicates.length === 0,
    JSON.stringify(duplicates),
  );
  if (present.length === 0) {
    pass(
      '0048 NOT applied',
      duplicates.length === 0
        ? 'no duplicates — it will create the four indexes when it runs'
        : `${String(duplicates.length)} duplicate(s) — it will warn and skip until the data script runs`,
    );
  }

  await mustRun('headsAtBranch — one campus', () =>
    headsAtBranch(TENANT, 'principal', NOBODY, NOBODY),
  );
  await mustRun('headsAtBranch — school-wide', () =>
    headsAtBranch(TENANT, 'vice_principal', null),
  );
  await mustRun('headConflict — the sentence before the 23505', async () => {
    const answer = await headConflict(TENANT, { role: 'principal', branchId: NOBODY });
    if (answer !== null) throw new Error(`expected no holder at a tenant with no rows, got: ${answer}`);
    return answer;
  });

  console.log(
    '\n  --    listApprovalInbox and getLeaveForDecision short-circuit on a tenant that\n' +
      '        matches no row: both return before they reach the chain reads, so they are\n' +
      '        NOT exercised here rather than counted as passing. Their statements are\n' +
      '        loadChainIndex and listLeaveApplicants above, both executed directly.\n' +
      '  --    claimEndedProbations, sweepProbations, setHolidaySpan and\n' +
      '        ensureStaffCalendars are not executed: all four write, and check-sprint24\n' +
      '        records why a check script does not issue an UPDATE against a live database.',
  );

  console.log(`\n${failures === 0 ? 'PASS' : 'FAIL'} — ${String(passes)} passed, ${String(failures)} failed.`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
