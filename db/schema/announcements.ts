import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

import { branches } from './branches';
import { emailOutbox } from './email-outbox';
import { schoolUsers } from './school-users';
import { schools } from './schools';

/**
 * announcements + announcement_recipients + announcement_reads — one message a
 * school sends to some of the people in it, who it reached, and who has read it.
 *
 * Three tables in one file because they are one concept: an announcement with
 * no delivery log cannot answer "did the parents get this", and a read marker
 * belongs to nothing else.
 *
 * ── The default delivery path is ours ────────────────────────────────────
 * The original plan built this entirely on GoHighLevel Conversations. GHL is
 * now opt-in per school (`STATE.md`), so the notice board on the four portals
 * is the delivery that always happens, and email over `email_outbox` is the
 * push that happens when the sender asks for it. Those are the only two
 * channels: WhatsApp was removed from the platform on 2026-08-22. A school
 * that has connected nothing still gets working announcements.
 *
 * ── Why the audience is jsonb and not three nullable columns ─────────────
 * "Everyone", "Class 5 and Class 6", "all teachers" and "section 5-A" are one
 * question with four shapes. Three nullable id columns would make every
 * combination representable, including the ones that mean nothing — a row with
 * a grade *and* a role set has no agreed reading, and every query would have to
 * invent one. One tagged object has exactly the states the sender can choose,
 * and `lib/announcement-audience.ts` is the single place that turns it into
 * people.
 */

/** How a school picks who an announcement is for. */
export const AUDIENCE_KINDS = ['all', 'roles', 'grades', 'sections'] as const;
export type AudienceKind = (typeof AUDIENCE_KINDS)[number];

/**
 * The stored audience.
 *
 * `all` carries no ids on purpose: an "everyone" that listed every id would go
 * stale the moment a child enrolled, and an announcement addressed to the whole
 * school must include the family who joined yesterday.
 */
export type AnnouncementAudience =
  | { kind: 'all' }
  | { kind: 'roles'; roles: string[] }
  | { kind: 'grades'; gradeIds: string[] }
  | { kind: 'sections'; sectionIds: string[] };

/**
 * draft     — being written. Nobody but the author's colleagues can see it.
 * scheduled — finished, with a time. Not visible to its audience yet.
 * sent      — on the notice board, and the email run has been queued.
 *
 * `scheduled` is a real state rather than "a draft with a date": a school
 * writes the fee-deadline notice on Monday to appear on Friday, and a draft
 * that appeared the moment somebody set a date would be the opposite of that.
 */
export const ANNOUNCEMENT_STATUSES = ['draft', 'scheduled', 'sent'] as const;
export type AnnouncementStatus = (typeof ANNOUNCEMENT_STATUSES)[number];

export const ANNOUNCEMENT_STATUS_LABELS: Record<AnnouncementStatus, string> = {
  draft: 'Draft',
  scheduled: 'Scheduled',
  sent: 'Sent',
};

export const announcements = pgTable(
  'announcements',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /** The school's own id — the tenant key. */
    locationId: text('location_id')
      .notNull()
      .references(() => schools.locationId, { onDelete: 'cascade' }),
    /**
     * The campus this is for. Null = every campus.
     *
     * Kept separate from the audience rather than folded into it because it
     * narrows any audience: "all parents" at one branch is a real thing to
     * send, and expressing it inside the audience object would need a product
     * of every kind with every branch.
     */
    branchId: uuid('branch_id').references(() => branches.id, { onDelete: 'cascade' }),
    title: text('title').notNull(),
    body: text('body').notNull(),
    audience: jsonb('audience').notNull().$type<AnnouncementAudience>(),
    status: text('status').notNull().default('draft').$type<AnnouncementStatus>(),
    /**
     * Whether this also goes out as email.
     *
     * A flag on the announcement, not a separate campaign entity: a school
     * writing a notice decides at that moment whether it is worth an email, and
     * a second object would let the notice and the email drift apart in wording
     * — which is exactly the complaint email campaigns generate.
     */
    sendEmail: boolean('send_email').notNull().default(false),
    /** When it should appear. Null on a draft. */
    scheduledAt: timestamp('scheduled_at', { withTimezone: true }),
    /** When it actually appeared. Null until then. */
    sentAt: timestamp('sent_at', { withTimezone: true }),
    /** Who wrote it. Null when their account has since been removed. */
    createdBy: uuid('created_by').references(() => schoolUsers.id, {
      onDelete: 'set null',
    }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('announcements_location_id_idx').on(table.locationId),
    // The notice board's own read: this school, sent, newest first.
    index('announcements_location_id_status_sent_idx').on(
      table.locationId,
      table.status,
      table.sentAt,
    ),
    index('announcements_location_id_branch_idx').on(table.locationId, table.branchId),
    check(
      'announcements_status_check',
      sql`${table.status} IN ('draft', 'scheduled', 'sent')`,
    ),
    // A sent announcement has a time it was sent. Without this the notice board
    // would have to decide what to show for a row that claims both.
    check(
      'announcements_sent_at_check',
      sql`(${table.status} = 'sent') = (${table.sentAt} IS NOT NULL)`,
    ),
    check(
      'announcements_scheduled_at_check',
      sql`${table.status} <> 'scheduled' OR ${table.scheduledAt} IS NOT NULL`,
    ),
  ],
);

