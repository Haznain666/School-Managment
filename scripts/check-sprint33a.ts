/**
 * Sprint 33a — the rules, then every new or widened statement, executed.
 *
 *     npm run check-sprint33a
 *
 * ── Part one needs no database ───────────────────────────────────────────
 * The pure rules this round turns on, and the three places a rule is only a
 * rule if both sides ask the same function:
 *
 *   · `slotsOverlap` — the comparison that was missing. The route and the
 *     builder must both import it, or the browser and the server are back to
 *     answering differently.
 *   · the digest's cadence and ceiling, and that its email now carries a link.
 *     It said *"Sign in to read and reply"* and nothing else for nine sprints.
 *   · the deep link's two shapes, which `lib/invite-links.ts` has already got
 *     wrong once by mailing a production origin a development parameter.
 *
 * A handful of assertions read source text rather than behaviour. They are
 * here because the defect they guard *is* a line of code — `play()` called
 * unconditionally, an attachment inserted on `db` after the transaction — and
 * nothing a type-checker or a passing build sees would change if it came back.
 *
 * ── Part two executes against the real schema ────────────────────────────
 * Printing `toSQL()` proves the names; only a server proves a statement
 * (CLAUDE.md). An ambiguous column reference is a *planning* error, so a
 * statement that has been read and not run is evidence about spelling and
 * nothing else — which is how 42702 shipped three times.
 *
 * Every read this sprint adds or widens runs here with a tenant id that
 * matches no row: nothing is read, nothing is written, and Postgres still
 * parses, resolves every column and plans. The script reads whether `0046` is
 * applied rather than being told, so one command works on both sides of it:
 *
 *   · before it, the statement touching `digest_count` must fail with exactly
 *     `42703` — **any other error is a real defect wearing a predicted
 *     failure's clothes**;
 *   · after it, every statement must execute.
 *
 * ── What is deliberately not executed, and why it is said here ───────────
 *  · `postMessage`, `markConversationRead`, `claimDigest` and
 *    `raiseDigestCount`. All four write. `check-sprint24`'s header states the
 *    rule this follows: a check script that issues an `UPDATE` against a live
 *    database is one edit away from issuing one that matches. Their columns
 *    are covered by the catalogue block and by the reads over the same rows.
 *  · `digestCandidates` **is** executed, and it is the one statement here with
 *    no tenant key — the sweep is cross-tenant by design. It is a read, it is
 *    capped at 200 rows, and nothing from it is printed but a count.
 *
 * Two traps, both paid for the first time this pattern was written: the
 * SQLSTATE is on the error's `cause` and not on the error, so reading `.code`
 * reports every failure as unpredicted; and a read that short-circuits before
 * it reaches the new column must be reported as *not exercised* rather than
 * passed.
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
const TENANT = 'no-such-tenant-sprint33a';

/** "Undefined column" — what a read of `digest_count` must give before `0046`. */
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
 * A statement that touches something `0046` adds.
 *
 * Applied: it must execute. Not applied: it must fail with **exactly**
 * `42703` — a different SQLSTATE is a different defect, and treating it as the
 * predicted one is how a real fault hides behind an expected failure.
 */
function afterMigration(applied: boolean) {
  return async (label: string, run: () => Promise<unknown>): Promise<void> => {
    if (applied) {
      await mustRun(label, run);
      return;
    }

    try {
      await run();
      fail(label, 'it executed although 0046 is not applied — the prediction is wrong');
    } catch (error) {
      const state = sqlState(error);
      if (state === UNDEFINED_COLUMN) {
        pass(label, `predicted ${UNDEFINED_COLUMN} — waiting on 0046`);
        return;
      }
      fail(label, `expected ${UNDEFINED_COLUMN} before 0046, got ${state ?? '?'} ${reason(error)}`);
    }
  };
}

const source = (path: string): string => readFileSync(path, 'utf8');

