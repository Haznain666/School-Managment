import {
  date,
  index,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

import { announcements } from './announcements';
import { schools } from './schools';

/**
 * holiday_notifications — the claim row for the day-before notice.
 *
 * ── This table is a lock, and the lock is the point ──────────────────────
 * `instrumentation.ts` starts one scheduler per server process and production
 * runs **seven**. Every one of them wakes up the evening before Eid, finds the
 * same block of holidays, and would send the same announcement to every parent
 * at the school. Seven notices.
 *
 * CLAUDE.md's rule is *claimed, not checked*, and for an insert the shape it
 * takes is this: `INSERT … ON CONFLICT DO NOTHING RETURNING id`. Exactly one
 * process gets a row back; the other six get nothing and do nothing. There is
 * no read, no `if`, and no window between them.
 *
 * ── The unique key is (location, block_start) ────────────────────────────
 * A **block**, not a holiday: `mergeConsecutive` folds adjacent and overlapping
 * ranges into one, so 30 Oct, 31 Oct and 1 Nov are one notice rather than
 * three. The key is therefore the first day of the block, which is the one
 * thing every process computes identically from the same rows.
 *
 * `block_end` is carried for the message and for the log, not for the key.
 *
 * ── Deleted on failure, never left behind ────────────────────────────────
 * The claim is taken before the announcement is sent, so a throw has to hand it
 * back or the school believes a notice went out that nobody received. The
 * sweeper deletes the row — the same contract `releaseClaim` has in the voucher
 * sweepers, in the shape that suits an insert.
 */
export const holidayNotifications = pgTable(
  'holiday_notifications',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /** The tenant key — see STATE.md §1. */
    locationId: text('location_id')
      .notNull()
      .references(() => schools.locationId, { onDelete: 'cascade' }),
    /** First day of the merged block. Half of the claim key. */
    blockStart: date('block_start').notNull(),
    /** Last day of it, for the message. Not part of the key. */
    blockEnd: date('block_end').notNull(),
    /**
     * The announcement this became, once it was created.
     *
     * Null between claiming and sending, which is a window of milliseconds and
     * the only state in which a row here means "somebody is working on it".
     * `set null` on delete so purging an old announcement does not resurrect a
     * notice that has already gone out.
     */
    announcementId: uuid('announcement_id').references(() => announcements.id, {
      onDelete: 'set null',
    }),
    sentAt: timestamp('sent_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('holiday_notifications_location_idx').on(table.locationId),
    uniqueIndex('holiday_notifications_location_block_idx').on(
      table.locationId,
      table.blockStart,
    ),
  ],
);

export type HolidayNotification = typeof holidayNotifications.$inferSelect;
