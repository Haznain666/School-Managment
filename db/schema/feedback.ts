import { sql } from 'drizzle-orm';
import {
  check,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';

import { schoolUsers } from './school-users';
import { schools } from './schools';

/**
 * feedback_tickets + feedback_attachments + feedback_replies — what a school
 * tells the people who build this product, and what they say back.
 *
 * Three tables in one file because they are one concept: a ticket with no
 * attachments cannot carry the screenshot that makes a bug report actionable,
 * and a reply belongs to nothing else.
 *
 * ── This is not an announcement, and not a support desk ──────────────────
 * `announcements` is a school talking to the people *inside* it. This is a
 * school talking to the vendor, across the tenant boundary, and it is the only
 * table in the product a Super Admin reads for content rather than for
 * administration. That is why the submitter's name and address are copied onto
 * the row rather than joined: the operator reading a bug report six months
 * later needs to know who wrote it even if that person has since left the
 * school and their `school_users` row is gone.
 *
 * ── Why the tenant key is still `location_id` ────────────────────────────
 * Every read on the school side filters on it exactly as every other table
 * does, so a school administrator sees their own school's tickets and nothing
 * else. The Super Admin side deliberately does *not* filter — that surface is
 * cross-tenant by definition — which is why those routes are behind
 * `requireSuperAdmin` and never behind `withSchoolAuth`.
 */

/** What the school is telling us. */
export const FEEDBACK_NATURES = ['bug', 'suggestion'] as const;
export type FeedbackNature = (typeof FEEDBACK_NATURES)[number];

export const FEEDBACK_NATURE_LABELS: Record<FeedbackNature, string> = {
  bug: 'Bug',
  suggestion: 'Suggestion',
};

/**
 * Where a ticket has got to.
 *
 * `unread` and `read` are both *active* — nobody has decided anything yet, and
 * the distinction is only whether an operator has opened it. The other three
 * are decisions, and each one moves the ticket out of the active list.
 *
 * A sixth value for "rejected" was deliberately not added. A school told its
 * suggestion was rejected learns nothing it can act on; "Future development" is
 * the honest form of the same answer and it is the one the product owner asked
 * for.
 */
export const FEEDBACK_STATUSES = [
  'unread',
  'read',
  'in_progress',
  'future',
  'resolved',
] as const;
export type FeedbackStatus = (typeof FEEDBACK_STATUSES)[number];

export const FEEDBACK_STATUS_LABELS: Record<FeedbackStatus, string> = {
  unread: 'Unread',
  read: 'Read',
  in_progress: 'Work in progress',
  future: 'Future development',
  resolved: 'Resolved',
};

/**
 * The statuses a Super Admin may *choose*.
 *
 * `unread` and `read` are not on this list on purpose: neither is a decision.
 * `read` is set by the act of opening the ticket and `unread` is what a ticket
 * is born as, so offering either as a control would let an operator un-decide a
 * ticket into a state meaning "nobody has looked at this", which would then be
 * untrue.
 */
export const FEEDBACK_DECISION_STATUSES = ['in_progress', 'future', 'resolved'] as const;
export type FeedbackDecisionStatus = (typeof FEEDBACK_DECISION_STATUSES)[number];

export function isFeedbackNature(value: unknown): value is FeedbackNature {
  return typeof value === 'string' && (FEEDBACK_NATURES as readonly string[]).includes(value);
}

export function isFeedbackStatus(value: unknown): value is FeedbackStatus {
  return typeof value === 'string' && (FEEDBACK_STATUSES as readonly string[]).includes(value);
}

export function isFeedbackDecisionStatus(value: unknown): value is FeedbackDecisionStatus {
  return (
    typeof value === 'string' &&
    (FEEDBACK_DECISION_STATUSES as readonly string[]).includes(value)
  );
}

export const feedbackTickets = pgTable(
  'feedback_tickets',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /** The school that wrote it — the tenant key. */
    locationId: text('location_id')
      .notNull()
      .references(() => schools.locationId, { onDelete: 'cascade' }),
    /**
     * Who wrote it. Null once their account is removed — the ticket survives
     * the person, which is why the two snapshot columns below exist.
     */
    submittedBy: uuid('submitted_by').references(() => schoolUsers.id, {
      onDelete: 'set null',
    }),
    /** Their name and address as they were at the moment of writing. */
    submittedByName: text('submitted_by_name').notNull(),
    submittedByEmail: text('submitted_by_email').notNull(),
    title: text('title').notNull(),
    body: text('body').notNull(),
    nature: text('nature').notNull().default('suggestion').$type<FeedbackNature>(),
    status: text('status').notNull().default('unread').$type<FeedbackStatus>(),
    /** When a Super Admin first opened it. Null while `unread`. */
    readAt: timestamp('read_at', { withTimezone: true }),
    /**
     * When the status last changed, which is not `updated_at`: a reply touches
     * the ticket without changing what was decided about it, and the listing
     * sorts on the decision rather than on the conversation.
     */
    statusChangedAt: timestamp('status_changed_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('feedback_tickets_location_idx').on(table.locationId, table.createdAt),
    index('feedback_tickets_status_idx').on(table.status, table.createdAt),
    index('feedback_tickets_nature_idx').on(table.nature),
    check(
      'feedback_tickets_nature_check',
      sql`${table.nature} IN ('bug', 'suggestion')`,
    ),
    check(
      'feedback_tickets_status_check',
      sql`${table.status} IN ('unread', 'read', 'in_progress', 'future', 'resolved')`,
    ),
  ],
);

/**
 * The five files a ticket may carry.
 *
 * The cap is enforced in `lib/feedback.ts` and again in the route, not by a
 * constraint: Postgres cannot express "at most five children" without a trigger
 * or a counter column, and both would be a second source of truth for a rule
 * whose only enforcement point is the one upload that creates them all.
 *
 * ── The object is never public, and that is the whole design ─────────────
 * `school-assets` is a public bucket, so a stored public URL would hand the
 * file to anyone who ever saw the link. Only the object *path* is kept here;
 * `GET …/attachments/[attachmentId]` verifies the caller, streams the bytes
 * through the service-role key, and sets `Content-Disposition: attachment`. A
 * uuid in a path is not an access control.
 */
export const feedbackAttachments = pgTable(
  'feedback_attachments',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    ticketId: uuid('ticket_id')
      .notNull()
      .references(() => feedbackTickets.id, { onDelete: 'cascade' }),
    /** Object path inside the Storage bucket. Never a URL. */
    storagePath: text('storage_path').notNull(),
    /** What the uploader called it, shown on screen and used on download. */
    fileName: text('file_name').notNull(),
    contentType: text('content_type').notNull(),
    sizeBytes: integer('size_bytes').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('feedback_attachments_ticket_idx').on(table.ticketId)],
);

