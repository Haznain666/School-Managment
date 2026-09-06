/**
 * Executes Sprint 29's new and widened statements against the real schema.
 *
 *     npm run check-sprint29
 *
 * ── Why this exists ──────────────────────────────────────────────────────
 * A green build says the SQL compiled, never that Postgres would accept it. An
 * ambiguous column reference is a *planning* error — 42702 is raised when the
 * statement is resolved, not when it returns rows — so a statement that has
 * been read and not run is evidence about spelling and nothing else. That is
 * how 42702 shipped three times, and it is why `check-sprint20` through `28`
 * exist. This is the same script pointed at this sprint's statements.
 *
 * ── This sprint has no migration, and that raises the bar rather than lowering it
 * Every statement below **must execute**. There is no `42P01` / `42703` to
 * predict and therefore no cover: a failure here is a real defect, not a
 * migration that has not been applied yet. The two things that could go wrong
 * are exactly the two this sprint introduces —
 *
 *   1. `postMessage`'s recipient read, widened from one column to three. It
 *      joins `chat_participants` to `school_users`, and **both tables have
 *      `location_id`, `school_user_id`-shaped ids and a `created_at`**. The
 *      new `role` column exists on `school_users` only, but `id` exists on
 *      both — which is the shape of 42702 and the reason this is run rather
 *      than read.
 *
 *   2. The three `notifications` statements that hold the bell entry to one
 *      row per conversation: a conditional `UPDATE … RETURNING` matching on
 *      five predicates, the `INSERT` that runs only when it claims nothing,
 *      and the `UPDATE` that clears it when the thread is opened.
 *
 * ── The writes are real, and they are rolled back ────────────────────────
 * A conditional `UPDATE … RETURNING` against a tenant that matches no row is a
 * read that returns nothing, and Trap 2 says that must be reported as *not
 * exercised* rather than passed — the statement planned, but nothing proved
 * the claim actually claims. So the dedupe is proved the way `verify-0040`
 * proved its safeguarding indexes: by writing two notifications inside a
 * transaction that is **always rolled back**, and requiring the second one to
 * find the first. The row count is read back afterwards to prove nothing
 * survived.
 *
 * ── The three traps, all paid for by earlier sprints ─────────────────────
 * 1. The SQLSTATE lives on the error's `cause` chain, not on the error. Reading
 *    `.code` reports every failure as unpredicted.
 * 2. A read that short-circuits before it reaches the new column must be
 *    reported as **not exercised**, never as a pass.
 * 3. postgres-js appends the whole failed query to the message; the `cause`
 *    carries the bare reason, so that is what is printed.
 *
 * ── The pure assertions ──────────────────────────────────────────────────
 * `chatPortalHref` for all eleven roles, because it is simultaneously the link
 * the bell follows **and** the dedupe key the conditional update matches on. A
 * role that produced the wrong path would not 500 — it would quietly write a
 * second bell row per message and link it into a portal the recipient cannot
 * open, which is a defect no query executes its way out of.
 *
 * Reads `DATABASE_URL` from the main checkout's `.env.local`, because a
 * worktree has no env of its own.
 */

import { readFileSync } from 'node:fs';

import { and, eq, isNull, sql } from 'drizzle-orm';

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

