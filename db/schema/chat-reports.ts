import { sql } from 'drizzle-orm';
import { check, index, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

import { chatConversations } from './chat-conversations';
import { chatMessages } from './chat-messages';
import { schoolUsers } from './school-users';
import { schools } from './schools';

/**
 * chat_reports — one tap, and a person who has to answer it.
 *
 * ── Two arrival routes, one queue ─────────────────────────────────────────
 * A report is written either by a human pressing Report on a message, or by the
 * safeguarding scan matching one. `source` says which, and they share a queue
 * because the moderator's job is identical: read it, decide, record why.
 *
 * ── Not every report waits ────────────────────────────────────────────────
 * A report whose `severity` is `safeguarding` is emailed to the school's
 * designated lead **the moment it is written**, before anybody opens a queue.
 * A pupil writing something about self-harm at two in the morning is the most
 * important message this system will ever carry, and a queue that is read on
 * Monday is the wrong place for it. Everything else waits.
 *
 * ── Resolution is a sentence, not a status ────────────────────────────────
 * `resolution_note` is required to leave `open`. "Dismissed" with no reason is
 * the outcome that makes a reporter stop reporting, and this is the same
 * argument the fee module makes about override reasons: what the school decided
 * and why is a first-class output, not an audit footnote.
 */

export const REPORT_SOURCES = ['user', 'scan'] as const;
export type ReportSource = (typeof REPORT_SOURCES)[number];

/**
 * `safeguarding` escalates immediately by email and is what the keyword scan
 * raises. `abuse` and `spam` go to the queue.
 */
export const REPORT_SEVERITIES = ['safeguarding', 'abuse', 'spam'] as const;
export type ReportSeverity = (typeof REPORT_SEVERITIES)[number];

export const REPORT_STATUSES = ['open', 'reviewed', 'actioned', 'dismissed'] as const;
export type ReportStatus = (typeof REPORT_STATUSES)[number];

export const REPORT_REASON_MAX = 500;

const sourceList = REPORT_SOURCES.map((source) => `'${source}'`).join(', ');
const severityList = REPORT_SEVERITIES.map((severity) => `'${severity}'`).join(', ');
const statusList = REPORT_STATUSES.map((status) => `'${status}'`).join(', ');

export const chatReports = pgTable(
  'chat_reports',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    locationId: text('location_id')
      .notNull()
      .references(() => schools.locationId, { onDelete: 'cascade' }),
    messageId: uuid('message_id')
      .notNull()
      .references(() => chatMessages.id, { onDelete: 'cascade' }),
    conversationId: uuid('conversation_id')
      .notNull()
      .references(() => chatConversations.id, { onDelete: 'cascade' }),
    /** Null for a scan. */
    reportedBy: uuid('reported_by').references(() => schoolUsers.id, { onDelete: 'set null' }),
    source: text('source').notNull().default('user'),
    severity: text('severity').notNull().default('abuse'),
    reason: text('reason').notNull(),
    status: text('status').notNull().default('open'),
    /** Set when the safeguarding email was queued, so a restart cannot send twice. */
    escalatedAt: timestamp('escalated_at', { withTimezone: true }),
    reviewedBy: uuid('reviewed_by').references(() => schoolUsers.id, { onDelete: 'set null' }),
    reviewedAt: timestamp('reviewed_at', { withTimezone: true }),
    resolutionNote: text('resolution_note'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('chat_reports_location_id_idx').on(table.locationId),
    // The moderation queue: this school, still open, oldest first.
    index('chat_reports_location_status_idx').on(table.locationId, table.status, table.createdAt),
    // The escalation sweep's claim predicate.
    index('chat_reports_escalation_idx').on(table.severity, table.escalatedAt),
    index('chat_reports_message_idx').on(table.messageId),
    check('chat_reports_source_check', sql.raw(`source IN (${sourceList})`)),
    check('chat_reports_severity_check', sql.raw(`severity IN (${severityList})`)),
    check('chat_reports_status_check', sql.raw(`status IN (${statusList})`)),
    check(
      'chat_reports_reason_check',
      sql`length(${table.reason}) BETWEEN 1 AND ${sql.raw(String(REPORT_REASON_MAX))}`,
    ),
    // Leaving `open` requires a reviewer, a time and a sentence.
    check(
      'chat_reports_resolution_check',
      sql`${table.status} = 'open'
          OR (${table.reviewedAt} IS NOT NULL AND ${table.resolutionNote} IS NOT NULL)`,
    ),
    // A scan has no reporter; a human report does.
    check(
      'chat_reports_source_reporter_check',
      sql`(${table.source} = 'scan') = (${table.reportedBy} IS NULL)`,
    ),
  ],
);

export type ChatReport = typeof chatReports.$inferSelect;
export type NewChatReport = typeof chatReports.$inferInsert;
