import { sql } from 'drizzle-orm';
import { boolean, check, index, integer, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';

import { schoolUsers } from './school-users';
import { schools } from './schools';

/**
 * chat_settings — one person's own chat preferences.
 *
 * Two facts, and they are here rather than on `school_users` for the reason
 * given in `chat_school_settings`: that row is read on every request and these
 * are read by chat alone.
 *
 * ── `students_may_initiate` is per teacher, and that is the whole point ───
 * `ROADMAP.md` §5 settled this on 2026-08-07 and the wording is worth keeping:
 * *"one teacher opting in must not opt in the rest."* A school-wide switch is
 * the wrong shape, because the teacher who is happy to take questions from her
 * O-Level class at 9pm and the teacher who is not are both right about their own
 * inbox.
 *
 * It is a **necessary** condition and not a sufficient one. A student may open a
 * thread only when this is true *and* a live `chat_grants` allow covers them.
 * The teacher decides whether she is reachable at all; the school decides when.
 * Either one alone is a "no".
 *
 * ── Quiet hours defer the notification, they do not refuse the message ────
 * A parent writing at 11pm should not ring a teacher's phone, and should also
 * not be told the school is closed — the message lands, the digest carries it in
 * the morning. That is the opposite of `chat_school_settings.student_contact_*`,
 * which refuses the send outright. The difference is who is being protected: an
 * adult from being disturbed, or a child from being contacted.
 *
 * Null on both means no quiet hours. They are integer minutes from midnight for
 * the same timezone-free reason `chat_school_settings` gives.
 */
export const chatSettings = pgTable(
  'chat_settings',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    locationId: text('location_id')
      .notNull()
      .references(() => schools.locationId, { onDelete: 'cascade' }),
    schoolUserId: uuid('school_user_id')
      .notNull()
      .references(() => schoolUsers.id, { onDelete: 'cascade' }),
    /** May a student open a thread with this person? Default off, always. */
    studentsMayInitiate: boolean('students_may_initiate').notNull().default(false),
    /** Minutes from midnight. Null on either = no quiet hours. */
    quietHoursFrom: integer('quiet_hours_from'),
    quietHoursTo: integer('quiet_hours_to'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('chat_settings_location_id_idx').on(table.locationId),
    uniqueIndex('chat_settings_location_user_idx').on(table.locationId, table.schoolUserId),
    check(
      'chat_settings_quiet_hours_check',
      sql`(${table.quietHoursFrom} IS NULL) = (${table.quietHoursTo} IS NULL)
          AND (${table.quietHoursFrom} IS NULL
               OR (${table.quietHoursFrom} BETWEEN 0 AND 1439
                   AND ${table.quietHoursTo} BETWEEN 0 AND 1439))`,
    ),
  ],
);

export type ChatSettingsRow = typeof chatSettings.$inferSelect;
export type NewChatSettingsRow = typeof chatSettings.$inferInsert;
