/**
 * Executes Sprint 26's new statements against the real schema.
 *
 *     npm run check-sprint26
 *
 * ── Why this exists ──────────────────────────────────────────────────────
 * A green build says the SQL compiled, never that Postgres would accept it. An
 * ambiguous column reference is a *planning* error — 42702 is raised when the
 * statement is resolved, not when it returns rows — so a statement that has
 * been read and not run is evidence about spelling and nothing else. That is
 * how 42702 shipped three times, and it is why `check-sprint20` through `25`
 * exist. This is the same script pointed at this sprint's statements.
 *
 * ── The statement it mainly exists for ───────────────────────────────────
 * `listOverseeableConversations` joins **six** relations, two of them derived,
 * and both derived ones carry a `string_agg` or a renamed column beside tables
 * that already have `name`, `id` and `grade_id`. It is the exact shape Sprint
 * 18 shipped a 42702 with. Every column inside those subqueries is aliased
 * `oversight_*` — a prefix no table in this schema has — and this is where that
 * claim is tested rather than asserted.
 *
 * ── There is no migration in Sprint 26 ───────────────────────────────────
 * Nothing here is conditional on a migration, because the sprint adds no
 * column and no table: the oversight model is a query over what `0040` already
 * built, and the student portal credential reuses
 * `school_users.student_credential_issued_at` from the same migration. So every
 * statement below **must execute today**, and a predicted-failure branch would
 * be a branch that could never be taken. Its absence is the point, not an
 * omission — `0042` is still the next free migration number.
 *
 * ── The three traps, all paid for by earlier sprints ─────────────────────
 * 1. The SQLSTATE lives on the error's `cause` chain, not on the error.
 * 2. A read that short-circuits before reaching the statement must be reported
 *    as **not exercised**, never as a pass.
 * 3. postgres-js appends the whole failed query to the message; the `cause`
 *    carries the bare reason, so that is what is printed.
 *
 * ── What is deliberately not executed ────────────────────────────────────
 *  · `issueAndNotify`. It rotates a password in GoTrue and writes an outbox
 *    row — it is the one path in this sprint that writes. Its two reads are
 *    executed here (`studentContext`, the guardian list), and the refusals in
 *    front of it are `portalEligibility`, which is.
 *  · The email body. `buildStudentAccessMessage` is a pure function of strings
 *    and has nothing to do with Postgres.
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

async function mustRun(label: string, run: () => Promise<unknown>): Promise<void> {
  try {
    const value = await run();
    pass(label, Array.isArray(value) ? `${String(value.length)} row(s)` : 'executed');
  } catch (error) {
    fail(label, describe(error));
  }
}

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
  const oversight = await import('../lib/chat-oversight');
  const portal = await import('../lib/student-portal-access');
  const permissions = await import('../lib/permissions');

  console.log('\nThe permission, and who holds it by default:');

  assert(
    'chat.oversight is a permission',
    (permissions.PERMISSIONS as readonly string[]).includes('chat.oversight'),
    'it is missing from PERMISSIONS, so no matrix can grant it',
  );

  assert(
    'school_admin holds it',
    permissions.DEFAULT_ROLE_PERMISSIONS.school_admin.includes('chat.oversight'),
    'a School Administrator cannot read their own school',
  );

  assert(
    'principal holds it',
    permissions.DEFAULT_ROLE_PERMISSIONS.principal.includes('chat.oversight'),
    'a head cannot read the campuses they run',
  );

  /*
   * The one assertion in this file that is about an *absence*, and the one most
   * likely to be undone by accident. The product owner's rule is that a Branch
   * Administrator has no oversight at all — they message staff and teachers and
   * answer reported messages, and reading a campus's correspondence is the
   * head's accountability. A future tidy-up that grants the whole `chat` group
   * to every administrative role fails here rather than at a school.
   */
  assert(
    'branch_admin does NOT hold it',
    !permissions.DEFAULT_ROLE_PERMISSIONS.branch_admin.includes('chat.oversight'),
    'a campus administrator has been given oversight, which the product owner excluded',
  );

  assert(
    'vice_principal does NOT hold it',
    !permissions.DEFAULT_ROLE_PERMISSIONS.vice_principal.includes('chat.oversight'),
    'a deputy has been given oversight, which was not asked for',
  );

  console.log('\nThe scope resolver, without a database round trip where it promises one:');

  const asAdmin = await oversight.resolveOversightScope(NOBODY, 'school_admin', NOBODY);
  assert(
    'a School Administrator resolves to the whole school',
    asAdmin.kind === 'all',
    `expected kind "all", got "${asAdmin.kind}"`,
  );

  const asTeacher = await oversight.resolveOversightScope(NOBODY, 'teacher', NOBODY);
  assert(
    'a teacher resolves to nothing',
    asTeacher.kind === 'none',
    `expected kind "none", got "${asTeacher.kind}"`,
  );

  const asBranchAdmin = await oversight.resolveOversightScope(NOBODY, 'branch_admin', NOBODY);
  assert(
    'a branch administrator resolves to nothing',
    asBranchAdmin.kind === 'none',
    `expected kind "none", got "${asBranchAdmin.kind}"`,
  );

  console.log('\nModeration reach — the second door, which QA found disagreed with the first:');

  /*
   * A branch administrator holds `chat.moderate` and not `chat.oversight`.
   * Folding the two together would have refused them every reported message at
   * their own campus, so reach is derived separately. Asserted here because it
   * could not be exercised in a browser: neither school with a branch
   * administrator has a pupil conversation at their campus to moderate.
   */
  const baReach = await oversight.resolveModerationReach(NOBODY, 'branch_admin', NOBODY, NOBODY);
  assert(
    'a branch administrator moderates their own campus and no other',
    baReach.kind === 'scoped' &&
      Array.isArray(baReach.branchIds) &&
      baReach.branchIds.length === 1 &&
      baReach.gradeIds === null,
    `expected one campus and no grade narrowing, got ${JSON.stringify(baReach)}`,
  );

  const baNoBranch = await oversight.resolveModerationReach(NOBODY, 'branch_admin', NOBODY, null);
  assert(
    'a branch administrator with no campus on their session reaches nothing',
    baNoBranch.kind === 'scoped' &&
      Array.isArray(baNoBranch.branchIds) &&
      baNoBranch.branchIds.length === 0,
    `expected an empty campus list, got ${JSON.stringify(baNoBranch)}`,
  );

  const adminReach = await oversight.resolveModerationReach(NOBODY, 'school_admin', NOBODY, null);
  assert(
    'a School Administrator moderates the whole school',
    adminReach.kind === 'all',
    `expected kind "all", got "${adminReach.kind}"`,
  );

  /*
   * The one that is easy to get backwards. A role that oversees nothing but was
   * granted `chat.moderate` by a school's own matrix must not be silently
   * refused everything — that would be this sprint quietly removing a duty the
   * school assigned on purpose.
   */
  const teacherReach = await oversight.resolveModerationReach(NOBODY, 'teacher', NOBODY, null);
  assert(
    "a role a school granted chat.moderate to is taken at that school's word",
    teacherReach.kind === 'all',
    `expected kind "all" for a non-scoped moderator, got "${teacherReach.kind}"`,
  );

  console.log('\nThe oversight statements, executed against the real schema:');

  /*
   * The six-relation list, in all four scope shapes. Each takes a different
   * branch of `scopeCondition`, so running one proves nothing about the others:
   *
   *   · `all`      — no scope predicate at all
   *   · campus     — the branch `IN (…)` plus the school-wide null
   *   · grades     — the derived placement join and its `IN (…)`
   *   · unassigned — the two empty arrays, which must filter to zero rather
   *                  than to everything
   *
   * The grade-scoped shape is the one that reaches `oversight_placement`, so it
   * is the only one that proves the derived subquery plans.
   */
  await mustRun('listInbox for an overseer — kind "all"', () =>
    oversight.listOverseeableConversations(NOBODY, { kind: 'all', note: null }),
  );

  await mustRun('listOverseeableConversations — campus-scoped head', () =>
    oversight.listOverseeableConversations(NOBODY, {
      kind: 'scoped',
      branchIds: [NOBODY],
      gradeIds: null,
      note: null,
    }),
  );

  await mustRun('listOverseeableConversations — grade-scoped head (joins the placement)', () =>
    oversight.listOverseeableConversations(NOBODY, {
      kind: 'scoped',
      branchIds: [NOBODY],
      gradeIds: [NOBODY],
      note: null,
    }),
  );

  await mustRun('listOverseeableConversations — unassigned head, both arrays empty', () =>
    oversight.listOverseeableConversations(NOBODY, {
      kind: 'scoped',
      branchIds: [],
      gradeIds: [],
      note: null,
    }),
  );

  /*
   * `kind: 'none'` returns early and hands Postgres nothing. Reported as not
   * exercised in the SQL sense — and asserted on its *answer* instead, because
   * "the overseer of nothing sees nothing" is the assertion that matters and it
   * is not a statement.
   */
  assert(
    'kind "none" returns an empty list without querying',
    (await oversight.listOverseeableConversations(NOBODY, { kind: 'none' })).length === 0,
    'it returned rows for somebody with no oversight at all',
  );

  await mustRun('oversightAdmits — the single-row check, grade-scoped', () =>
    oversight.oversightAdmits(
      NOBODY,
      { kind: 'scoped', branchIds: [NOBODY], gradeIds: [NOBODY], note: null },
      NOBODY,
    ),
  );

  await mustRun('oversightAdmits — kind "all"', () =>
    oversight.oversightAdmits(NOBODY, { kind: 'all', note: null }, NOBODY),
  );

  assert(
    'oversightAdmits refuses somebody with no oversight',
    !(await oversight.oversightAdmits(NOBODY, { kind: 'none' }, NOBODY)),
    'it admitted a conversation to somebody who oversees nothing',
  );

  console.log('\nThe student portal statements:');

  /*
   * `portalEligibility` reads the school's chat settings first and then the
   * pupil's active placement. Against a nobody tenant the settings read answers
   * with the defaults — `studentLoginMinGradeSortOrder` null — and the function
   * returns *before* the placement query. That is trap 2 exactly: "it did not
   * throw" would be a statement about a query Postgres never saw.
   *
   * So it is asserted on the branch it actually takes, and the placement join
   * is executed separately below as the SQL it is.
   */
  const eligibility = await portal.portalEligibility(NOBODY, NOBODY);
  assert(
    'portalEligibility refuses a school with no threshold set',
    !eligibility.eligible && eligibility.thresholdGradeName === null,
    `expected a refusal with no threshold, got ${JSON.stringify(eligibility)}`,
  );

  notExercisedIsExpected(
    'portalEligibility — the placement join is NOT reached for a nobody tenant',
    'the settings read returns a null floor and the function returns before the join; ' +
      'the join itself is executed as raw SQL below',
  );

  await mustReach(
    'the active-placement join, as portalEligibility runs it',
    () =>
      db.execute(sql`
        select g.sort_order, g.name
          from student_enrollments se
          join sections s on s.id = se.section_id
          join grades g on g.id = s.grade_id
         where se.location_id = ${NOBODY}
           and se.student_profile_id = ${NOBODY}
           and se.status = 'active'
         limit 1`),
    (value) => Array.isArray(value),
    'it did not return a row set, so the statement did not run as a plain select',
  );

  await mustReach(
    'the threshold grade name, as portalEligibility runs it',
    () =>
      db.execute(sql`
        select name from grades
         where location_id = ${NOBODY} and sort_order = 9
         limit 1`),
    (value) => Array.isArray(value),
    'it did not return a row set',
  );

  await mustRun('portalAccessState — three reads in one call', () =>
    portal.portalAccessState(NOBODY, NOBODY),
  );

  await mustReach(
    'the student context read — profile, directory row and school in one join',
    () =>
      db.execute(sql`
        select su.name, sp.student_id, sc.name as school_name, sc.slug
          from student_profiles sp
          join school_users su on su.id = sp.school_user_id
          join schools sc on sc.location_id = sp.location_id
         where sp.location_id = ${NOBODY} and sp.id = ${NOBODY}
         limit 1`),
    (value) => Array.isArray(value),
    'it did not return a row set',
  );

  await mustReach(
    'the guardians who would receive a password',
    () =>
      db.execute(sql`
        select name, email from student_guardians
         where location_id = ${NOBODY} and student_profile_id = ${NOBODY}`),
    (value) => Array.isArray(value),
    'it did not return a row set',
  );

  /*
   * `autoIssuePortalAccess` never throws — that is its contract, and the two
   * callers that would otherwise roll back an admission or a promotion depend
   * on it. Asserted by calling it against a tenant that does not exist, which
   * is the closest thing to a failure this connection can produce.
   */
  const auto = await portal.autoIssuePortalAccess({
    locationId: NOBODY,
    studentProfileId: NOBODY,
  });
  assert(
    'autoIssuePortalAccess reports rather than throws for a student that does not exist',
    !auto.sent && auto.skipped !== null,
    `expected a skip with a reason, got ${JSON.stringify(auto)}`,
  );

  console.log('\nThe chat module flag, read from the rows that decide it:');

  const moduleRows = rows<{ location_id: string; is_enabled: boolean }>(
    await db.execute(sql`
      select location_id, is_enabled from school_modules where module_key = 'chat'`),
  );

  const schoolCount = rows<{ total: string }>(
    await db.execute(sql`select count(*)::text as total from schools`),
  )[0];

  /*
   * Not an assertion about correctness — an assertion about the *deploy*.
   *
   * Sprint 26's first finding was that no school on the platform had a `chat`
   * row at all, so the module flag read false everywhere and the Messages entry
   * was invisible to every administrator while teachers and parents had a
   * working inbox. The code fix makes the flag mean one thing on all four
   * portals; it does not switch anything on. This prints what is actually
   * there, so a deploy that forgot the data half is visible in one line rather
   * than as a bug report three weeks later.
   */
  const enabled = moduleRows.filter((row) => row.is_enabled).length;
  console.log(
    `        chat enabled at ${String(enabled)} of ${schoolCount?.total ?? '?'} school(s)`,
  );

  assert(
    'at least one school has the chat module switched on',
    enabled > 0,
    'no school has a chat row, so nobody can reach Messages from the admin portal — ' +
      'the data half of this sprint has not been applied',
  );

  console.log(
    `\n${failures === 0 ? 'PASS' : 'FAIL'} — ${String(passes)} ok, ${String(failures)} failed or not exercised\n`,
  );

  process.exit(failures === 0 ? 0 : 1);
}

/**
 * Records that a path was deliberately not reached, with its substitute named.
 *
 * Distinct from `notExercised`, which is a failure. This is the honest form of
 * "the short-circuit above it is correct and the statement is covered by the
 * raw SQL below" — trap 2 without pretending the trap was not there.
 */
function notExercisedIsExpected(label: string, why: string): void {
  console.log(`  note  ${label}`);
  console.log(`        ${why}`);
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
