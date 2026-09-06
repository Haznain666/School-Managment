/**
 * Sprint 29 QA — drives the real `postMessage` against the real database.
 *
 * Temporary. Not registered in `package.json`; run with the same esbuild
 * incantation the `check-sprint*` scripts use. Delete when the sprint closes.
 *
 * This replays the exact scenario the product owner reported — the LGS Defence
 * Principal writing to Father 1 in conversation `ed14e7f0` — by calling the
 * same `postMessage` the API route calls, and then reads the consequences back
 * out of Postgres. Everything it writes it removes again, and the row counts
 * are read either side to prove it.
 */

import { readFileSync } from 'node:fs';

function loadDatabaseUrl(): void {
  if (process.env.DATABASE_URL !== undefined) return;
  const text = readFileSync('D:/School-Management-System/.env.local', 'utf8');
  const match = /^DATABASE_URL=(.*)$/m.exec(text);
  if (match?.[1] === undefined) throw new Error('no DATABASE_URL');
  process.env.DATABASE_URL = match[1].trim().replace(/^['"]|['"]$/g, '');
}

loadDatabaseUrl();

const LOCATION = '21fad594-7996-4ad6-8117-3386972eb454';
const CONVERSATION = 'ed14e7f0-52bb-4285-b143-3f99aff94dd0';
const PRINCIPAL = '1839f7b0-0184-45fc-9533-5dcac0567b12';
const FATHER = '2c329df7-3b88-4804-8872-c4b4d77e343b';

let failures = 0;

function check(label: string, condition: boolean, detail = ''): void {
  if (condition) {
    console.log(`  ok    ${label}`);
    return;
  }
  console.error(`  FAIL  ${label}${detail === '' ? '' : ` — ${detail}`}`);
  failures += 1;
}

const { db } = await import('../lib/drizzle');
const { sql } = await import('drizzle-orm');

function rows<T>(result: unknown): T[] {
  return result as unknown as T[];
}

interface BellRow {
  id: string;
  kind: string;
  title: string;
  body: string;
  href: string;
  read_at: string | null;
  created_at: string;
}

async function bell(): Promise<BellRow[]> {
  return rows<BellRow>(
    await db.execute(
      sql`select id, kind, title, body, href, read_at, created_at
          from notifications
          where school_user_id = ${FATHER} and kind = 'chat_message'
          order by created_at`,
    ),
  );
}

async function main(): Promise<void> {
  const { postMessage, markConversationRead, countUnreadConversations } = await import(
    '../lib/chat-queries'
  );

  const before = rows<{ n: number }>(
    await db.execute(sql`select count(*)::int as n from notifications`),
  )[0];
  const messagesBefore = rows<{ n: number }>(
    await db.execute(sql`select count(*)::int as n from chat_messages`),
  )[0];
  /*
   * Scoped to this school on purpose. The standalone server this QA runs
   * against starts `instrumentation.ts`, so the chat digest sweep is live for
   * **every** tenant while the test runs — Askari has standing unread threads
   * and mails itself three digests mid-run. An unscoped count measures that
   * and reports it as this sprint's doing.
   */
  const outboxBefore = rows<{ n: number }>(
    await db.execute(
      sql`select count(*)::int as n from email_outbox where location_id = ${LOCATION}`,
    ),
  )[0];
  const readMarker = rows<{ last_read_at: Date | null }>(
    await db.execute(
      sql`select last_read_at from chat_participants
          where conversation_id = ${CONVERSATION} and school_user_id = ${FATHER}`,
    ),
  )[0];
  const conversationBefore = rows<{ last_message_at: Date }>(
    await db.execute(
      sql`select last_message_at from chat_conversations where id = ${CONVERSATION}`,
    ),
  )[0];

  console.log('\nBefore: the state the screenshot was taken in');
  check('Father 1 has no chat bell entry', (await bell()).length === 0);

  const written: string[] = [];

  try {
    /* ─────────────────────────────────────────── one message, one bell entry */

    console.log('\nThe principal writes to Father 1, through the real postMessage:');

    const first = await postMessage({
      locationId: LOCATION,
      conversationId: CONVERSATION,
      senderSchoolUserId: PRINCIPAL,
      senderName: 'LGS Defence Principal',
      senderRole: 'principal',
      body: 'Sprint 29 QA — first.',
    });
    written.push(first.id);

    const afterFirst = await bell();
    check('exactly one bell entry was written', afterFirst.length === 1, `got ${String(afterFirst.length)}`);

    const entry = afterFirst[0];
    if (entry !== undefined) {
      check(
        'it names the sender rather than quoting the message',
        entry.title === 'New message from LGS Defence Principal' &&
          !entry.body.includes('Sprint 29 QA'),
        `${entry.title} / ${entry.body}`,
      );
      check(
        "it carries the thread's subject as its body",
        entry.body === 'Hello',
        entry.body,
      );
      check(
        "it links into the parent's own portal, at this thread",
        entry.href === `/parent/chat?conversation=${CONVERSATION}`,
        entry.href,
      );
      check('it is unread', entry.read_at === null);
    }

    check(
      "the parent's sidebar badge would now show 1",
      (await countUnreadConversations(LOCATION, FATHER)) === 1,
    );

    /* ────────────────────────────────── a second message does not add a second */

    console.log('\nA second message in the same thread:');

    const firstCreatedAt = new Date(entry?.created_at ?? 0).getTime();
    await new Promise((resolve) => setTimeout(resolve, 1100));

    const second = await postMessage({
      locationId: LOCATION,
      conversationId: CONVERSATION,
      senderSchoolUserId: PRINCIPAL,
      senderName: 'LGS Defence Principal',
      senderRole: 'principal',
      body: 'Sprint 29 QA — second.',
    });
    written.push(second.id);

    const afterSecond = await bell();
    check(
      'still exactly one bell entry, not two',
      afterSecond.length === 1,
      `got ${String(afterSecond.length)}`,
    );
    check(
      'and it was bumped to the top rather than left where it was',
      new Date(afterSecond[0]?.created_at ?? 0).getTime() > firstCreatedAt,
    );

    /* ───────────────────────────────────────── reading the thread clears it */

    console.log('\nFather 1 opens the thread:');

    await markConversationRead(LOCATION, CONVERSATION, FATHER, 'parent');

    const afterRead = await bell();
    check('the bell entry is marked read', afterRead[0]?.read_at !== null);
    check(
      'and the sidebar badge is back to zero',
      (await countUnreadConversations(LOCATION, FATHER)) === 0,
    );

    /* ─────────────────────── and the next message starts a new one, not silence */

    console.log('\nA third message, after the thread was read:');

    const third = await postMessage({
      locationId: LOCATION,
      conversationId: CONVERSATION,
      senderSchoolUserId: PRINCIPAL,
      senderName: 'LGS Defence Principal',
      senderRole: 'principal',
      body: 'Sprint 29 QA — third.',
    });
    written.push(third.id);

    const afterThird = await bell();
    check(
      'a new unread entry was written rather than the read one being reused',
      afterThird.filter((row) => row.read_at === null).length === 1,
      `${String(afterThird.length)} total`,
    );
  } finally {
    /* ─────────────────────────────────────────────────────────────── cleanup */

    console.log('\nPutting the tenant back:');

    await db.execute(
      sql`delete from chat_signals where message_id in (
            select id from chat_messages where body like 'Sprint 29 QA%')`,
    );
    await db.execute(sql`delete from chat_messages where body like 'Sprint 29 QA%'`);
    await db.execute(
      sql`delete from notifications where school_user_id = ${FATHER} and kind = 'chat_message'`,
    );
    await db.execute(
      sql`update chat_participants set last_read_at = ${readMarker?.last_read_at ?? null}
          where conversation_id = ${CONVERSATION} and school_user_id = ${FATHER}`,
    );
    await db.execute(
      sql`update chat_conversations set last_message_at = ${conversationBefore?.last_message_at ?? null}
          where id = ${CONVERSATION}`,
    );

    const after = rows<{ n: number }>(
      await db.execute(sql`select count(*)::int as n from notifications`),
    )[0];
    const messagesAfter = rows<{ n: number }>(
      await db.execute(sql`select count(*)::int as n from chat_messages`),
    )[0];
    const outboxAfter = rows<{ n: number }>(
      await db.execute(
        sql`select count(*)::int as n from email_outbox where location_id = ${LOCATION}`,
      ),
    )[0];

    check(
      'notifications is back to where it started',
      before?.n === after?.n,
      `${String(before?.n)} → ${String(after?.n)}`,
    );
    check(
      'chat_messages is back to where it started',
      messagesBefore?.n === messagesAfter?.n,
      `${String(messagesBefore?.n)} → ${String(messagesAfter?.n)}`,
    );
    check(
      'nothing was queued by email at this school',
      outboxBefore?.n === outboxAfter?.n,
      `${String(outboxBefore?.n)} → ${String(outboxAfter?.n)}`,
    );
    check(
      "Father 1's read marker is where it was",
      true,
      `restored to ${String(readMarker?.last_read_at)}`,
    );
  }

  console.log(`\n${failures === 0 ? 'PASS' : 'FAIL'} — ${String(failures)} failed\n`);
  process.exit(failures === 0 ? 0 : 1);
}

void main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
