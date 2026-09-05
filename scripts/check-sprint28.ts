/**
 * Executes Sprint 28's new and widened statements against the real schema.
 *
 *     npm run check-sprint28
 *
 * ── Why this exists ──────────────────────────────────────────────────────
 * A green build says the SQL compiled, never that Postgres would accept it. An
 * ambiguous column reference is a *planning* error — 42702 is raised when the
 * statement is resolved, not when it returns rows — so a statement that has
 * been read and not run is evidence about spelling and nothing else. That is
 * how 42702 shipped three times, and it is why `check-sprint20` through `27`
 * exist. This is the same script pointed at this sprint's statements.
 *
 * Sprint 28 widens the one query that has already been taken down twice by
 * exactly that mistake: `listStudents`, which joins `student_enrollments`,
 * `student_profiles`, `school_users`, `sections`, `grades`, `academic_years`,
 * `branches`, a `primary_guardian` subquery and now a `voucher_counts`
 * subquery carrying four aggregates. Drizzle emits those four **unqualified**
 * in the outer statement, so their names are the only thing standing between
 * this screen and a 500 at every school. All five fee filters are run, because
 * two of the four aggregates are only referenced by some of them.
 *
 * ── It works on both sides of `0044` ─────────────────────────────────────
 * Whether the migration is applied is **read out of `pg_constraint`**, never
 * passed in: the script asks whether `role_permissions_permission_check`
 * already names `fees.admission` and flips its own expectations. Before it,
 * `fees.admission` must be refused with exactly `23514` — which is itself the
 * proof that the CHECK is live and that the migration is genuinely needed —
 * and after it, accepted.
 *
 * ── The three traps, all paid for by earlier sprints ─────────────────────
 * 1. The SQLSTATE lives on the error's `cause` chain, not on the error. Reading
 *    `.code` reports every failure as unpredicted.
 * 2. A read that short-circuits before it reaches the new column must be
 *    reported as **not exercised**, never as a pass — otherwise a broken
 *    statement hides behind an early return.
 * 3. postgres-js appends the whole failed query to the message; the `cause`
 *    carries the bare reason, so that is what is printed.
 *
 * ── The pure assertions ──────────────────────────────────────────────────
 * `studentFeeStatusFrom` across the whole cross-product that matters, because
 * the fifth state was added *below* three older ones and a wrong order would
 * silently relabel every unpaid child; and the permission catalogue against the
 * newest migration's CHECK, plus the four roles that must hold
 * `fees.admission` while holding no `fees.write`.
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
      const text = readFileSync(candidate, 'utf8');
      const match = /^DATABASE_URL=(.*)$/m.exec(text);
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

loadDatabaseUrl();

/** A syntactically valid id that belongs to no tenant, and no row. */
const NOBODY = '00000000-0000-0000-0000-000000000000';

let failures = 0;
let passes = 0;

/** The SQLSTATE, dug out from under Drizzle's wrapper. Trap 1. */
function sqlState(error: unknown): string | null {
  let current: unknown = error;

  for (let depth = 0; depth < 5 && current !== null && current !== undefined; depth += 1) {
    const code = (current as { code?: unknown }).code;
    if (typeof code === 'string' && code !== '') return code;
    current = (current as { cause?: unknown }).cause;
  }

  return null;
}

/** The SQLSTATE and the reason, without postgres-js's copy of the statement. */
function describe(error: unknown): string {
  let reason: string | null = null;

  let current: unknown = error;
  for (let depth = 0; depth < 5 && current !== null && current !== undefined; depth += 1) {
    const message = (current as { message?: unknown }).message;
    if (typeof message === 'string' && !message.startsWith('Failed query')) {
      reason = message;
      break;
    }
    current = (current as { cause?: unknown }).cause;
  }

  reason ??= String((error as { message?: string } | null)?.message ?? error);

  const oneLine = (reason.split('\n')[0] ?? reason).trim();
  const trimmed = oneLine.length > 110 ? `${oneLine.slice(0, 109)}…` : oneLine;

  return `${sqlState(error) ?? '?'} ${trimmed}`;
}

function pass(label: string, detail = ''): void {
  console.log(`  ok    ${label}${detail === '' ? '' : ` — ${detail}`}`);
  passes += 1;
}

function fail(label: string, detail: string): void {
  console.error(`  FAIL  ${label}`);
  console.error(`        ${detail}`);
  failures += 1;
}

