import { sql } from 'drizzle-orm';
import { check, index, integer, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';

import { schoolUsers } from './school-users';
import { schools } from './schools';

/**
 * push_subscriptions — one browser, on one device, for one person.
 *
 * ── Why this is the thing chat was waiting for ───────────────────────────
 * `ROADMAP.md` says it plainly: chat replaces a channel parents *read* —
 * WhatsApp — with one they have to remember to open, and *"if a fee reminder
 * sits unread in a chat inbox nobody opens, collections suffer"*. Sprint 24
 * shipped the hourly digest email as the hedge. This is the answer.
 *
 * ── One row per browser, keyed on the endpoint ───────────────────────────
 * The push service mints an `endpoint` URL that *is* the identity of that
 * browser on that device, so it is the unique key rather than
 * `(school_user_id, device)` — a person with a phone, a laptop and a work
 * machine has three rows, and re-subscribing on one of them replaces exactly
 * that row.
 *
 * The unique index is on `endpoint` **alone**, not scoped to the tenant. That
 * is the one place in this schema a unique key is not tenant-scoped, and it is
 * correct: a browser is a browser. A parent with children at two schools on
 * this platform re-subscribes and the endpoint moves to whichever they are
 * signed into, which is what should happen — the alternative is two rows racing
 * to notify one browser about two different inboxes.
 *
 * ── The payload carries no message ──────────────────────────────────────
 * A push renders on a lock screen, in front of whoever is holding the phone.
 * So it carries a name and "sent you a message" and a URL, and never a body —
 * the same reasoning `chat_signals` is built on, applied somewhere it matters
 * more. Opening the notification lands on the conversation, where
 * `withSchoolAuth` re-resolves membership as it does for every other read.
 *
 * ── Dead subscriptions are deleted, never retried ───────────────────────
 * A push service answering `404` or `410 Gone` is telling you the browser is
 * gone — the tab was uninstalled, the user cleared site data, the PWA was
 * deleted. `failure_count` exists for the *other* errors, the transient ones,
 * and a row that keeps failing is removed by the sweep rather than kept
 * forever. Nothing here retries a `410`; there is nothing to retry to.
 *
 * ── iOS ─────────────────────────────────────────────────────────────────
 * Safari delivers Web Push only after the site is added to the home screen.
 * That is not a thing this table can fix and not a thing to hide: the enable
 * button says so on iOS rather than subscribing and silently never firing.
 */

/** Consecutive transient failures before the sweep gives up on a row. */
export const MAX_PUSH_FAILURES = 5;

export const pushSubscriptions = pgTable(
  'push_subscriptions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    locationId: text('location_id')
      .notNull()
      .references(() => schools.locationId, { onDelete: 'cascade' }),
    schoolUserId: uuid('school_user_id')
      .notNull()
      .references(() => schoolUsers.id, { onDelete: 'cascade' }),
    /** The push service's URL for this browser. Its identity, and the key. */
    endpoint: text('endpoint').notNull(),
    /** The browser's public key and auth secret, from `PushSubscription`. */
    p256dh: text('p256dh').notNull(),
    auth: text('auth').notNull(),
    /** Only to tell one device from another on a "your devices" list. */
    userAgent: text('user_agent'),
    failureCount: integer('failure_count').notNull().default(0),
    lastSentAt: timestamp('last_sent_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('push_subscriptions_location_id_idx').on(table.locationId),
    // The send path: everybody to notify, for one person.
    index('push_subscriptions_user_idx').on(table.schoolUserId),
    // A browser is a browser. See the docblock for why this is not tenant-scoped.
    uniqueIndex('push_subscriptions_endpoint_idx').on(table.endpoint),
    check(
      'push_subscriptions_failure_count_check',
      sql`${table.failureCount} >= 0 AND ${table.failureCount} <= 100`,
    ),
  ],
);

export type PushSubscriptionRow = typeof pushSubscriptions.$inferSelect;
export type NewPushSubscriptionRow = typeof pushSubscriptions.$inferInsert;
