import { sql } from 'drizzle-orm';
import { check, index, integer, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

import { branches } from './branches';
import { schoolUsers } from './school-users';
import { schools } from './schools';

/**
 * chat_broadcasts — one composition, thirty conversations.
 *
 * ── Why a broadcast is not a group thread ────────────────────────────────
 * A teacher with a class of thirty should write once, and that is the whole
 * request. It is *not* a request for a thirty-person room, and this schema
 * could not hold one anyway: `chat_participants_one_student_idx` makes a second
 * pupil in a conversation a `23505`, which is the control that makes
 * pupil-to-pupil messaging impossible rather than merely disallowed.
 *
 * So a broadcast fans out. One row here, then N ordinary `direct`
 * conversations, each private between the sender and one recipient, each
 * carrying `broadcast_id` back to this row. **No recipient ever learns who else
 * received it** — there is no query that would tell them, because they are not
 * participants in each other's threads.
 *
 * ── Why this table exists at all ─────────────────────────────────────────
 * The fan-out could have been anonymous: thirty conversations and nothing
 * joining them. Two things make that wrong.
 *
 * A teacher who sent one message to 7-B must see **one** row in a sent list,
 * not thirty. Without an id to group by, the screen that answers "what have I
 * sent this week" is unreadable exactly for the person the feature was built
 * for.
 *
 * And a fan-out that half-succeeded has to be diagnosable. `recipient_count`
 * and `skipped_count` are written at the end of the run, so "it said it went to
 * thirty and two never got it" has an answer that does not require reading
 * thirty conversation rows.
 *
 * ── The body is stored here as well as in each message ───────────────────
 * Deliberate duplication. The copy in `chat_messages` is what each recipient
 * actually received and is append-only with the rest of the transcript; the
 * copy here is what the sender wrote, and it survives every one of those
 * conversations being archived, frozen or redacted. They are the same text and
 * they answer different questions.
 */

/**
 * The most people one broadcast may reach.
 *
 * A blast-radius limit rather than a page size. Beyond this somebody is
 * addressing the whole school from a screen built for a class, and the fan-out
 * is N transactions on a shared plan — see the sequential chunking in
 * `lib/chat-broadcast.ts`.
 */
export const MAX_BROADCAST_RECIPIENTS = 200;

/** How the scope is described back to the sender: "Class 7-B", "5 students". */
export const BROADCAST_SCOPE_LABEL_MAX = 120;

export const chatBroadcasts = pgTable(
  'chat_broadcasts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    locationId: text('location_id')
      .notNull()
      .references(() => schools.locationId, { onDelete: 'cascade' }),
    branchId: uuid('branch_id').references(() => branches.id, { onDelete: 'set null' }),
    /** Null once the account is deleted; the snapshot below outlives it. */
    sentBy: uuid('sent_by').references(() => schoolUsers.id, { onDelete: 'set null' }),
    /** Who they were when they sent it. Never re-read from the live row. */
    sentByName: text('sent_by_name').notNull(),
    subject: text('subject'),
    body: text('body').notNull(),
    /** "Class 7-B", "5 students and their parents" — as shown to the sender. */
    scopeLabel: text('scope_label').notNull(),
    /** How many conversations were actually opened. */
    recipientCount: integer('recipient_count').notNull().default(0),
    /**
     * How many eligible-looking recipients were passed over — a pupil under a
     * live deny, an account gone inactive between the pick and the send.
     * Reported to the sender by name; counted here so the number survives.
     */
    skippedCount: integer('skipped_count').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('chat_broadcasts_location_id_idx').on(table.locationId),
    // The sender's own "what have I sent" list.
    index('chat_broadcasts_sender_idx').on(table.locationId, table.sentBy, table.createdAt),
    check(
      'chat_broadcasts_counts_check',
      sql`${table.recipientCount} >= 0 AND ${table.skippedCount} >= 0
          AND ${table.recipientCount} <= 200`,
    ),
    check(
      'chat_broadcasts_scope_label_check',
      sql`length(${table.scopeLabel}) BETWEEN 1 AND 120`,
    ),
    check('chat_broadcasts_body_check', sql`length(${table.body}) BETWEEN 1 AND 2000`),
  ],
);

export type ChatBroadcast = typeof chatBroadcasts.$inferSelect;
export type NewChatBroadcast = typeof chatBroadcasts.$inferInsert;
