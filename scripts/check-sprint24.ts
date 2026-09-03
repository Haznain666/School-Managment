/**
 * Executes Sprint 24's new statements against the real schema.
 *
 *     npm run check-sprint24
 *
 * ── Why this exists ──────────────────────────────────────────────────────
 * A green build says the SQL compiled, never that Postgres would accept it. An
 * ambiguous column reference is a *planning* error — 42702 is raised when the
 * statement is resolved, not when it returns rows — so a statement that has
 * been read and not run is evidence about spelling and nothing else. That is
 * how 42702 shipped three times, and it is why `check-sprint20` through `23`
 * exist. This is the same script pointed at this sprint's statements.
 *
 * ── This sprint is almost entirely new tables, which changes the odds ─────
 * `0040` creates eight of them, so nearly every statement here fails with
 * `42P01` (undefined *table*) rather than `42703` before it is applied. Both
 * are accepted by `afterMigration`, and nothing else is.
 *
 * The one statement that is not new-table-shaped is the `school_users` read
 * behind the pupil credential screen: it selects a column `0040` adds to a
 * table that already exists, so it must fail with exactly `42703`. Having both
 * codes accepted everywhere would have let that one hide behind the others.
 *
 * ── The statement this script mainly exists for ──────────────────────────
 * `listInbox` joins `chat_participants`, `chat_conversations`, `school_users`
 * and a grouped subquery, and it aliases an ordered `string_agg` over
 * `school_users.name` in a statement that also joins `school_users`. That is
 * the exact shape Sprint 18 shipped a 42702 with — an aggregate aliased
 * `phone` beside `school_users.phone`, which took the all-students screen to a
 * 500 at every school for as long as it was live. The alias here is
 * `chat_counterparty_name`, which no joined table has, and this script is what
 * proves Postgres agrees.
 *
 * ── The three traps, all paid for by earlier sprints ─────────────────────
 * 1. The SQLSTATE lives on the error's `cause` chain, not on the error.
 *    Reading `.code` answers `undefined` for every Drizzle failure.
 * 2. A read that short-circuits before reaching the new table must be reported
 *    as **not exercised**, never as a pass. `check-portals` printed `ok` for
 *    two and a half years on a statement it had never handed to Postgres.
 * 3. postgres-js appends the whole failed query to the message; the `cause`
 *    carries the bare reason, so that is what is printed.
 *
 * ── What is deliberately not executed, and why it is said here ───────────
 *  · `postMessage`. It writes four things in a transaction and one of them is
 *    a message. Its two reads — the recipient fan-out and the settings lookup —
 *    are executed directly instead, and the three writes are asserted in the
 *    catalogue by column rather than by running them.
 *  · `claimRoleInbox` and `freezeConversationsForStudent`. Both are conditional
 *    `UPDATE … RETURNING` statements against a nobody tenant, so both would
 *    match no row and write nothing — but a check script that issues an UPDATE
 *    against a live database is one edit away from issuing one that matches.
 *    Their predicates are covered by the reads over the same columns.
 *  · The pupil branch of `resolveReachable`. It returns before it reaches a
 *    chat table when the tenant has no active academic year, which every
 *    nobody-tenant does. Reported as a failure by the first draft of this
 *    script, which was the correct answer — see the note beside it for the
 *    substitute.
 *  · The RLS policy on `chat_signals`. It is enforced against the *browser's*
 *    connection and this script connects as the pooler user, which is not
 *    subject to it. Asserted from `pg_policies` in the catalogue block instead,
 *    which is the only thing this connection can honestly say about it.
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

/** "Undefined table" — what a statement over a table `0040` creates must give. */
const UNDEFINED_TABLE = '42P01';

/** "Undefined column" — what the one pre-existing-table statement must give. */
const UNDEFINED_COLUMN = '42703';

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
    pass(label, Array.isArray(value) ? `${String(value.length)} row(s)` : 'executed');
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

/**
 * A statement that touches something `0040` creates.
 *
 * Applied: it must execute. Not applied: it must fail with **exactly** the
 * SQLSTATE named — anything else in either direction is a defect, including a
 * *different* SQLSTATE in the not-applied half. That is the trap this wrapper
 * exists for: a predicted failure is only evidence if it is the predicted one.
 */