async function main(): Promise<void> {
  /* ═════════════════════════════════════ the pure assertions, no database */

  const { chatPortalHref, CHAT_NOTIFICATION_KIND } = await import('../lib/chat-notifications');
  const { USER_ROLES } = await import('../types/school-auth');

  console.log('\nThe bell href, which is also the dedupe key:');

  const expected: Record<string, string> = {
    parent: '/parent/chat',
    student: '/student/chat',
    teacher: '/teacher/chat',
    school_admin: '/dashboard/chat',
    branch_admin: '/dashboard/chat',
    principal: '/dashboard/chat',
    vice_principal: '/dashboard/chat',
    coordinator: '/dashboard/chat',
    accountant: '/dashboard/chat',
    hr_manager: '/dashboard/chat',
    marketing: '/dashboard/chat',
  };

  assert(
    'every role in USER_ROLES has an expected portal path here',
    USER_ROLES.every((role) => expected[role] !== undefined) &&
      Object.keys(expected).length === USER_ROLES.length,
    `USER_ROLES is ${String(USER_ROLES.length)}, this table is ${String(Object.keys(expected).length)}`,
  );

  for (const role of USER_ROLES) {
    const href = chatPortalHref(role, 'abc-123');
    assert(
      `${role} → ${expected[role] ?? '?'}`,
      href === `${expected[role] ?? ''}?conversation=abc-123`,
      `got ${href}`,
    );
  }

  assert(
    'the conversation id is encoded, so it can never break the key',
    chatPortalHref('parent', 'a b&c').endsWith('?conversation=a%20b%26c'),
    chatPortalHref('parent', 'a b&c'),
  );

  /*
   * The administrative sidebar's Messages badge.
   *
   * Asserted here rather than observed on screen, and the reason is recorded
   * because it is a gap: the platform operator's "Login as Admin" seat has **no
   * `school_users` row** — the chat screen tells you so in as many words — so
   * `unreadChats` is structurally 0 for the only administrative session QA can
   * open without a member of staff's own password.
   *
   * What is new here is the number being passed; `PortalSidebar` renders
   * `item.badge` with markup the parent, teacher and pupil sidebars have used
   * since Sprint 24. So this covers the half that is actually new.
   */
  console.log('\nThe administrative sidebar badge:');

  const { schoolNav } = await import('../components/school/school-nav');
  const { PERMISSIONS } = await import('../lib/permissions');
  const { emptyModuleFlags } = await import('../lib/platform-modules');

  const flags = { ...emptyModuleFlags(), chat: true };
  const navWith = (unreadChats: number) =>
    schoolNav({
      role: 'school_admin',
      permissions: [...PERMISSIONS],
      moduleFlags: flags,
      unreadChats,
    }).items.find((item) => item.href === '/dashboard/chat');

  assert('Messages is in the administrative sidebar at all', navWith(0) !== undefined, 'absent');
  assert(
    'with nothing unread it carries no badge, rather than a badge reading 0',
    navWith(0)?.badge === undefined,
    String(navWith(0)?.badge),
  );
  assert(
    'with three unread it carries the count',
    navWith(3)?.badge === 3,
    String(navWith(3)?.badge),
  );

  /* ═════════════════════════════════ the statements, against the real schema */

  console.log('\nThe widened recipient read in postMessage:');

  await mustRun(
    'chat_participants ⋈ school_users, three columns, both tables carrying id',
    async () => {
      const { chatParticipants } = await import('../db/schema/chat-participants');
      const { schoolUsers } = await import('../db/schema/school-users');
      const { ne } = await import('drizzle-orm');

      return db
        .select({
          authUserId: schoolUsers.authUserId,
          schoolUserId: schoolUsers.id,
          role: schoolUsers.role,
        })
        .from(chatParticipants)
        .innerJoin(schoolUsers, eq(schoolUsers.id, chatParticipants.schoolUserId))
        .where(
          and(
            eq(chatParticipants.locationId, 'no-such-tenant'),
            eq(chatParticipants.conversationId, NOBODY),
            isNull(chatParticipants.leftAt),
            ne(chatParticipants.schoolUserId, NOBODY),
          ),
        );
    },
  );

  await mustRun('the thread subject read that feeds the bell entry', async () => {
    const { chatConversations } = await import('../db/schema/chat-conversations');

    return db
      .select({ subject: chatConversations.subject })
      .from(chatConversations)
      .where(
        and(
          eq(chatConversations.locationId, 'no-such-tenant'),
          eq(chatConversations.id, NOBODY),
        ),
      )
      .limit(1);
  });

  console.log('\nThe three notifications statements the bell entry is held together by:');

  const { notifications } = await import('../db/schema/notifications');

  const bellPredicate = and(
    eq(notifications.audience, 'school_user'),
    eq(notifications.schoolUserId, NOBODY),
    eq(notifications.kind, CHAT_NOTIFICATION_KIND),
    eq(notifications.href, '/parent/chat?conversation=nothing'),
    isNull(notifications.readAt),
  );

  await mustRun('the conditional UPDATE … RETURNING that claims an existing entry', () =>
    db
      .update(notifications)
      .set({ title: 'x', body: 'y', createdAt: new Date() })
      .where(bellPredicate)
      .returning({ id: notifications.id }),
  );

  await mustRun('the UPDATE that clears it when the thread is opened', () =>
    db
      .update(notifications)
      .set({ readAt: new Date() })
      .where(bellPredicate)
      .returning({ id: notifications.id }),
  );

  /*
   * Trap 2. Both statements above matched no row, so they *planned* and proved
   * nothing about whether the claim claims. That is what this proves, and it
   * has to write to do it — inside a transaction that always rolls back.
   */
  console.log('\nOne row per conversation, proved by writing two and keeping one:');

  const before = rows<{ n: number }>(
    await db.execute(sql`select count(*)::int as n from notifications`),
  );

  const school = rows<{ location_id: string }>(
    await db.execute(sql`select location_id from schools limit 1`),
  );
  const member = rows<{ id: string; location_id: string }>(
    await db.execute(sql`select id, location_id from school_users limit 1`),
  );

  const subject = member[0];

  if (subject === undefined || school.length === 0) {
    console.log('  note  no school_users row on this database — the dedupe was not exercised');
    console.log('        Run this against a database with at least one school member.');
    failures += 1;
  } else {
    const href = `/parent/chat?conversation=${NOBODY}`;

    try {
      await db.transaction(async (tx) => {
        const insert = (title: string) =>
          tx.insert(notifications).values({
            audience: 'school_user' as const,
            locationId: subject.location_id,
            schoolUserId: subject.id,
            kind: CHAT_NOTIFICATION_KIND,
            title,
            body: 'first',
            href,
          });

        const claim = (title: string) =>
          tx
            .update(notifications)
            .set({ title, body: 'second', createdAt: new Date() })
            .where(
              and(
                eq(notifications.audience, 'school_user'),
                eq(notifications.schoolUserId, subject.id),
                eq(notifications.kind, CHAT_NOTIFICATION_KIND),
                eq(notifications.href, href),
                isNull(notifications.readAt),
              ),
            )
            .returning({ id: notifications.id });

        // Message one: nothing to claim, so it inserts.
        const claimedFirst = await claim('first message');
        assert(
          'the first message claims nothing and must insert',
          claimedFirst.length === 0,
          `claimed ${String(claimedFirst.length)} row(s) when the table held none`,
        );
        await insert('first message');

        // Message two: claims the row message one wrote, and inserts nothing.
        const claimedSecond = await claim('second message');
        assert(
          'the second message claims the first entry rather than adding one',
          claimedSecond.length === 1,
          `claimed ${String(claimedSecond.length)} row(s), expected exactly 1`,
        );

        const held = rows<{ n: number }>(
          await tx.execute(
            sql`select count(*)::int as n from notifications
                where school_user_id = ${subject.id}
                  and kind = ${CHAT_NOTIFICATION_KIND}
                  and href = ${href}`,
          ),
        );
        assert(
          'two messages in one conversation left exactly one bell entry',
          (held[0]?.n ?? -1) === 1,
          `found ${String(held[0]?.n)}`,
        );

        // Reading the thread clears it, and a third message then starts a new
        // one — which is the half that stops the badge going permanently quiet.
        await tx
          .update(notifications)
          .set({ readAt: new Date() })
          .where(
            and(
              eq(notifications.schoolUserId, subject.id),
              eq(notifications.href, href),
              isNull(notifications.readAt),
            ),
          );

        const claimedThird = await claim('third message');
        assert(
          'after the thread is read, the next message claims nothing and inserts again',
          claimedThird.length === 0,
          `claimed ${String(claimedThird.length)} row(s) against a read entry`,
        );

        tx.rollback();
      });
    } catch (error) {
      // `tx.rollback()` throws by design in Drizzle; anything else is real.
      const state = sqlState(error);
      const message = String((error as { message?: string } | null)?.message ?? error);
      if (state !== null || !message.toLowerCase().includes('rollback')) {
        fail('the dedupe transaction', describe(error));
      }
    }
  }

  const after = rows<{ n: number }>(
    await db.execute(sql`select count(*)::int as n from notifications`),
  );

  assert(
    'nothing survived the rollback',
    (before[0]?.n ?? -1) === (after[0]?.n ?? -2),
    `notifications moved from ${String(before[0]?.n)} to ${String(after[0]?.n)}`,
  );

  console.log('\nThe count the administrative sidebar badge is new to:');

  await mustRun('countUnreadConversations against a tenant that matches no row', async () => {
    const { countUnreadConversations } = await import('../lib/chat-queries');
    return countUnreadConversations('no-such-tenant', NOBODY);
  });

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
