import { sql } from 'drizzle-orm';
import { check, index, integer, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

import { chatMessages } from './chat-messages';
import { schools } from './schools';

/**
 * chat_attachments — a file on a message, and only ever from a member of staff.
 *
 * ── Staff only, and that is what makes this sprint's scope honest ────────
 * Sprint 24 shipped text-only because images from pupils were the first abuse
 * named in the brief. Nothing about that judgement has changed; what changed is
 * *who may upload*. Every uploader here is a member of staff — a known adult
 * with an employment record, accountable to the school, whose account an
 * administrator can deactivate.
 *
 * That is the entire reason there is no NSFW scanner in this table's story. The
 * control is not a classifier, it is the identity of the uploader, and it is
 * enforced server-side rather than by hiding a button: a pupil or parent
 * posting to the upload route is refused.
 *
 * Pupil and parent attachments remain out of scope. Adding them means a
 * quarantine bucket, a scanner, EXIF stripping and a decision about what a
 * positive hit obliges the school to do — a sprint, not a column.
 *
 * ── Two megabytes ────────────────────────────────────────────────────────
 * The product owner's number. Large enough for a photographed worksheet or a
 * one-page PDF, small enough that a parent on a phone in Lahore is not paying
 * for somebody's uncompressed camera roll. `student_documents` allows 5 MB and
 * `feedback` 10 MB; this is smaller than both on purpose, because a chat
 * attachment is a convenience rather than a record.
 *
 * ── Served through a proxy, never a public URL ───────────────────────────
 * `storage_path` and no `download_url`, which is `feedback_attachments`' shape
 * rather than `student_documents`'. The difference is load-bearing:
 * `attachmentResponse` sets `Content-Disposition: attachment` and
 * `X-Content-Type-Options: nosniff`, and `lib/attachment-response.ts` explains
 * that `inline` on a PDF would let an attachment execute on the portal's own
 * origin. A file somebody sent a fourteen-year-old is also not a thing to put
 * behind a guessable public URL on a CDN with a year-long `s-maxage`.
 *
 * ── The type is sniffed, not believed ───────────────────────────────────
 * `content_type` holds what the *bytes* said via `sniffImageType`, not what the
 * browser claimed, exactly as `student_documents` does. A `.png` that is really
 * something else is stored as what it really is, or refused.
 */

/** The cap, stated once. Enforced in the route and shown in the composer. */
export const MAX_CHAT_ATTACHMENT_BYTES = 2 * 1024 * 1024;

/** What a member of staff may send. The `lib/feedback.ts` list. */
export const CHAT_ATTACHMENT_MIME_TYPES = [
  'image/png',
  'image/jpeg',
  'application/pdf',
] as const;
export type ChatAttachmentMimeType = (typeof CHAT_ATTACHMENT_MIME_TYPES)[number];

/** For the file input's `accept`. */
export const CHAT_ATTACHMENT_ACCEPT = CHAT_ATTACHMENT_MIME_TYPES.join(',');

export function isChatAttachmentMimeType(value: unknown): value is ChatAttachmentMimeType {
  return (
    typeof value === 'string' &&
    (CHAT_ATTACHMENT_MIME_TYPES as readonly string[]).includes(value)
  );
}

const mimeList = CHAT_ATTACHMENT_MIME_TYPES.map((type) => `'${type}'`).join(', ');

export const chatAttachments = pgTable(
  'chat_attachments',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    locationId: text('location_id')
      .notNull()
      .references(() => schools.locationId, { onDelete: 'cascade' }),
    /**
     * Cascades. An attachment without its message is an orphan object nobody
     * can reach — and a redaction does *not* delete the message, so this only
     * fires when a conversation is genuinely removed.
     */
    messageId: uuid('message_id')
      .notNull()
      .references(() => chatMessages.id, { onDelete: 'cascade' }),
    /** The object key. **Never a URL** — see the docblock. */
    storagePath: text('storage_path').notNull(),
    /** What the sender called it, for the download filename. */
    fileName: text('file_name').notNull(),
    /** Sniffed from the bytes, not taken from the request. */
    contentType: text('content_type').notNull(),
    sizeBytes: integer('size_bytes').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('chat_attachments_location_id_idx').on(table.locationId),
    // One per message today; indexed rather than unique so a future change to
    // that rule is a code change and not a migration.
    index('chat_attachments_message_idx').on(table.messageId),
    check('chat_attachments_content_type_check', sql.raw(`content_type IN (${mimeList})`)),
    check(
      'chat_attachments_size_check',
      sql`${table.sizeBytes} > 0 AND ${table.sizeBytes} <= ${sql.raw(String(MAX_CHAT_ATTACHMENT_BYTES))}`,
    ),
    check(
      'chat_attachments_file_name_check',
      sql`length(${table.fileName}) BETWEEN 1 AND 200`,
    ),
  ],
);

export type ChatAttachment = typeof chatAttachments.$inferSelect;
export type NewChatAttachment = typeof chatAttachments.$inferInsert;