async function main(): Promise<void> {
  /* ══════════════════════════════════════════════ part one: the rules */

  const { minutesFromTime, slotsOverlap } = await import('../db/schema/timetable-slots');

  console.log('\nA1 — the comparison that was missing:');

  // The product owner's screenshot, in numbers: Nursery period 2 against
  // Year 1 period 3. Different slots, different structures, same minutes.
  assert(
    'Nursery 08:40–09:20 overlaps Year 1 09:05–09:45',
    slotsOverlap('08:40', '09:20', '09:05', '09:45'),
  );
  assert(
    'and it is the same answer either way round',
    slotsOverlap('09:05', '09:45', '08:40', '09:20'),
  );
  assert(
    'back to back is not a clash — 08:40–09:20 then 09:20–10:00',
    !slotsOverlap('08:40', '09:20', '09:20', '10:00'),
  );
  assert('a period always overlaps itself', slotsOverlap('08:40', '09:20', '08:40', '09:20'));
  assert(
    'a period wholly inside another is a clash',
    slotsOverlap('08:00', '10:00', '08:30', '09:00'),
  );
  assert('two different mornings do not clash', !slotsOverlap('08:00', '08:30', '11:00', '11:30'));
  assert('midnight arithmetic is minutes, not string length', minutesFromTime('09:05') === 545);

  const entriesRoute = source('app/api/school/timetable/entries/route.ts');
  const builder = source('components/academics/TimetableBuilder.tsx');

  assert(
    'the route refuses on time, from the shared helper',
    entriesRoute.includes('slotsOverlap(') && entriesRoute.includes('listTeacherBusySlots('),
    'the clash test is not using the shared helper — a slot_id test is back',
  );
  assert(
    'the builder refuses before the request, from the same helper',
    builder.includes('slotsOverlap(') && builder.includes('teacher-busy'),
  );
  assert(
    'the builder shows a pending state while it asks',
    builder.includes('Checking where this teacher is'),
  );

  const report = source('components/academics/TeacherOverlapReport.tsx');
  assert(
    'the overlap panel is read-only — it reports, it never repairs',
    !report.includes('schoolFetch') && !report.includes('method:'),
    'a control that writes has appeared on a report whose whole point is that it does not',
  );

  console.log('\nA2 — the attachment commits with its message:');

  const chatQueries = source('lib/chat-queries.ts');
  const messagesRoute = source('app/api/school/chat/conversations/[conversationId]/messages/route.ts');

  assert(
    'postMessage writes the attachment row on `tx`',
    chatQueries.includes('tx.insert(chatAttachments)'),
  );
  assert(
    'and the signals are the last statement in the batch',
    chatQueries.indexOf('tx.insert(chatAttachments)') <
      chatQueries.indexOf('statements.push(tx.insert(chatSignals)'),
  );
  assert(
    // Spelled with `.values` on purpose: the route's own docblock names the
    // call it used to make, and an assertion that matched prose would fail on
    // the explanation of the fix rather than on the fix.
    'the route no longer writes the attachment itself',
    !messagesRoute.includes('db.insert(chatAttachments).values'),
    'the two-commit race is back: a fetch between them returns the message with no file',
  );
  assert(
    'the upload still happens before the transaction',
    messagesRoute.indexOf('await uploadBuffer(') < messagesRoute.indexOf('await postMessage('),
  );

  console.log('\nA3 — the chime, and the signals behind it:');

  assert(
    'markConversationRead deletes that person’s signals for the thread',
    chatQueries.includes('.delete(chatSignals)'),
  );
  assert(
    'and resets the digest counter in the same transaction',
    chatQueries.includes('digestCount: 0'),
  );
  assert(
    'listSignalsSince excludes anything older than the read marker',
    chatQueries.includes('lt(chatParticipants.lastReadAt, chatSignals.createdAt)'),
  );

  const provider = source('components/chat/ChatStreamProvider.tsx');
  assert(
    'the provider rings once per batch, and not for the open thread',
    provider.includes('elsewhere.length > 0') && provider.includes('openConversation.current'),
    'play() is unconditional again — every catch-up rings for messages already read',
  );

  const workspace = source('components/chat/ChatWorkspace.tsx');
  assert(
    'the chat screen tells the provider which thread is open',
    workspace.includes('setOpenConversation('),
  );

  console.log('\nA4 — one email a day, five at most, with a link:');

  const digest = await import('../lib/chat-digest');
  const { chatPortalBase } = await import('../lib/chat-notifications');
  const { buildSchoolPortalUrl } = await import('../lib/invite-links');

  assert(
    'the interval is a day',
    digest.DIGEST_INTERVAL_MINUTES === 1440,
    String(digest.DIGEST_INTERVAL_MINUTES),
  );
  assert('the ceiling is five', digest.DIGEST_MAX_REMINDERS === 5);

  const linked = digest.buildDigestEmail({
    name: 'Aftab',
    unread: 1,
    schoolName: 'Askari School System',
    link: 'https://askari.example.com/parent/chat?c=abc',
  });

  assert('one waiting conversation reads as one', linked.subject === 'You have a new message at school');
  assert(
    'the email carries the deep link',
    linked.text.includes('https://askari.example.com/parent/chat?c=abc'),
    'the link is missing — this is the "Sign in to read and reply" email again',
  );
  assert(
    'and still says the message itself is not in the email',
    linked.text.includes('Messages are not sent by email'),
  );

  const plural = digest.buildDigestEmail({
    name: 'Aftab',
    unread: 3,
    schoolName: 'Askari School System',
    link: null,
  });
  assert('three reads as three', plural.subject === 'You have 3 conversations waiting');
  assert('and a missing link is not a broken sentence', !plural.text.includes('undefined'));

  assert(
    'every portal has a chat path',
    chatPortalBase('parent') === '/parent/chat' &&
      chatPortalBase('student') === '/student/chat' &&
      chatPortalBase('teacher') === '/teacher/chat' &&
      chatPortalBase('school_admin') === '/dashboard/chat' &&
      chatPortalBase('branch_admin') === '/dashboard/chat',
  );

  const previousBase = process.env.INVITE_LINK_BASE_URL;
  const previousDomain = process.env.PLATFORM_BASE_DOMAIN;

  process.env.INVITE_LINK_BASE_URL = 'http://localhost:3000';
  delete process.env.PLATFORM_BASE_DOMAIN;
  assert(
    'a local link keeps ?c= and adds &school=',
    buildSchoolPortalUrl('/parent/chat?c=abc', 'demo') ===
      'http://localhost:3000/parent/chat?c=abc&school=demo',
    buildSchoolPortalUrl('/parent/chat?c=abc', 'demo'),
  );

  process.env.INVITE_LINK_BASE_URL = 'https://schoolhub.example.com';
  assert(
    'a production link is the school’s own subdomain, query intact',
    buildSchoolPortalUrl('/parent/chat?c=abc', 'demo') ===
      'https://demo.schoolhub.example.com/parent/chat?c=abc',
    buildSchoolPortalUrl('/parent/chat?c=abc', 'demo'),
  );
  assert(
    'a path with no query is untouched by the split',
    buildSchoolPortalUrl('/login', 'demo') === 'https://demo.schoolhub.example.com/login',
  );

  if (previousBase === undefined) delete process.env.INVITE_LINK_BASE_URL;
  else process.env.INVITE_LINK_BASE_URL = previousBase;
  if (previousDomain !== undefined) process.env.PLATFORM_BASE_DOMAIN = previousDomain;

  console.log('\nA5 — the campus gap:');

  const hrQueries = source('lib/hr-queries.ts');
  const decisionRoute = source('app/api/school/hr/leave-requests/[requestId]/route.ts');

  assert('getLeaveRequest returns the applicant’s campus', hrQueries.includes('branchId: staff.branchId'));
  assert(
    'the decision refuses another campus with 403',
    decisionRoute.includes("'wrong_campus'") && decisionRoute.includes('outsideCampus('),
    'the PATCH still checks no campus — any id can be approved from anywhere',
  );
  assert(
    'school-wide access still sees everything',
    decisionRoute.includes('callerBranchId !== null'),
  );

  console.log('\nA6 — days used:');

  const leaveManager = source('components/hr/LeaveManager.tsx');
  assert('the draft is filled from the dates', leaveManager.includes('withCountedDays('));
  assert('and says what it counted', leaveManager.includes('countedLabel('));
  assert(
    'the field stays editable for a half day',
    leaveManager.includes('step={0.5}') && leaveManager.includes('totalDays: event.target.value'),
  );

  console.log('\n0046, and the permission catalogue it does not touch:');

  const migration = source('db/migrations/0046_sprint33a_chat_digest_count.sql');
  assert('0046 adds digest_count', migration.includes('"digest_count"'));
  assert(
    '0046 does not rewrite the permission CHECK, because Part A adds no key',
    !migration.includes('role_permissions_permission_check CHECK'),
  );

  const journal = source('db/migrations/meta/_journal.json');
  assert('0046 is in the journal', journal.includes('0046_sprint33a_chat_digest_count'));

  const { PERMISSIONS } = await import('../lib/permissions');

  /*
   * The migration that *currently* defines the constraint, not a named file.
   *
   * This read `0045` by name, which was correct for exactly as long as `0045`
   * was the last migration to rewrite `role_permissions_permission_check`.
   * Sprint 33b's `0047` widened it for `kpis.rate.section_head` and the four
   * `leave.*` keys, and this assertion failed saying they were "missing" — from
   * a file that is no longer the authority. `check-branch-scope.ts` learnt the
   * same lesson in CI when `0040` widened it, and `latestMigrationDefining`
   * there is the shape this now copies.
   *
   * The claim being made is *"the live constraint admits every key in
   * `PERMISSIONS`"*, and the file that answers it is the newest one to rewrite
   * it.
   */
  const needle = 'ADD CONSTRAINT "role_permissions_permission_check"';
  const constraintFile =
    readdirSync('db/migrations')
      .filter((name) => name.endsWith('.sql'))
      .sort()
      .reverse()
      .find((name) => source(`db/migrations/${name}`).includes(needle)) ?? '(none)';

  const constraintMigration = constraintFile === '(none)' ? '' : source(`db/migrations/${constraintFile}`);
  const missing = PERMISSIONS.filter((key) => !constraintMigration.includes(`'${key}'`));
  console.log(`  --    the permission CHECK is defined by ${constraintFile}`);
  assert(
    'every permission key is still admitted by the newest CHECK',
    missing.length === 0,
    `${missing.join(', ')} would be a 23514 the first time a school overrides it`,
  );

  /* ══════════════════════════════════ part two: against the real schema */

  loadDatabaseUrl();
  const { db } = await import('../lib/drizzle');

  const columns = (await db.execute(sql`
    select data_type, is_nullable, column_default
      from information_schema.columns
     where table_schema = 'public'
       and table_name = 'chat_participants'
       and column_name = 'digest_count'`)) as unknown as Array<{
    data_type: string;
    is_nullable: string;
    column_default: string | null;
  }>;

  const applied = columns.length === 1;
  console.log(
    `\n0046 is ${applied ? 'APPLIED' : 'NOT applied'} — ${
      applied
        ? 'every statement must execute'
        : 'the digest candidate read must fail with 42703'
    }`,
  );

  if (applied) {
    console.log('\nCatalogue assertions:');
    const column = columns[0];
    assert('digest_count is an integer', column?.data_type === 'integer', column?.data_type ?? '?');
    assert('it is NOT NULL', column?.is_nullable === 'NO', column?.is_nullable ?? '?');
    assert(
      'and it defaults to 0, so every existing row reads 0',
      (column?.column_default ?? '').startsWith('0'),
      column?.column_default ?? '(none)',
    );
  }

  const { listSignalsSince } = await import('../lib/chat-queries');
  const { listTeacherBusySlots, listTeacherOverlaps } = await import('../lib/academics-queries');
  const { getLeaveRequest, listLeaveRequests } = await import('../lib/hr-queries');

  console.log('\nStatements over tables that already exist:');

  await mustRun('listSignalsSince — now joined to school_users and the seat', () =>
    listSignalsSince(TENANT, NOBODY, new Date('2026-01-01T00:00:00Z')),
  );

  await mustRun('listTeacherBusySlots — entries ⋈ slots ⋈ sections ⋈ grades', () =>
    listTeacherBusySlots(TENANT, NOBODY, NOBODY),
  );

  await mustRun('listTeacherOverlaps — the report, school-wide', () =>
    listTeacherOverlaps(TENANT, NOBODY),
  );

  await mustRun('listTeacherOverlaps — narrowed to a visible grade', () =>
    listTeacherOverlaps(TENANT, NOBODY, { gradeIds: [NOBODY] }),
  );

  const emptyScope = await listTeacherOverlaps(TENANT, NOBODY, { gradeIds: [] });
  assert(
    'an empty visible scope reports nothing rather than everything',
    emptyScope.length === 0,
  );

  await mustRun('getLeaveRequest — widened with the applicant’s campus', () =>
    getLeaveRequest(TENANT, NOBODY),
  );

  await mustRun('listLeaveRequests — the same widening, on the list', () =>
    listLeaveRequests(TENANT, {}),
  );

  await mustRun('listLeaveRequests — narrowed to one campus', () =>
    listLeaveRequests(TENANT, { branchId: NOBODY }),
  );

  console.log('\nThe statement 0046 is for:');

  const newColumn = afterMigration(applied);

  await newColumn(
    'digestCandidates — five tables, two aggregates and the digest_count ceiling',
    () => digest.digestCandidates(new Date('2026-01-01T00:00:00Z')),
  );

  console.log(
    '\n  --    postMessage, markConversationRead, claimDigest and raiseDigestCount are\n' +
      '        not executed: all four write, and check-sprint24 records why a check\n' +
      '        script does not issue an UPDATE against a live database. Their columns\n' +
      '        are covered by the catalogue block above.',
  );

  console.log(`\n${failures === 0 ? 'PASS' : 'FAIL'} — ${String(passes)} passed, ${String(failures)} failed.`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
