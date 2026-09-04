import { sql } from 'drizzle-orm';
import { check, index, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

import { chatConversations } from './chat-conversations';
import { schoolUsers } from './school-users';
import { schools } from './schools';

/**
 * chat_messages — append-only, for the same reason the ledger is.
 *
 * ── Nothing here is ever updated or deleted ───────────────────────────────
 * `CLAUDE.md` justifies the append-only ledger like this: a parent disputing a
 * figure in March is asking about a payment made in October, and a ledger that
 * can be edited answers "it says 5,000 now", which is not an answer.
 *
 * A parent disputing **what a teacher said** is the identical problem, and it is
 * the one a school is least able to survive getting wrong. So there is no
 * `updated_at` on this table and no destructive delete anywhere in the module.
 * Removing a message writes `redacted_at`, `redacted_by` and
 * `redaction_reason`; the bubble renders "Message removed" and names who did
 * it, and `body` stays exactly as written for the investigation and the export.
 *
 * `ROADMAP.md` reached the same conclusion from the other direction on
 * 2026-08-07 — deleted-message-shaped holes in a safeguarding record are a
 * problem — which is why students and parents cannot redact at all and staff
 * redaction is gated on `chat.moderate`.
 *
 * ── The sender is snapshotted, following `feedback_replies` ───────────────
 * `sender_school_user_id` is `set null`, and `sender_name` / `sender_role` are
 * `NOT NULL` copies taken at write time. An account is deleted when somebody
 * leaves the school; the record of what they said must survive that, and must
 * still say who they were **at the time**. A join to the live row would rename
 * a message retrospectively when a teacher is promoted, which is precisely the
 * kind of quiet rewriting the rest of this docblock exists to prevent.
 *
 * ── `kind = 'system'` ─────────────────────────────────────────────────────
 * The thread's own narration: "Ms Ahmed opened class chat until 3:30pm", "This
 * conversation was frozen when the pupil left". It has no sender and is written
 * by the server, so `sender_school_user_id` is null and `sender_name` holds the
 * school's name. Rendering it as a message rather than as chrome means it is
 * carried by the export and read back in order with everything else.
 */

export const MESSAGE_KINDS = ['text', 'system'] as const;
export type MessageKind = (typeof MESSAGE_KINDS)[number];

/**
 * Longest a single message may be.
 *
 * Generous enough for a real explanation from a teacher and short enough that
 * pasting a document into the box is refused rather than silently truncated.
 * `announcements.body` allows 5,000 for the same reason; a message is not a
 * notice, so this is smaller.
 */
export const MESSAGE_BODY_MAX = 2000;

const kindList = MESSAGE_KINDS.map((kind) => `'${kind}'`).join(', ');

export const chatMessages = pgTable(
  'chat_messages',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    locationId: text('location_id')
      .notNull()
      .references(() => schools.locationId, { onDelete: 'cascade' }),
    conversationId: uuid('conversation_id')
      .notNull()
      .references(() => chatConversations.id, { onDelete: 'cascade' }),
    /** Null once the account is deleted, or for a system message. */
    senderSchoolUserId: uuid('sender_school_user_id').references(() => schoolUsers.id, {
      onDelete: 'set null',
    }),
    /** Who they were when they wrote it. Never re-read from the live row. */
    senderName: text('sender_name').notNull(),
    senderRole: text('sender_role').notNull(),
    kind: text('kind').notNull().default('text'),
    body: text('body').notNull(),
    /**
     * Set when a moderator removes the message. The three columns move
     * together and the body is never cleared — see the docblock.
     */
    redactedAt: timestamp('redacted_at', { withTimezone: true }),
    redactedBy: uuid('redacted_by').references(() => schoolUsers.id, { onDelete: 'set null' }),
    redactionReason: text('redaction_reason'),
    /**
     * True when an automated safeguarding scan matched this message. It does
     * not hide anything; it is what the escalation and the moderation queue
     * filter on.
     */
    flaggedAt: timestamp('flagged_at', { withTimezone: true }),
    flaggedReason: text('flagged_reason'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('chat_messages_location_id_idx').on(table.locationId),
    // The transcript read, and the turn-taking count.
    index('chat_messages_conversation_created_idx').on(table.conversationId, table.createdAt),
    // The moderation queue.
    index('chat_messages_flagged_idx').on(table.locationId, table.flaggedAt),
    check('chat_messages_kind_check', sql.raw(`kind IN (${kindList})`)),
    check(
      'chat_messages_body_check',
      sql`length(${table.body}) BETWEEN 1 AND ${sql.raw(String(MESSAGE_BODY_MAX))}`,
    ),
    // A redaction carries who and why, or it is not a redaction.
    check(
      'chat_messages_redaction_check',
      sql`(${table.redactedAt} IS NULL)
          = (${table.redactedBy} IS NULL AND ${table.redactionReason} IS NULL)`,
    ),
    // A system message has no sender account; a text message from a live
    // account has one. Both keep the snapshot.
    check(
      'chat_messages_system_sender_check',
      sql`${table.kind} <> 'system' OR ${table.senderSchoolUserId} IS NULL`,
    ),
  ],
);

export type ChatMessage = typeof chatMessages.$inferSelect;
export type NewChatMessage = typeof chatMessages.$inferInsert;
