/**
 * Executes Sprint 22's new and widened statements against the real schema.
 *
 *     npm run check-sprint22
 *
 * ── Why this exists ──────────────────────────────────────────────────────
 * A green build says the SQL compiled, never that Postgres would accept it. An
 * ambiguous column reference is a *planning* error — 42702 is raised when the
 * statement is resolved, not when it returns rows — so a statement that has
 * been read and not run is evidence about spelling and nothing else. That is
 * how 42702 shipped three times (STATE.md §5bg, §5av), and it is the whole
 * reason `check-sprint20` and `check-sprint21` exist.
 *
 * ── There is no migration this time, and that changes the split ──────────
 * Sprint 22 is built entirely on `staff.school_user_id`, which has existed
 * since Sprint 7 and is already indexed. So there is **no** predicted-failure
 * half: every statement below must execute today, on the database as it stands.
 * A `42703` here is not "the migration is not applied yet"; it is a defect.
 *
 * ── What is exercised, and how reach is decided ──────────────────────────
 * Two classes of statement, and they need two different subjects:
 *
 *   · reads with no guard in front of them run against a **nobody** tenant —
 *     a syntactically valid id owning no row. Postgres parses, resolves every
 *     column, plans and executes; nothing is read and nothing is written;
 *   · anything sitting behind an existence check cannot be reached that way,
 *     because the check is what a nobody tenant fails. Those are run against a
 *     **real** account discovered by shape (read-only), with a nobody *staff*
 *     id, so the guarded statement and the `UPDATE` behind it both execute and
 *     match no row. A run that cannot find a subject reports NOT EXERCISED,
 *     which is a failure — see the trap below.
 *
 * ── The three traps, all paid for by earlier sprints ─────────────────────
 * 1. The SQLSTATE lives on the error's `cause` chain, not on the error.
 *    Reading `.code` answers `undefined` for every Drizzle failure.
 * 2. A read that short-circuits before reaching the new column must be
 *    reported as **not exercised**, never as a pass. `check-portals` printed
 *    `ok` for two and a half years on a statement it had never once handed to
 *    Postgres.
 * 3. postgres-js appends the whole failed query to the message; the `cause`
 *    carries the bare reason, so that is what is printed.
 *
 * ── What is deliberately not executed ────────────────────────────────────
 * The `INSERT` inside `createMemberAccount`. It writes a `school_users` row and
 * queues an email, and neither belongs in a gate. The one thing about it that
 * can fail at *plan* time is the inferred conflict target
 * `(location_id, phone)`, so the index that target resolves to is asserted by
 * name instead. Said here rather than left to be noticed.
 *
 * Reads `DATABASE_URL` from the main checkout's `.env.local`, because a
 * worktree has no env of its own.
 */

import { readFileSync } from 'node:fs';

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

/** The phone index `createMemberAccount`'s conflict target resolves to. */
const PHONE_INDEX = 'school_users_location_id_phone_idx';

/** The index `staff.school_user_id` is read through. Sprint 7, not this one. */
const STAFF_LINK_INDEX = 'staff_school_user_id_idx';

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

/** Not exercised, and therefore not passed. Trap 2. */
function notExercised(label: string, why: string): void {
  console.error(`  NOT EXERCISED  ${label}`);
  console.error(`        ${why}`);
  failures += 1;
}

/** A statement whose execution is the whole assertion. */
async function mustRun(label: string, run: () => Promise<unknown>): Promise<void> {
  try {
    const value = await run();
    pass(label, Array.isArray(value) ? `${value.length} row(s)` : 'executed');
  } catch (error) {
    fail(label, describe(error));
  }
}

/**
 * A statement that must execute **and** must be shown to have executed.
 *
 * `reached` is handed the result and answers whether the guarded statement was
 * actually issued. An empty list is exactly what a broken statement would like
 * to be mistaken for, so nothing here treats one as evidence.
 */
async function mustReach<T>(
  label: string,
  run: () => Promise<T>,
  reached: (value: T) => boolean,
  why: string,
): Promise<void> {
  let value: T;

  try {
    value = await run();
  } catch (error) {
    fail(label, describe(error));
    return;
  }

  if (!reached(value)) {
    notExercised(label, why);
    return;
  }

  pass(label, 'executed');
}

