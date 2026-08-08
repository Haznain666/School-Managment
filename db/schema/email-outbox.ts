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

/**
 * email_outbox — outbound mail, queued rather than sent inside the request.
 *
 * ── Why this exists ──────────────────────────────────────────────────────
 * `STATE.md` §5k measured `sendMail` against `smtp.titan.email` at ~103
 * seconds. Every send in this application sat inside a request someone was
 * watching, so "send the invitation" was a two-minute spinner that an operator
 * reasonably reads as a broken feature — and the `socketTimeout` in
 * `lib/email-sender.ts` never fires, because the socket is never idle, it is
 * just slow. Sprint 11's bulk campaigns cannot run inside a request at all, at
 * any speed.
 *
 * So the request writes a row and returns. `lib/email-outbox.ts` drains it.
 *
 * ── What that costs, stated plainly ──────────────────────────────────────
 * The screens that send mail used to report actual delivery: "sent" meant an
 * SMTP server had accepted the message. They can no longer know that at the
 * moment they answer, and their copy has been changed to say "queued" instead.
 * A screen that says "Sent" when it means "queued" is a worse lie than the
 * spinner this replaced.
 *
 * ── Why `location_id` is nullable here ───────────────────────────────────
 * It is the tenant key everywhere else and it is not null anywhere else. But
 * this queue also carries *platform* mail — the Super Admin's "Send sign-in
 * email", which is sent by the operator of the platform about a member of a
 * school, and which must still be sendable while a school is being set up. A
 * synthetic tenant value would be a lie in a column every tenancy filter
 * trusts. Null means "platform", and it is indexed only incidentally: nothing
 * reads this table per tenant. The drainer reads it by status.
 */

export const EMAIL_OUTBOX_STATUSES = ['queued', 'sending', 'sent', 'failed'] as const;
export type EmailOutboxStatus = (typeof EMAIL_OUTBOX_STATUSES)[number];

/** Attempts after which a message is abandoned as `failed`. */
export const EMAIL_MAX_ATTEMPTS = 5;

export const emailOutbox = pgTable(
  'email_outbox',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /** The tenant key, or null for platform mail. See the docblock. */
    locationId: text('location_id'),
    toAddress: text('to_address').notNull(),
    subject: text('subject').notNull(),
    /**
     * Plain text only, because `sendEmail` sends plain text only. When HTML
     * mail arrives it gets its own column rather than a format flag on this
     * one — a body whose meaning depends on a sibling column is how a queue
     * ends up sending markup to someone's phone.
     */
    bodyText: text('body_text').notNull(),
    status: text('status').notNull().default('queued').$type<EmailOutboxStatus>(),
    attempts: integer('attempts').notNull().default(0),
    /** The last transport error, kept so an operator can see *why*. */
    lastError: text('last_error'),
    /**
     * Not before this time. Set to now on enqueue, and pushed forward by the
     * backoff after a failure, so retry scheduling needs no second column.
     */
    scheduledAt: timestamp('scheduled_at', { withTimezone: true }).notNull().defaultNow(),
    sentAt: timestamp('sent_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    // The drainer's only query: the oldest due rows in one status.
    index('email_outbox_status_scheduled_idx').on(table.status, table.scheduledAt),
    check(
      'email_outbox_status_check',
      sql`status IN ('queued', 'sending', 'sent', 'failed')`,
    ),
  ],
);

export type EmailOutboxRow = typeof emailOutbox.$inferSelect;
export type NewEmailOutboxRow = typeof emailOutbox.$inferInsert;
