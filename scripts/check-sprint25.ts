/**
 * Executes Sprint 25's new statements against the real schema.
 *
 *     npm run check-sprint25
 *
 * ── Why this exists ──────────────────────────────────────────────────────
 * A green build says the SQL compiled, never that Postgres would accept it. An
 * ambiguous column reference is a *planning* error — 42702 is raised when the
 * statement is resolved, not when it returns rows — so a statement that has
 * been read and not run is evidence about spelling and nothing else. That is
 * how 42702 shipped three times, and it is why `check-sprint20` through `24`
 * exist. This is the same script pointed at this sprint's statements.
 *
 * ── The half of this sprint that is not a statement ──────────────────────
 * `0041`'s riskiest line is `ALTER PUBLICATION supabase_realtime ADD TABLE
 * chat_signals`, and no query can exercise it: a missing publication membership
 * raises nothing, breaks no statement, and produces a websocket that connects
 * and then silently receives nothing forever. So it is asserted from
 * `pg_publication_tables` in the catalogue block, which is the only thing this
 * connection can honestly say about it.
 *
 * ── The three traps, all paid for by earlier sprints ─────────────────────
 * 1. The SQLSTATE lives on the error's `cause` chain, not on the error.
 *    Reading `.code` answers `undefined` for every Drizzle failure.
 * 2. A read that short-circuits before reaching the new table must be reported
 *    as **not exercised**, never as a pass. `check-portals` printed `ok` for
 *    two and a half years on a statement it had never handed to Postgres, and
 *    `check-sprint24`'s first run caught this in its own pupil branch.
 * 3. postgres-js appends the whole failed query to the message; the `cause`
 *    carries the bare reason, so that is what is printed.
 *
 * ── What is deliberately not executed, and why it is said here ───────────
 *  · The broadcast fan-out itself. It opens N conversations and posts N
 *    messages; running it against a live database would write. Its *reads* —
 *    the recipient resolution and the per-recipient `initiateProblem` — are
 *    covered by `check-sprint24`, and the constraint that makes the fan-out
 *    necessary is proved by attempt in `verify-0041.mjs`.
 *  · Every push send. `web-push` talks to Google and Mozilla, not to Postgres.
 *    The row it reads and the row it deletes are executed here; the HTTP is not.
 *  · The attachment upload. It writes to Storage. The size and content-type
 *    refusals are proved by attempt in `verify-0041.mjs`, which is the stronger
 *    evidence anyway.
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

const UNDEFINED_TABLE = '42P01';
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

/**
 * A statement that touches something `0041` creates.
 *
 * Applied: it must execute. Not applied: it must fail with **exactly** the
 * SQLSTATE named — anything else in either direction is a defect, including a
 * *different* SQLSTATE in the not-applied half.
 */
