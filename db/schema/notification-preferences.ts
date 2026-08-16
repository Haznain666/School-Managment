import {
  boolean,
  index,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

import { schoolUsers } from './school-users';
import { schools } from './schools';

/**
 * notification_preferences — what a parent has asked us to stop emailing them.
 *
 * ── An absent row means everything is on ──────────────────────────────────
 * Exactly the rule `role_permissions` follows, and for the same reason: every
 * account that exists today has no row, and the table must not change how a
 * single one of them behaves the day it is created. A preferences table that
 * had to be back-filled would silently mute whoever it missed.
 *
 * ── These govern email, and only email ────────────────────────────────────
 * The notice board is never suppressed. Sprint 11's design is that the board is
 * the delivery that always happens and email is the push on top of it; letting
 * a parent switch off the board would give the school a way to have told
 * somebody something that they had no way of seeing. Turning off "fee reminders"
 * stops the mail arriving, and the challan is still there when they log in.
 *
 * The screen says this in those words, because a preference page that appears
 * to switch off fee notices and does not is worse than no preference page.
 *
 * ── Four categories, matching what actually gets sent ─────────────────────
 * A category exists here only if something in the codebase sends mail of that
 * kind. `results` has no sender yet — report cards are collected from the
 * portal today — and is deliberately absent rather than shown as a switch that
 * governs nothing. It arrives when a sender does.
 */

/** What a school can email a parent about, as far as a parent may choose. */
export const NOTIFICATION_CATEGORIES = ['announcements', 'fees', 'attendance'] as const;
export type NotificationCategory = (typeof NOTIFICATION_CATEGORIES)[number];

export const NOTIFICATION_CATEGORY_LABELS: Record<NotificationCategory, string> = {
  announcements: 'School announcements',
  fees: 'Fee challans and reminders',
  attendance: 'Absence notices',
};

export const NOTIFICATION_CATEGORY_DESCRIPTIONS: Record<NotificationCategory, string> = {
  announcements:
    'Notices the school sends to parents. They always appear on your notice board; this only controls the email.',
  fees: 'A new challan, and reminders while one is unpaid. Your fee page always shows what is owed.',
  attendance: 'An email on a day one of your children is marked absent.',
};

export function isNotificationCategory(value: unknown): value is NotificationCategory {
  return (
    typeof value === 'string' &&
    (NOTIFICATION_CATEGORIES as readonly string[]).includes(value)
  );
}

export const notificationPreferences = pgTable(
  'notification_preferences',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /** The school's own id — the tenant key. */
    locationId: text('location_id')
      .notNull()
      .references(() => schools.locationId, { onDelete: 'cascade' }),
    /**
     * Whose preference. One row per account per school, which is why the unique
     * index is on the pair: the same person may be a parent at two schools and
     * may reasonably want mail from one and not the other.
     */
    schoolUserId: uuid('school_user_id')
      .notNull()
      .references(() => schoolUsers.id, { onDelete: 'cascade' }),
    emailAnnouncements: boolean('email_announcements').notNull().default(true),
    emailFees: boolean('email_fees').notNull().default(true),
    emailAttendance: boolean('email_attendance').notNull().default(true),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('notification_preferences_location_id_idx').on(table.locationId),
    uniqueIndex('notification_preferences_unique_idx').on(
      table.locationId,
      table.schoolUserId,
    ),
  ],
);

export type NotificationPreference = typeof notificationPreferences.$inferSelect;
export type NewNotificationPreference = typeof notificationPreferences.$inferInsert;
