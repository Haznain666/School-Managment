import { sql } from 'drizzle-orm';
import { check, index, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

import { schoolUsers } from './school-users';
import { schools } from './schools';

/**
 * notifications — the in-app bell, on the platform surface and inside a school.
 *
 * ── Why a table and not a derived count ──────────────────────────────────
 * `announcement_reads` already answers "has this parent seen that notice", and
 * the obvious move was to widen it. It was not widened, because an announcement
 * is a *document* a school publishes and a notification is an *event* that
 * happened to one person. The two differ in every way that matters: an
 * announcement has an audience resolved at read time and outlives being read; a
 * notification names exactly one recipient, is created by the event that caused
 * it, and stops mattering the moment it is opened.
 *
 * Deriving the bell from the underlying rows instead — "count feedback tickets
 * where status = 'unread'" — works for exactly the first feature that needs it
 * and then has to be rewritten for the second. Every later event source writes
 * one row here and the bell is unchanged.
 *
 * ── The Super Admin has no user row, and that shapes the table ───────────
 * There is no `school_users` record for the platform operator — they are not a
 * member of any school. So the recipient is a *pair*: an `audience` naming
 * which surface it belongs to, and, for the school side only, the
 * `school_user_id` it is addressed to. `audience = 'super_admin'` rows carry no
 * user id and are read by whoever is signed in to the platform portal, which is
 * exactly one person by construction.
 *
 * ── Read is a timestamp, not a boolean ───────────────────────────────────
 * "When did they see it" is a question the boolean cannot answer and the
 * timestamp answers for free, and `read_at IS NULL` is the same index either
 * way.
 */

/** Which portal a notification belongs on. */
export const NOTIFICATION_AUDIENCES = ['super_admin', 'school_user'] as const;
export type NotificationAudience = (typeof NOTIFICATION_AUDIENCES)[number];

/**
 * What happened. Free-form on purpose — it is a label for grouping and for
 * choosing an icon, never a branch in a query — but the values in use are kept
 * here so a reader can see the set.
 */
export const NOTIFICATION_KINDS = [
  'feedback_submitted',
  'feedback_status',
  'feedback_reply',
  /*
   * Sprint 27. `sendAnnouncement` has written `announcement_recipients` and the
   * notice board since Sprint 11 and **nothing here**, so the bell in every
   * portal header has never moved for an announcement in the product's life.
   * `NotificationBell` was correct and the table was empty.
   *
   * No migration is needed for this line: `kind` is free-form by design — see
   * the docblock above — and carries no CHECK. The list is a label for grouping
   * and for choosing an icon, and keeping it here is how a reader sees the set.
   */
  'announcement',
] as const;
export type NotificationKind = (typeof NOTIFICATION_KINDS)[number];

export const notifications = pgTable(
  'notifications',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    audience: text('audience').notNull().$type<NotificationAudience>(),
    /**
     * The school this concerns. Set on both audiences: a platform notification
     * about one school's feedback still names that school, which is what lets
     * the bell say "Beacon House" rather than "a school".
     */
    locationId: text('location_id').references(() => schools.locationId, {
      onDelete: 'cascade',
    }),
    /** The one person it is addressed to. Null on `super_admin` rows. */
    schoolUserId: uuid('school_user_id').references(() => schoolUsers.id, {
      onDelete: 'cascade',
    }),
    kind: text('kind').notNull(),
    title: text('title').notNull(),
    body: text('body').notNull(),
    /** Where clicking it goes. Always a path within the same portal. */
    href: text('href').notNull(),
    readAt: timestamp('read_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('notifications_audience_idx').on(table.audience, table.createdAt),
    index('notifications_school_user_idx').on(table.schoolUserId, table.createdAt),
    check(
      'notifications_audience_check',
      sql`${table.audience} IN ('super_admin', 'school_user')`,
    ),
    /*
     * A school notification with nobody to deliver it to is not a notification.
     * The inverse is not constrained: a platform row may legitimately carry a
     * `location_id` (the school it is about) and never a user id.
     */
    check(
      'notifications_recipient_check',
      sql`${table.audience} <> 'school_user' OR ${table.schoolUserId} IS NOT NULL`,
    ),
  ],
);

export type Notification = typeof notifications.$inferSelect;
export type NewNotification = typeof notifications.$inferInsert;