/** Which side of the conversation a reply came from. */
export const FEEDBACK_AUTHOR_KINDS = ['super_admin', 'school'] as const;
export type FeedbackAuthorKind = (typeof FEEDBACK_AUTHOR_KINDS)[number];

/**
 * The conversation on a ticket.
 *
 * Append-only in practice — nothing edits or deletes a reply — because the
 * value of a reply is that it is what was said at the time. Deleting the
 * *ticket* takes its replies with it, which is the one deletion the product
 * owner asked for.
 */
export const feedbackReplies = pgTable(
  'feedback_replies',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    ticketId: uuid('ticket_id')
      .notNull()
      .references(() => feedbackTickets.id, { onDelete: 'cascade' }),
    authorKind: text('author_kind').notNull().$type<FeedbackAuthorKind>(),
    /** Set only when a member of the school replied. */
    authorSchoolUserId: uuid('author_school_user_id').references(() => schoolUsers.id, {
      onDelete: 'set null',
    }),
    /** The name to print above the message, snapshotted like the ticket's. */
    authorName: text('author_name').notNull(),
    body: text('body').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('feedback_replies_ticket_idx').on(table.ticketId, table.createdAt),
    check(
      'feedback_replies_author_kind_check',
      sql`${table.authorKind} IN ('super_admin', 'school')`,
    ),
  ],
);

export type FeedbackTicket = typeof feedbackTickets.$inferSelect;
export type NewFeedbackTicket = typeof feedbackTickets.$inferInsert;
export type FeedbackAttachment = typeof feedbackAttachments.$inferSelect;
export type FeedbackReply = typeof feedbackReplies.$inferSelect;