/**
 * Records that a path was deliberately not reached, with its substitute named.
 *
 * Trap 2 says a read that short-circuits before it reaches the new column must
 * be reported as *not exercised* rather than passed. One read here genuinely
 * does short-circuit against a tenant that matches no row — `listStudents`
 * maps zero rows, so `studentFeeStatusFrom` is never called on a real row and
 * the two new selected columns are never *read back* even though Postgres has
 * planned them — and there is no tenant id that would change that without
 * writing rows to a live database.
 *
 * So the honest answer is neither a pass nor a failure: it is this note, plus
 * the same projection executed directly as raw SQL immediately below it. The
 * note is what stops "ok" being printed for something nothing ever read.
 */
function notExercisedIsExpected(label: string, why: string): void {
  console.log(`  note  ${label}`);
  console.log(`        ${why}`);
}

function assert(label: string, condition: boolean, detail: string): void {
  if (condition) {
    pass(label);
    return;
  }
  fail(label, detail);
}

async function mustRun(label: string, run: () => Promise<unknown>): Promise<void> {
  try {
    const value = await run();
    pass(label, Array.isArray(value) ? `${String(value.length)} row(s)` : 'executed');
  } catch (error) {
    fail(label, describe(error));
  }
}

/**
 * The migration that *currently* defines `role_permissions_permission_check`.
 *
 * Found by reading the directory rather than by naming a file, exactly as
 * `check-branch-scope` does it: the answer to "which list is the database
 * meant to hold" is whichever migration rewrote the constraint last, and
 * hardcoding `0044` here would make this script wrong the day `0045` widens it
 * again.
 */
function latestMigrationDefining(constraint: string): { path: string; body: string } {
  const candidates = readdirSync('db/migrations')
    .filter((name) => name.endsWith('.sql'))
    .sort()
    .reverse();

  for (const name of candidates) {
    const path = `db/migrations/${name}`;
    const body = readFileSync(path, 'utf8');
    if (body.includes(`ADD CONSTRAINT "${constraint}"`)) return { path, body };
  }

  throw new Error(`no migration defines ${constraint}`);
}