function afterMigration(applied: boolean, expected: string = UNDEFINED_TABLE) {
  return async (label: string, run: () => Promise<unknown>): Promise<void> => {
    if (applied) {
      await mustRun(label, run);
      return;
    }

    try {
      await run();
      fail(label, 'it executed, but 0041 is not applied — so it is not touching the new schema');
    } catch (error) {
      const state = sqlState(error);
      if (state === expected) {
        pass(label, `predicted ${expected} — waiting on 0041`);
        return;
      }
      fail(label, `expected ${expected} before 0041, got ${describe(error)}`);
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

  console.log('\nMigration 0041, read from the catalogue:');

  const tables = rows<{ table_name: string }>(
    await db.execute(sql`
      select table_name from information_schema.tables
       where table_schema = 'public'
         and table_name in ('chat_broadcasts', 'chat_attachments', 'push_subscriptions')
       order by table_name`),
  );

  const applied = tables.length === 3;
  console.log(
    `  ${String(tables.length)} of 3 new tables present — ${applied ? 'APPLIED' : 'NOT APPLIED'}`,
  );

  if (tables.length !== 0 && !applied) {
    fail(
      '0041 is half applied',
      `only ${tables.map((r) => r.table_name).join(', ')} exist — apply or roll back first`,
    );
  }

  if (applied) {
    console.log('\nCatalogue assertions:');

    /*
     * The one this script cannot test with a query. A missing publication
     * membership raises nothing, breaks no statement, and produces a websocket
     * that connects and then receives nothing forever while the poll fallback
     * covers for it. It is the only silent failure in this sprint.
     */
    const published = rows<{ tablename: string }>(
      await db.execute(sql`
        select tablename from pg_publication_tables
         where pubname = 'supabase_realtime'
           and schemaname = 'public'
           and tablename = 'chat_signals'`),
    );

    assert(
      'chat_signals is in the supabase_realtime publication',
      published.length === 1,
      'the websocket will subscribe successfully and receive NOTHING, with no error anywhere',
    );

    const rls = rows<{ relrowsecurity: boolean }>(
      await db.execute(sql`
        select relrowsecurity from pg_class where oid = 'public.chat_signals'::regclass`),
    );

    assert(
      'row-level security is still on chat_signals',
      rls[0]?.relrowsecurity === true,
      'a published table without RLS streams every tenant to every subscriber',
    );

    const endpointIdx = rows<{ indexdef: string }>(
      await db.execute(sql`
        select indexdef from pg_indexes
         where schemaname = 'public' and indexname = 'push_subscriptions_endpoint_idx'`),
    );

    assert(
      'push_subscriptions.endpoint is UNIQUE',
      endpointIdx[0] !== undefined && endpointIdx[0].indexdef.includes('UNIQUE'),
      're-subscribing a browser would create a duplicate row and double every push',
    );
  }

  const newTable = afterMigration(applied, UNDEFINED_TABLE);
  const newColumn = afterMigration(applied, UNDEFINED_COLUMN);

  console.log('\nStatements over the new tables:');

  await newTable('the sender’s broadcast list', () =>
    db.execute(sql`
      select b.id, b.subject, b.scope_label, b.recipient_count, b.skipped_count, b.created_at
        from chat_broadcasts b
       where b.location_id = ${NOBODY} and b.sent_by = ${NOBODY}
       order by b.created_at desc
       limit 50`),
  );

  /*
   * The join that turns one broadcast into its thirty threads. It is the
   * statement most likely to grow an ambiguous reference later, because both
   * tables carry `location_id`, `branch_id` and `created_at`.
   */
  await newTable('a broadcast joined to the conversations it opened', () =>
    db.execute(sql`
      select c.id, c.subject, c.last_message_at, b.scope_label
        from chat_conversations c
        join chat_broadcasts b on b.id = c.broadcast_id
       where c.location_id = ${NOBODY} and b.id = ${NOBODY}
       order by c.created_at`),
  );

  await newTable('an attachment fetched for the proxy route', () =>
    db.execute(sql`
      select a.storage_path, a.file_name, a.content_type, a.size_bytes, m.conversation_id
        from chat_attachments a
        join chat_messages m on m.id = a.message_id
       where a.location_id = ${NOBODY} and a.id = ${NOBODY}
       limit 1`),
  );

  await newTable('the attachments on a transcript', () =>
    db.execute(sql`
      select a.id, a.file_name, a.content_type, a.size_bytes, a.message_id
        from chat_attachments a
       where a.location_id = ${NOBODY}
         and a.message_id in (
           select m.id from chat_messages m
            where m.location_id = ${NOBODY} and m.conversation_id = ${NOBODY}
         )`),
  );

  await newTable('every browser to push to, for one person', () =>
    db.execute(sql`
      select p.id, p.endpoint, p.p256dh, p.auth, p.failure_count
        from push_subscriptions p
       where p.location_id = ${NOBODY} and p.school_user_id = ${NOBODY}`),
  );

  /*
   * The push fan-out's own read: everybody with something unread who wants a
   * buzz. Five tables, and the `push_chat` preference is the new half.
   */
  await newTable('the push fan-out — participants to subscriptions to preference', () =>
    db.execute(sql`
      select p.endpoint, u.name as recipient_name
        from chat_participants cp
        join chat_conversations c on c.id = cp.conversation_id
        join school_users u on u.id = cp.school_user_id
        join push_subscriptions p on p.school_user_id = cp.school_user_id
   left join notification_preferences np
          on np.location_id = cp.location_id and np.school_user_id = cp.school_user_id
       where cp.location_id = ${NOBODY}
         and cp.left_at is null
         and c.status = 'open'
         and (cp.last_read_at is null or cp.last_read_at < c.last_message_at)
         and coalesce(np.push_chat, true)
       limit 200`),
  );

  console.log('\nStatements over columns 0041 adds to existing tables:');

  await newColumn('chat_settings.sound_enabled, as the settings route reads it', () =>
    db.execute(sql`
      select students_may_initiate, quiet_hours_from, quiet_hours_to, sound_enabled
        from chat_settings
       where location_id = ${NOBODY} and school_user_id = ${NOBODY}
       limit 1`),
  );

  await newColumn('chat_conversations.broadcast_id, as listInbox now selects it', () =>
    db.execute(sql`
      select id, subject, broadcast_id, last_message_at
        from chat_conversations
       where location_id = ${NOBODY}
       order by last_message_at desc
       limit 50`),
  );

  await newColumn('notification_preferences.push_chat', () =>
    db.execute(sql`
      select email_announcements, email_fees, email_attendance, email_chat, push_chat
        from notification_preferences
       where location_id = ${NOBODY} and school_user_id = ${NOBODY}
       limit 1`),
  );

  await newColumn('school_users deactivation audit', () =>
    db.execute(sql`
      select id, is_active, deactivated_at, deactivated_reason
        from school_users
       where location_id = ${NOBODY}
       limit 1`),
  );

  /*
   * The rule that must hold whichever button the clerk presses: a guardian with
   * another actively enrolled child is never deactivated. This is that
   * question, asked exactly as the removal path asks it — and it runs today,
   * because every table in it already exists.
   *
   * Asserted by its answer rather than by not throwing: against a nobody tenant
   * the honest result is an empty list, and "it did not throw" would be true of
   * a statement that never ran. An empty array *is* the reached state here
   * because the statement is a plain SELECT with no early return above it.
   */
  await mustReach(
    'guardians who would keep their login — the other-children check',
    () =>
      db.execute(sql`
        select sg.school_user_id
          from student_guardians sg
          join student_profiles sp on sp.id = sg.student_profile_id
          join student_enrollments se on se.student_profile_id = sp.id
         where sg.location_id = ${NOBODY}
           and se.status = 'active'
           and sp.id <> ${NOBODY}
           and sg.school_user_id is not null
         group by sg.school_user_id`),
    (value) => Array.isArray(value),
    'it did not return a row set, so the statement did not run as a plain select',
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