/** The ways an announcement can reach somebody. */
export const DELIVERY_CHANNELS = ['notice', 'email'] as const;
export type DeliveryChannel = (typeof DELIVERY_CHANNELS)[number];

/**
 * queued      — accepted for delivery, not yet gone.
 * sent        — handed to the channel. For email that means SMTP accepted it.
 * failed      — the channel tried and could not.
 * unreachable — never attempted, because there was nothing to attempt with.
 *
 * `unreachable` is separate from `failed` because they are different problems
 * with different owners: a failure is the platform's to retry, and a parent
 * with no email address is the school's to fix. Collapsing them would bury the
 * one number an office can act on inside one it cannot.
 */
export const DELIVERY_STATUSES = ['queued', 'sent', 'failed', 'unreachable'] as const;
export type DeliveryStatus = (typeof DELIVERY_STATUSES)[number];

export const DELIVERY_STATUS_LABELS: Record<DeliveryStatus, string> = {
  queued: 'Queued',
  sent: 'Sent',
  failed: 'Failed',
  unreachable: 'No address',
};

/**
 * announcement_recipients — who one announcement was delivered to, per channel.
 *
 * Written once when the announcement is sent, and it is the *resolved*
 * audience: the people who were in it at that moment. Recomputing the audience
 * later to answer "who got this" would give a different and wrong answer as
 * soon as a student changed section, and "who did we tell" is precisely the
 * question asked after something goes wrong.
 *
 * The notice channel is recorded too, even though a notice cannot fail. It is
 * what makes the delivery log answer "how many people can see this" for a
 * school that sends no email at all, rather than showing an empty report.
 */
export const announcementRecipients = pgTable(
  'announcement_recipients',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /** The school's own id — the tenant key. */
    locationId: text('location_id')
      .notNull()
      .references(() => schools.locationId, { onDelete: 'cascade' }),
    announcementId: uuid('announcement_id')
      .notNull()
      .references(() => announcements.id, { onDelete: 'cascade' }),
    schoolUserId: uuid('school_user_id')
      .notNull()
      .references(() => schoolUsers.id, { onDelete: 'cascade' }),
    channel: text('channel').notNull().$type<DeliveryChannel>(),
    status: text('status').notNull().default('queued').$type<DeliveryStatus>(),
    /** Why it is unreachable or failed, in words an office can act on. */
    detail: text('detail'),
    /**
     * The queued message, for the email channel.
     *
     * `set null` rather than cascade: the outbox is drained and pruned, and a
     * delivery log that deleted itself when the queue was tidied would lose the
     * record of the send. The log outlives the message.
     */
    outboxId: uuid('outbox_id').references(() => emailOutbox.id, {
      onDelete: 'set null',
    }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('announcement_recipients_location_id_idx').on(table.locationId),
    index('announcement_recipients_announcement_id_idx').on(table.announcementId),
    index('announcement_recipients_location_user_idx').on(
      table.locationId,
      table.schoolUserId,
    ),
    // One row per person per channel. This is what makes a re-send an upsert
    // rather than a second set of rows claiming the same delivery twice.
    uniqueIndex('announcement_recipients_unique_idx').on(
      table.announcementId,
      table.schoolUserId,
      table.channel,
    ),
    check(
      'announcement_recipients_channel_check',
      sql`${table.channel} IN ('notice', 'email')`,
    ),
    check(
      'announcement_recipients_status_check',
      sql`${table.status} IN ('queued', 'sent', 'failed', 'unreachable')`,
    ),
  ],
);

/**
 * announcement_reads — who has opened what.
 *
 * A row per person per announcement, written the first time they see it. The
 * unread badge is the count of sent announcements addressed to them with no row
 * here, which is why this table stores reads rather than a per-user counter: a
 * counter cannot answer "which ones", and the one thing somebody does with an
 * unread badge is go and find them.
 */
export const announcementReads = pgTable(
  'announcement_reads',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /** The school's own id — the tenant key. */
    locationId: text('location_id')
      .notNull()
      .references(() => schools.locationId, { onDelete: 'cascade' }),
    announcementId: uuid('announcement_id')
      .notNull()
      .references(() => announcements.id, { onDelete: 'cascade' }),
    schoolUserId: uuid('school_user_id')
      .notNull()
      .references(() => schoolUsers.id, { onDelete: 'cascade' }),
    readAt: timestamp('read_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('announcement_reads_location_user_idx').on(table.locationId, table.schoolUserId),
    uniqueIndex('announcement_reads_unique_idx').on(
      table.announcementId,
      table.schoolUserId,
    ),
  ],
);

export type Announcement = typeof announcements.$inferSelect;
export type NewAnnouncement = typeof announcements.$inferInsert;
export type AnnouncementRecipient = typeof announcementRecipients.$inferSelect;
export type NewAnnouncementRecipient = typeof announcementRecipients.$inferInsert;
export type AnnouncementRead = typeof announcementReads.$inferSelect;
export type NewAnnouncementRead = typeof announcementReads.$inferInsert;

export function isAudienceKind(value: unknown): value is AudienceKind {
  return typeof value === 'string' && (AUDIENCE_KINDS as readonly string[]).includes(value);
}

export function isAnnouncementStatus(value: unknown): value is AnnouncementStatus {
  return (
    typeof value === 'string' &&
    (ANNOUNCEMENT_STATUSES as readonly string[]).includes(value)
  );
}