function assert(label: string, condition: boolean, detail: string): void {
  if (condition) {
    pass(label);
    return;
  }
  fail(label, detail);
}

async function main(): Promise<void> {
  const { db } = await import('../lib/drizzle');
  const { listSchoolUsers, getSchoolUserById, emailHolderAt } = await import(
    '../lib/school-queries'
  );
  const {
    listStaff,
    getStaff,
    listUnlinkedSchoolUsers,
    getStaffBySchoolUserId,
    nextEmployeeCode,
  } = await import('../lib/hr-queries');
  const { accountLinkable, linkAccountToStaff, unlinkAccountFromStaff } = await import(
    '../lib/staff-portal-access'
  );

  const rows = <T>(result: unknown): T[] => result as unknown as T[];

  /* ---------------------------------------------------------------------
   * The column this whole sprint is built on, and the index behind it.
   * Read from the catalogue rather than assumed: if either were absent the
   * sprint would need a migration, and it deliberately has none.
   * ------------------------------------------------------------------ */

  console.log('\nThe existing schema this sprint is built on:');

  const column = rows<{ present: boolean }>(
    await db.execute(sql`
      select exists (
        select 1 from information_schema.columns
         where table_schema = 'public'
           and table_name = 'staff'
           and column_name = 'school_user_id'
      ) as present`),
  )[0];

  assert(
    'staff.school_user_id exists',
    column?.present === true,
    'the column is absent — Sprint 22 would need a migration after all, and has none',
  );

  const indexes = rows<{ indexname: string }>(
    await db.execute(sql`
      select indexname from pg_indexes
       where schemaname = 'public'
         and indexname in (${STAFF_LINK_INDEX}, ${PHONE_INDEX})`),
  ).map((row) => row.indexname);

  assert(
    `${STAFF_LINK_INDEX} exists`,
    indexes.includes(STAFF_LINK_INDEX),
    'the link is read on every staff list; without the index it is a sequential scan per row',
  );

  /*
   * The conflict target inside `createMemberAccount`. Drizzle infers
   * `on conflict (location_id, phone)` from the column list and Postgres
   * resolves that to an index at *plan* time — so a missing index is a 42P10
   * on the one statement in this sprint that is not executed here.
   */
  assert(
    `${PHONE_INDEX} exists — the inferred conflict target resolves`,
    indexes.includes(PHONE_INDEX),
    'createMemberAccount would raise 42P10 on every invitation',
  );

  /* ---------------------------------------------------------------------
   * Reads with no guard: a nobody tenant reaches them all.
   * ------------------------------------------------------------------ */

  console.log('\nWidened and new reads, against a tenant that owns no row:');

  /*
   * The single highest-risk statement in the sprint, and the one §5bg's 42702
   * shipped on. It already carried an ordered aggregate aliased
   * `student_guardian_phone` on a statement that also joins
   * `school_users.phone`; Sprint 22 adds a correlated `EXISTS` over `staff` to
   * the same select list.
   */
  await mustRun('listSchoolUsers — the users list, page query + count + 3 facets', () =>
    listSchoolUsers(NOBODY, {}),
  );

  /*
   * The same statement with the reconciliation filter on, which puts the
   * `NOT EXISTS` into the `WHERE` of all five queries rather than only the
   * select list of one. A different plan, so a different assertion.
   */
  await mustRun('listSchoolUsers — ?employment=none, the NOT EXISTS in every WHERE', () =>
    listSchoolUsers(NOBODY, { employment: 'none' }),
  );

  // Sorting by branch puts the aggregate, the EXISTS and the join in one plan.
  await mustRun('listSchoolUsers — employment=none, sorted by branch, searched', () =>
    listSchoolUsers(NOBODY, {
      employment: 'none',
      search: 'a',
      sort: 'branch',
      direction: 'desc',
    }),
  );

  await mustRun('listStaff — the directory, now selecting school_user_id', () =>
    listStaff(NOBODY, {}),
  );

  await mustRun('listStaff — ?linked=none, the split records', () =>
    listStaff(NOBODY, { linked: 'none' }),
  );

  await mustRun('listUnlinkedSchoolUsers — the link picker, rewritten as NOT EXISTS', () =>
    listUnlinkedSchoolUsers(NOBODY),
  );

  await mustRun('getStaffBySchoolUserId — the employment record, from the other end', () =>
    getStaffBySchoolUserId(NOBODY, NOBODY),
  );

  await mustRun('nextEmployeeCode — the highest EMP-<n> at this school', () =>
    nextEmployeeCode(NOBODY),
  );

  await mustRun('getStaff — read by all three new write routes before they act', () =>
    getStaff(NOBODY, NOBODY),
  );

  await mustRun('getSchoolUserById — the linked account on the staff profile', () =>
    getSchoolUserById(NOBODY, NOBODY),
  );

  await mustRun('emailHolderAt — the pre-check every creation path now shares', () =>
    emailHolderAt(NOBODY, 'nobody@example.invalid'),
  );

  /* ---------------------------------------------------------------------
   * Guarded statements. A nobody tenant cannot reach these, so they get a
   * real account and a nobody staff id: everything executes, nothing matches.
   * ------------------------------------------------------------------ */

  console.log('\nGuarded statements, against a real account and a staff id that is nobody:');

  /*
   * Discovered by shape and read-only, so this keeps working at a school this
   * sprint has never heard of: any active membership that no employment record
   * claims — which is what `listUnlinkedSchoolUsers` answers, at whatever
   * tenant has one.
   */
  const subject = rows<{ locationId: string; schoolUserId: string }>(
    await db.execute(sql`
      select su.location_id as "locationId",
             su.id          as "schoolUserId"
        from school_users su
       where su.is_active
         and su.role not in ('student', 'parent')
         and not exists (
               select 1 from staff s
                where s.location_id = su.location_id
                  and s.school_user_id = su.id)
       order by su.created_at, su.id
       limit 1`),
  )[0];

  if (subject === undefined) {
    notExercised(
      'accountLinkable / linkAccountToStaff',
      'no active staff-role account anywhere is unlinked, so the guard cannot be passed read-only. ' +
        'Every statement behind it is unproven on this run.',
    );
  } else {
    console.log(
      `  subject: account ${subject.schoolUserId.slice(0, 8)}… at ${subject.locationId}`,
    );

    /*
     * Both of `accountLinkable`'s statements: the tenant-ownership read and the
     * "is another record already holding this account" read. The second is the
     * one that enforces acceptance criterion 9, and it is exactly the kind of
     * read that a nobody tenant would short-circuit before reaching.
     */
    await mustReach(
      'accountLinkable — ownership read AND the already-claimed read',
      () => accountLinkable(subject.locationId, subject.schoolUserId, null),
      (result) => result.ok,
      'the account was not found or was refused, so the second statement was never issued',
    );

    /*
     * The guard passes, so the `UPDATE` behind it runs — against a staff id
     * that is nobody, so it matches no row and writes nothing. `claimStaffLink`
     * is the one statement both linking paths share, which is why executing it
     * once covers "Create a login" too.
     */
    await mustReach(
      'linkAccountToStaff — claimStaffLink, the UPDATE both link paths share',
      () => linkAccountToStaff(subject.locationId, NOBODY, subject.schoolUserId),
      (result) =>
        !result.linked && result.problem.startsWith('That employment record is already'),
      'it refused before the UPDATE — the guard, not the statement, decided this run',
    );
  }

  // The unlink UPDATE. A nobody tenant reaches it: there is no guard in front.
  await mustRun('unlinkAccountFromStaff — the UPDATE that clears the join', () =>
    unlinkAccountFromStaff(NOBODY, NOBODY),
  );

  console.log(
    `\n${failures === 0 ? 'PASS' : 'FAIL'} — ${String(passes)} ok, ${String(failures)} failed or not exercised\n`,
  );

  process.exit(failures === 0 ? 0 : 1);
}

void main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