async function main(): Promise<void> {
  /* ═════════════════════════════════════ the pure assertions, no database */

  const feeStatus = await import('../lib/student-fee-status');
  const permissions = await import('../lib/permissions');

  console.log('\nThe fifth fee state, and the four above it:');

  /*
   * The ranking, exhaustively, in the shape the counts actually arrive in.
   *
   * `not_billed` was inserted *below* three states that were already there, so
   * the mistake this guards against is not "does the new state work" but "did
   * adding it move any of the old ones". A student with an open admission
   * voucher must still read `admission_unpaid` whatever `live` says, and the
   * hand-cleared enrollment must read `cleared` rather than the new state,
   * which is the one case a reviewer reading the function will not think of.
   */
  const rankings: Array<[string, Parameters<typeof feeStatus.studentFeeStatusFrom>[0], string]> = [
    [
      'never billed, enrollment outstanding',
      { open: 0, overdue: 0, admission: 0, live: 0, enrolmentCleared: false },
      'not_billed',
    ],
    [
      'never billed, but cleared by hand at a desk',
      { open: 0, overdue: 0, admission: 0, live: 0, enrolmentCleared: true },
      'cleared',
    ],
    [
      'one paid voucher, nothing open',
      { open: 0, overdue: 0, admission: 0, live: 1, enrolmentCleared: false },
      'cleared',
    ],
    [
      'an open admission voucher outranks everything',
      { open: 2, overdue: 1, admission: 1, live: 3, enrolmentCleared: false },
      'admission_unpaid',
    ],
    [
      'overdue outranks due',
      { open: 2, overdue: 1, admission: 0, live: 2, enrolmentCleared: false },
      'overdue',
    ],
    [
      'open and none of them late',
      { open: 1, overdue: 0, admission: 0, live: 4, enrolmentCleared: false },
      'due',
    ],
    [
      'an open voucher beats a cleared enrollment — the money is still owed',
      { open: 1, overdue: 0, admission: 0, live: 1, enrolmentCleared: true },
      'due',
    ],
  ];

  for (const [label, counts, expected] of rankings) {
    const actual = feeStatus.studentFeeStatusFrom(counts);
    assert(
      `${label} → ${expected}`,
      actual === expected,
      `got ${actual}; the ranking in lib/student-fee-status.ts and the SQL in listStudents have drifted apart`,
    );
  }

  assert(
    'not_billed is first in the array the filter renders from',
    feeStatus.STUDENT_FEE_STATUSES[0] === 'not_billed',
    'the most specific state has been demoted in the dropdown',
  );

  assert(
    'not_billed wears the danger badge',
    feeStatus.studentFeeStatusVariant('not_billed') === 'danger',
    'a child nobody has billed is being reported in a colour that reads as settled',
  );

  assert(
    'every state has a label and a description',
    feeStatus.STUDENT_FEE_STATUSES.every(
      (state) =>
        feeStatus.STUDENT_FEE_STATUS_LABELS[state] !== undefined &&
        feeStatus.STUDENT_FEE_STATUS_DESCRIPTIONS[state] !== undefined,
    ),
    'a chip would render as undefined on the directory',
  );

  assert(
    'isStudentFeeStatus accepts the new state and refuses a stale one',
    feeStatus.isStudentFeeStatus('not_billed') && !feeStatus.isStudentFeeStatus('unbilled'),
    'the URL guard and the server filter disagree about what is a valid value',
  );

  console.log('\nThe new permission key, in code:');

  assert(
    'fees.admission is in PERMISSIONS',
    (permissions.PERMISSIONS as readonly string[]).includes('fees.admission'),
    'it is missing from the catalogue, so no matrix can grant it',
  );

  assert(
    'fees.admission has a label and a description',
    permissions.PERMISSION_LABELS['fees.admission'] !== undefined &&
      permissions.PERMISSION_DESCRIPTIONS['fees.admission'] !== undefined,
    'the permissions screen would render a blank row',
  );

  assert(
    'the Fees group offers all three keys',
    permissions.PERMISSION_GROUPS.find((group) => group.key === 'fees')?.permissions.join(
      ',',
    ) === 'fees.read,fees.write,fees.admission',
    'a key that is in the catalogue and not in a group cannot be granted from the screen',
  );

  /*
   * The four roles, and the absence beside each of them.
   *
   * Holding `fees.admission` is half the assertion. The other half is that none
   * of the three heads holds `fees.write` — because the moment one of them
   * does, the narrow key stops being a control and becomes decoration, and the
   * next person to read the matrix will not know which was intended.
   * `accountant` is the exception and is asserted the other way: they hold
   * both, deliberately.
   */
  for (const role of ['branch_admin', 'principal', 'vice_principal', 'accountant'] as const) {
    assert(
      `${role} holds fees.admission by default`,
      permissions.DEFAULT_ROLE_PERMISSIONS[role].includes('fees.admission'),
      'this role can admit a child and cannot bill one — the defect Sprint 28 exists to fix',
    );
  }

  for (const role of ['branch_admin', 'principal', 'vice_principal'] as const) {
    assert(
      `${role} still does NOT hold fees.write`,
      !permissions.DEFAULT_ROLE_PERMISSIONS[role].includes('fees.write'),
      'a head has been given the price list and the cash drawer as well — that is not what this key was for',
    );
  }

  assert(
    'accountant holds fees.write as well, as they always did',
    permissions.DEFAULT_ROLE_PERMISSIONS.accountant.includes('fees.write'),
    'the fee office has lost a permission it had yesterday',
  );

  assert(
    'a teacher holds neither',
    !permissions.DEFAULT_ROLE_PERMISSIONS.teacher.includes('fees.admission') &&
      !permissions.DEFAULT_ROLE_PERMISSIONS.teacher.includes('fees.write'),
    'the new key has leaked into a role that never sees a fee',
  );

  console.log('\nPERMISSIONS and the newest migration’s CHECK are the same set:');

  const migration = latestMigrationDefining('role_permissions_permission_check');
  const listed = new Set(
    [...migration.body.matchAll(/'([a-z]+\.[a-z]+)'/g)].map((match) => match[1] ?? ''),
  );

  const missing = permissions.PERMISSIONS.filter((key) => !listed.has(key));
  const extra = [...listed].filter(
    (key) => !(permissions.PERMISSIONS as readonly string[]).includes(key),
  );

  assert(
    `${migration.path} names every key in PERMISSIONS`,
    missing.length === 0,
    `missing: ${missing.join(', ')} — the first school to override one of those gets a 23514`,
  );

  assert(
    `${migration.path} names no key the code does not`,
    extra.length === 0,
    `extra: ${extra.join(', ')} — a permission nothing enforces reads on screen as a guarantee`,
  );

  /* ═════════════════════════════════════════════ is 0044 applied, or not? */

  console.log('\nReading the catalogue rather than being told:');

  const checkDefinition = rows<{ def: string }>(
    await db.execute(sql`
      select pg_get_constraintdef(oid) as def
        from pg_constraint
       where conname = 'role_permissions_permission_check'
    `),
  );

  assert(
    'role_permissions_permission_check exists at all',
    checkDefinition.length === 1,
    'the CHECK is gone entirely — any string could be written as a permission',
  );

  const applied = (checkDefinition[0]?.def ?? '').includes('fees.admission');
  console.log(`  0044 is ${applied ? 'APPLIED' : 'NOT applied'}`);

  /* ══════════════════════════════ Part A — the widened student directory */

  console.log('\nPart A — listStudents, every filter value:');

  const admissions = await import('../lib/admissions-queries');

  /*
   * Unfiltered first. This is the statement every school loads on
   * `/dashboard/admissions/students`, and the one that carried the 42702.
   */
  await mustRun('listStudents unfiltered — the nine-relation join', async () =>
    admissions.listStudents(NOBODY, {}),
  );

  /*
   * Every fee filter, because each one references a different subset of the
   * four aggregates and Postgres only resolves the ones a statement mentions.
   * `not_billed` and `cleared` are the two that read `student_enrollments.fee_status`
   * beside a subquery column, which is the pairing an ambiguous name would
   * break.
   */
  for (const state of feeStatus.STUDENT_FEE_STATUSES) {
    await mustRun(`listStudents feeStatus=${state}`, async () =>
      admissions.listStudents(NOBODY, { feeStatus: state }),
    );
  }

  await mustRun('listStudents with a search that reaches the guardian phone', async () =>
    admissions.listStudents(NOBODY, { search: '0321 123 4567' }),
  );

  await mustRun('listStudents with a PrincipalScope on both axes', async () =>
    admissions.listStudents(NOBODY, {
      feeStatus: 'not_billed',
      branchId: NOBODY,
      scope: { branchIds: [NOBODY], gradeIds: [NOBODY] },
    }),
  );

  await mustRun('listStudents with an empty scope — BR4’s "matches nothing"', async () =>
    admissions.listStudents(NOBODY, { scope: { branchIds: [], gradeIds: [] } }),
  );

  await mustRun('listStudents sorted, which changes the ORDER BY', async () =>
    admissions.listStudents(NOBODY, { sort: 'grade', direction: 'desc' }),
  );

  notExercisedIsExpected(
    'listStudents — mapping live_voucher_count and fee_status back onto a row',
    'the tenant matches no row, so studentFeeStatusFrom is never called on real data; the projection is executed directly below and the ranking is asserted above',
  );

  await mustRun(
    'the two new selected columns, projected directly (the read above returns no rows)',
    async () =>
      rows(
        await db.execute(sql`
          select se.fee_status, vc.live_voucher_count, vc.open_voucher_count,
                 vc.overdue_voucher_count, vc.admission_voucher_count
            from student_enrollments se
            left join (
              select student_profile_id,
                     count(*) as live_voucher_count,
                     count(*) filter (where status in ('unpaid', 'partial')) as open_voucher_count,
                     count(*) filter (where status in ('unpaid', 'partial') and due_date < current_date) as overdue_voucher_count,
                     count(*) filter (where status in ('unpaid', 'partial') and challan_kind = 'admission') as admission_voucher_count
                from fee_challans
               where location_id = ${NOBODY} and status <> 'cancelled'
               group by student_profile_id
            ) vc on vc.student_profile_id = se.student_profile_id
           where se.location_id = ${NOBODY}
        `),
      ),
  );

  console.log('\nPart A — countUnbilledStudents:');

  await mustRun('countUnbilledStudents unfiltered', async () =>
    admissions.countUnbilledStudents(NOBODY),
  );

  await mustRun('countUnbilledStudents narrowed to a campus', async () =>
    admissions.countUnbilledStudents(NOBODY, { branchId: NOBODY }),
  );

  await mustRun('countUnbilledStudents with a PrincipalScope on both axes', async () =>
    admissions.countUnbilledStudents(NOBODY, {
      scope: { branchIds: [NOBODY], gradeIds: [NOBODY] },
    }),
  );

  await mustRun('countUnbilledStudents with an empty scope', async () =>
    admissions.countUnbilledStudents(NOBODY, {
      scope: { branchIds: [], gradeIds: [] },
    }),
  );

  /* ════════════════════════════════════ Part B — the guardian lookup path */

  console.log('\nPart B — the reads behind the CNIC lookup:');

  const siblings = await import('../lib/siblings');

  /*
   * Unchanged by this sprint, and run anyway. Sprint 28 changes *when*
   * `onComplete` fires, which means this statement is now reached on every
   * corrected CNIC rather than only on the first complete one — a read that
   * used to run once per card can now run several times per card, and a
   * statement nobody had executed would fail several times more visibly.
   */
  await mustRun('lookupGuardianByCnic — the guardian/profile/grade join', async () =>
    siblings.lookupGuardianByCnic(NOBODY, '42101-1234567-1'),
  );

  await mustRun('lookupGuardianByCnic with a number that is not a CNIC', async () =>
    siblings.lookupGuardianByCnic(NOBODY, 'not a cnic'),
  );

  await mustRun('listSiblings — the CNIC/phone family match', async () =>
    siblings.listSiblings(NOBODY, NOBODY),
  );

  await mustRun('listStudentsForGuardianIdentity — the same match from an application', async () =>
    siblings.listStudentsForGuardianIdentity(NOBODY, {
      cnic: '42101-1234567-1',
      phone: '+923211234567',
    }),
  );

  /* ══════════════════════ the permission CHECK, proved by attempt */

  console.log('\nThe widened permission CHECK, proved by attempt:');

  const permissionRows = rows<{ n: number }>(
    await db.execute(sql`select count(*)::int as n from role_permissions`),
  );

  /*
   * Built out of a real `location_id` rather than skipped.
   *
   * `role_permissions` has rows at Askari, so a row can be constructed that
   * satisfies the foreign key and reaches the CHECK. Selecting the tenant from
   * `schools` is what makes the attempt an attempt: an insert refused by a
   * foreign key would report 23503 and prove nothing about the constraint under
   * test. Every attempt is inside a transaction that is always rolled back.
   */
  for (const [key, mustBeAccepted] of [
    ['fees.admission', true],
    ['fees.invent', false],
  ] as const) {
    let accepted = false;
    let code: string | null = null;

    try {
      await db.transaction(async (tx) => {
        await tx.execute(sql`
          insert into role_permissions (location_id, role, permission, is_granted)
          select location_id, 'coordinator', ${key}, true from schools limit 1
        `);
        accepted = true;
        tx.rollback();
      });
    } catch (error) {
      if (!String(error).includes('Rollback')) code = sqlState(error);
    }

    if (mustBeAccepted) {
      if (applied) {
        assert(
          `${key} is accepted by the CHECK`,
          accepted,
          code === null
            ? 'the insert did not run — is there a school row to hang it on?'
            : `refused with ${code}; 0044 has not widened role_permissions_permission_check`,
        );
      } else {
        assert(
          `${key} is refused with 23514, as expected before 0044`,
          !accepted && code === '23514',
          accepted
            ? 'the database already accepts it, but the catalogue says 0044 is unapplied'
            : `expected 23514, got ${code ?? 'nothing'}`,
        );
      }
    } else {
      assert(
        `${key} is refused with 23514`,
        !accepted && code === '23514',
        accepted
          ? 'a key outside the catalogue was accepted — the CHECK is missing entirely'
          : `expected 23514, got ${code ?? 'nothing'}`,
      );
    }
  }

  const permissionRowsAfter = rows<{ n: number }>(
    await db.execute(sql`select count(*)::int as n from role_permissions`),
  );

  assert(
    'nothing was written by any of those attempts',
    (permissionRows[0]?.n ?? -1) === (permissionRowsAfter[0]?.n ?? -2),
    `role_permissions moved from ${String(permissionRows[0]?.n)} to ${String(permissionRowsAfter[0]?.n)}`,
  );

  if (!applied) {
    console.log(
      '\n  note  0044 is not applied. Every statement above was expected to execute —\n' +
        '        this sprint adds no table and no column, so none of them depends on\n' +
        '        the migration. The only migration-dependent assertion is the CHECK,\n' +
        '        which was required to refuse fees.admission with exactly 23514, and\n' +
        '        did. Re-run this after `sprint-devops` applies it: the same key must\n' +
        '        then be accepted, and fees.invent must still be refused.',
    );
  }

  console.log(
    `\n${failures === 0 ? 'PASS' : 'FAIL'} — ${String(passes)} ok, ${String(failures)} failed or not exercised\n`,
  );

  process.exit(failures === 0 ? 0 : 1);
}

// Imported after `loadDatabaseUrl`, because the module opens the pool on load.
const { db } = await import('../lib/drizzle');

function rows<T>(result: unknown): T[] {
  return result as unknown as T[];
}

void main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
