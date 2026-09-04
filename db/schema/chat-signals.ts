import { index, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

import { chatConversations } from './chat-conversations';
import { chatMessages } from './chat-messages';
import { schools } from './schools';

/**
 * chat_signals — the only table a browser is ever allowed to read directly.
 *
 * ── The problem this solves ───────────────────────────────────────────────
 * `SPRINTS.md` records the intended real-time design as Postgres Changes over
 * `chat_messages`, with RLS as the gate: *"a conversation you are not a
 * participant in is refused by the database, not hidden by the UI."* That is
 * the right instinct and the wrong mechanism, for two reasons this codebase has
 * already written down elsewhere.
 *
 * First, RLS does not apply to the connection the app itself uses — postgres-js
 * through the Supavisor pooler, and the service role for Storage. So RLS would
 * gate only the *browser's* connection, which is a narrower claim than the one
 * being made.
 *
 * Second, the browser's connection authenticates with a GoTrue JWT, and
 * `STATE.md` warns that **changing a user's role does not refresh an existing
 * token**, while `SPRINTS.md` states flatly that authorization is read per
 * request from `school_users` via `membershipFor()` and *never* from the token.
 * An RLS policy keyed on a JWT claim is exactly the thing that rule forbids.
 * Streaming message bodies under it would make a child's privacy depend on a
 * claim that is known to go stale.
 *
 * ── So: the socket carries a signal, and the API carries the content ──────
 * A row here says *that* something happened in a conversation and to whom. It
 * carries no body, no subject, no sender name — nothing that would matter if
 * the wrong person received it. The client sees the signal and then fetches
 * through the ordinary route, where `withSchoolAuth` re-resolves membership on
 * that request against the live row.
 *
 * The cost is one extra round trip per message. What it buys is that
 * authorization stays in the one place the whole product already enforces it,
 * and RLS goes back to being what `STATE.md` calls it — *additional* defence,
 * not a replacement for the filters.
 *
 * ── `recipient_auth_user_id`, not a join ──────────────────────────────────
 * The RLS policy is a column comparison against an index:
 *
 *     USING (recipient_auth_user_id = auth.uid()::text)
 *
 * Storing the GoTrue id directly rather than reaching it through
 * `school_users.auth_user_id` keeps the policy off a per-row subquery, on a
 * table that fans out one row per recipient per message. It is `text` because
 * `school_users.auth_user_id` is `text`.
 *
 * ── Pruned, not kept ──────────────────────────────────────────────────────
 * A signal is worthless the moment it is delivered. The digest sweep deletes
 * anything older than a day; nothing reads these rows for history, and the
 * transcript lives in `chat_messages`.
 */

/** How long a signal is kept before the sweep takes it. */
export const SIGNAL_RETENTION_HOURS = 24;

export const chatSignals = pgTable(
  'chat_signals',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    locationId: text('location_id')
      .notNull()
      .references(() => schools.locationId, { onDelete: 'cascade' }),
    /** The GoTrue user id, matched against `auth.uid()` by the RLS policy. */
    recipientAuthUserId: text('recipient_auth_user_id').notNull(),
    conversationId: uuid('conversation_id')
      .notNull()
      .references(() => chatConversations.id, { onDelete: 'cascade' }),
    messageId: uuid('message_id')
      .notNull()
      .references(() => chatMessages.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('chat_signals_location_id_idx').on(table.locationId),
    // The policy's own predicate, and the client's initial catch-up read.
    index('chat_signals_recipient_created_idx').on(table.recipientAuthUserId, table.createdAt),
    // The prune.
    index('chat_signals_created_idx').on(table.createdAt),
  ],
);

export type ChatSignal = typeof chatSignals.$inferSelect;
export type NewChatSignal = typeof chatSignals.$inferInsert;