function afterMigration(applied: boolean, expected: string = UNDEFINED_TABLE) {
  return async (label: string, run: () => Promise<unknown>): Promise<void> => {
    if (applied) {
      await mustRun(label, run);
      return;
    }

    try {
      await run();
      fail(
        label,
        `it executed, but 0040 is not applied — so the statement is not touching the new schema at all`,
      );
    } catch (error) {
      const state = sqlState(error);
      if (state === expected) {
        pass(label, `predicted ${expected} — waiting on 0040`);
        return;
      }
      fail(label, `expected ${expected} before 0040, got ${describe(error)}`);
    }
  };
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

  const rows = <T>(result: unknown): T[] => result as unknown as T[];

  /* ---------------------------------------------------------------------
   * Is 0040 applied? Read, never assumed — so one command works on both
   * sides of the deploy and the expectation flips itself.
   * ------------------------------------------------------------------ */

  console.log('\nMigration 0040, read from the catalogue:');

  const tables = rows<{ table_name: string }>(
    await db.execute(sql`
      select table_name
        from information_schema.tables
       where table_schema = 'public'
         and table_name in (
           'chat_school_settings', 'chat_settings', 'chat_conversations',
           'chat_participants', 'chat_messages', 'chat_grants',
           'chat_reports', 'chat_signals'
         )
       order by table_name`),
  );

  const applied = tables.length === 8;
  console.log(
    `  ${String(tables.length)} of 8 chat tables present — ${applied ? 'APPLIED' : 'NOT APPLIED'}`,
  );

  if (tables.length !== 0 && !applied) {
    fail(
      '0040 is half applied',
      `only ${tables.map((row) => row.table_name).join(', ')} exist. ` +
        'Every assertion below is meaningless in this state — apply or roll back first.',
    );
  }

  /* ---------------------------------------------------------------------
   * The catalogue block: things this connection can assert without
   * executing the statement that depends on them.
   * ------------------------------------------------------------------ */

  if (applied) {
    console.log('\nCatalogue assertions:');

    const indexes = rows<{ indexname: string }>(
      await db.execute(sql`
        select indexname from pg_indexes
         where schemaname = 'public' and tablename = 'chat_participants'
         order by indexname`),
    ).map((row) => row.indexname);

    // The two lines the whole safeguarding design rests on. A missing partial
    // index does not fail any query — it silently permits the thing the module
    // exists to prevent, which is why it is asserted rather than assumed.
    assert(
      'chat_participants_one_student_idx exists',
      indexes.includes('chat_participants_one_student_idx'),
      'pupil-to-pupil messaging is NOT refused by the database without it',
    );
    assert(
      'chat_participants_one_posting_parent_idx exists',
      indexes.includes('chat_participants_one_posting_parent_idx'),
      'parent-to-parent messaging is NOT refused by the database without it',
    );

    const partial = rows<{ indexdef: string }>(
      await db.execute(sql`
        select indexdef from pg_indexes
         where schemaname = 'public'
           and indexname = 'chat_participants_one_student_idx'`),
    );

    // An index created without its WHERE clause would forbid *two participants*
    // in every conversation, which is a different and much louder bug — but one
    // created as non-unique would forbid nothing at all and say so nowhere.
    assert(
      'the student index is UNIQUE and partial',
      partial[0] !== undefined &&
        partial[0].indexdef.includes('UNIQUE') &&
        partial[0].indexdef.toLowerCase().includes('where'),
      `indexdef is ${partial[0]?.indexdef ?? '(missing)'}`,
    );

    const policies = rows<{ policyname: string; cmd: string }>(
      await db.execute(sql`
        select policyname, cmd from pg_policies
         where schemaname = 'public' and tablename = 'chat_signals'`),
    );

    assert(
      'chat_signals carries exactly one SELECT policy',
      policies.length === 1 && policies[0]?.cmd === 'SELECT',
      `found ${String(policies.length)} policies: ${policies
        .map((row) => `${row.policyname}/${row.cmd}`)
        .join(', ')}`,
    );

    const rls = rows<{ relrowsecurity: boolean }>(
      await db.execute(sql`
        select relrowsecurity from pg_class
         where oid = 'public.chat_signals'::regclass`),
    );

    assert(
      'row-level security is enabled on chat_signals',
      rls[0]?.relrowsecurity === true,
      'without it the SELECT policy grants nothing and restricts nothing',
    );

    const permissionCheck = rows<{ ok: boolean }>(
      await db.execute(sql`
        select pg_get_constraintdef(oid) like '%chat.moderate%' as ok
          from pg_constraint
         where conname = 'role_permissions_permission_check'`),
    );

    assert(
      'role_permissions CHECK admits the four chat keys',
      permissionCheck[0]?.ok === true,
      'saving the permission matrix will fail with 23514 — the §5o trap',
    );

    const moduleCheck = rows<{ ok: boolean }>(
      await db.execute(sql`
        select pg_get_constraintdef(oid) like '%''chat''%' as ok
          from pg_constraint
         where conname = 'school_modules_module_key_check'`),
    );

    assert(
      'school_modules CHECK admits the chat module key',
      moduleCheck[0]?.ok === true,
      'switching chat on for a school will fail with 23514',
    );
  }

  /* ---------------------------------------------------------------------
   * The statements.
   * ------------------------------------------------------------------ */

  const newTable = afterMigration(applied, UNDEFINED_TABLE);
  const newColumn = afterMigration(applied, UNDEFINED_COLUMN);

  const {
    countUnansweredFrom,
    countUnreadConversations,
    getChatSchoolSettings,
    initiateProblem,
    isParticipant,
    listInbox,
    listMessages,
    listSignalsSince,
    liveGrantsFor,
    resolveReachable,
    scopesFor,
    sendProblem,
    studentsMayInitiateWith,
  } = await import('../lib/chat-queries');

  console.log('\nStatements over the new tables:');

  /*
   * The one this script mainly exists for. Four tables and an aliased ordered
   * aggregate over a column one of them already has — see the header.
   */
  await newTable('listInbox — the four-table inbox with the aliased aggregate', () =>
    listInbox(NOBODY, NOBODY),
  );

  await newTable('countUnreadConversations — the unread badge', () =>
    countUnreadConversations(NOBODY, NOBODY),
  );

  await newTable('listMessages — the transcript, no cursor', () =>
    listMessages(NOBODY, NOBODY),
  );

  await newTable('listMessages — the transcript, with a since cursor', () =>
    listMessages(NOBODY, NOBODY, new Date('2026-01-01T00:00:00Z')),
  );

  await newTable('listSignalsSince — the reconnect catch-up read', () =>
    listSignalsSince(NOBODY, NOBODY, new Date('2026-01-01T00:00:00Z')),
  );

  await newTable('getChatSchoolSettings — the dials', () => getChatSchoolSettings(NOBODY));

  await newTable('studentsMayInitiateWith — the teacher opt-in', () =>
    studentsMayInitiateWith(NOBODY, NOBODY),
  );

  await newTable('isParticipant — the membership check every read is gated on', () =>
    isParticipant(NOBODY, NOBODY, NOBODY),
  );

  await newTable('countUnansweredFrom — both halves of the turn-taking count', () =>
    countUnansweredFrom(NOBODY, NOBODY, NOBODY),
  );

  /*
   * `sendProblem` reads a two-table join and then, only for a pupil, two more
   * statements. Against a nobody tenant the first read is empty and it returns
   * early — which is trap 2 exactly, so it is asserted by its *answer* rather
   * than by not throwing. "This conversation is not open to you" is the
   * refusal that proves the join ran and matched nothing.
   */
  if (applied) {
    await mustReach(
      'sendProblem — the participant-and-status join',
      () => sendProblem(NOBODY, NOBODY, NOBODY),
      (value) => value === 'This conversation is not open to you.',
      'it did not refuse a nobody tenant, so the join did not run as expected',
    );
  } else {
    await newTable('sendProblem — the participant-and-status join', () =>
      sendProblem(NOBODY, NOBODY, NOBODY),
    );
  }

  console.log('\nStatements over existing tables, widened or newly written:');

  /*
   * `scopesFor` joins four existing tables and is the one statement here that
   * would run today. It must execute on both sides of the migration.
   */
  await mustRun('scopesFor — student profile to section to grade to campus', () =>
    scopesFor(NOBODY, NOBODY),
  );

  /*
   * Every scope shape in one call, so the `inArray` and the scope filter are
   * exercised across all five rather than only the one a staff member has.
   * This is also the substitute for the pupil branch of `resolveReachable` —
   * see the note below it.
   */
  await newTable('liveGrantsFor — the grant read, across all five scope shapes', () =>
    liveGrantsFor(NOBODY, [
      { type: 'school_user', id: NOBODY },
      { type: 'student', id: NOBODY },
      { type: 'section', id: NOBODY },
      { type: 'grade', id: NOBODY },
      { type: 'branch', id: NOBODY },
    ]),
  );

  /*
   * The reachable list for each actor. The staff branch reads `school_users`
   * alone and runs today; the parent and pupil branches join the timetable and
   * the guardian chain, and the pupil branch reaches `chat_grants`.
   */
  await mustRun('resolveReachable — staff, the school_users directory read', () =>
    resolveReachable(NOBODY, { schoolUserId: NOBODY, role: 'teacher' }),
  );

  await mustRun('resolveReachable — parent, guardians to timetable and class teacher', () =>
    resolveReachable(NOBODY, { schoolUserId: NOBODY, role: 'parent' }),
  );

  /*
   * The pupil branch of `resolveReachable` is deliberately absent here, and
   * the first draft of this script had it and reported a failure — correctly.
   *
   * It opens with `getActiveAcademicYear`, which answers null for a tenant that
   * matches no row, and returns an empty list before reaching `chat_grants` at
   * all. That is trap 2 in the header: the statement never ran, so "it did not
   * throw" is not evidence about it, and a wrapper that let it pass would be
   * printing `ok` for a read Postgres has never seen — which is what
   * `check-portals` did for two and a half years.
   *
   * There is no nobody-tenant that has an active academic year, so the branch
   * cannot honestly be exercised from here. Its one chat-table statement is
   * `liveGrantsFor`, which is executed directly above across every scope shape,
   * and its remaining reads are the timetable join already covered by the
   * parent branch. The uncovered part is the *ordering* of those calls, and
   * that is a browser test rather than a planning one.
   */

  /*
   * `initiateProblem` for staff runs the reachable read and then a
   * `school_users` lookup; against a nobody tenant nothing is reachable, so it
   * refuses before touching a chat table. Asserted by its answer, because "it
   * did not throw" would be true of a statement that never ran.
   */
  await mustReach(
    'initiateProblem — staff, refused before it reaches a chat table',
    () => initiateProblem(NOBODY, { schoolUserId: NOBODY, role: 'teacher' }, { kind: 'person', id: NOBODY }),
    (value) => value === 'You cannot start a conversation with them.',
    'it did not refuse an unreachable target, so the reachable read did not run',
  );

  console.log('\nStatements written inline in the routes:');

  /*
   * The moderation queue joins `chat_reports` to `chat_messages` and orders by
   * two columns. It is written inline in the route rather than in the query
   * layer, which means nothing else would ever execute it — exactly the gap
   * this script exists to close.
   */
  await newTable('the moderation queue — chat_reports joined to chat_messages', () =>
    db.execute(sql`
      select r.id, r.severity, r.status, m.body, m.sender_name, m.redacted_at
        from chat_reports r
        join chat_messages m on m.id = r.message_id
       where r.location_id = ${NOBODY} and r.status = 'open'
       order by r.severity desc, r.created_at desc
       limit 200`),
  );

  await newTable('the live-grants screen — the open/standing predicate', () =>
    db.execute(sql`
      select id, scope_type, scope_id, effect, ends_at, granted_by_rank
        from chat_grants
       where location_id = ${NOBODY}
         and revoked_at is null
         and (ends_at is null or ends_at > now())
       order by created_at desc
       limit 200`),
  );

  await newTable('the desk-claim lookup, before the conditional UPDATE', () =>
    db.execute(sql`
      select role_inbox, branch_id
        from chat_conversations
       where location_id = ${NOBODY} and id = ${NOBODY} and kind = 'role_inbox'
       limit 1`),
  );

  await newTable('the per-person settings read', () =>
    db.execute(sql`
      select students_may_initiate, quiet_hours_from, quiet_hours_to
        from chat_settings
       where location_id = ${NOBODY} and school_user_id = ${NOBODY}
       limit 1`),
  );

  /*
   * The settings upsert names the unique index by its columns. A mismatch
   * between `onConflictDoUpdate`'s target and the index that actually exists is
   * a 42P10 at runtime and compiles perfectly, so the index is asserted rather
   * than the statement executed — the statement writes.
   */
  if (applied) {
    const settingsIndex = rows<{ indexdef: string }>(
      await db.execute(sql`
        select indexdef from pg_indexes
         where schemaname = 'public'
           and indexname = 'chat_settings_location_user_idx'`),
    );

    assert(
      'chat_settings has the unique index the upsert conflicts on',
      settingsIndex[0] !== undefined && settingsIndex[0].indexdef.includes('UNIQUE'),
      'onConflictDoUpdate would fail with 42P10 — no matching unique constraint',
    );
  }

  console.log('\nThe pupil credential column:');

  /*
   * The only statement in this sprint over a table that already exists, so the
   * only one whose predicted failure is 42703 rather than 42P01. Keeping it
   * separate is the point: with both codes accepted everywhere, a broken
   * statement here would have hidden behind the eight new tables.
   */
  await newColumn('school_users.student_credential_issued_at is selectable', () =>
    db.execute(sql`
      select "student_credential_issued_at"
        from "school_users"
       where "location_id" = ${NOBODY}
       limit 1`),
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
