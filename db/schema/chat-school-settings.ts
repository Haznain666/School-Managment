import { sql } from 'drizzle-orm';
import { boolean, check, integer, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';

import { schools } from './schools';

/**
 * chat_school_settings — the numbers a school sets once, and then argues about.
 *
 * One row per school. Every column here is a dial the product owner asked to be
 * turnable per school rather than compiled in, and each one exists because a
 * school that cannot turn it will instead ask for the module to be switched off.
 *
 * ── Why one row rather than columns on `schools` ──────────────────────────
 * `schools` is read on **every request** — `middleware.ts` resolves the tenant
 * from it and `lib/school-auth.ts` joins it into `membershipFor`. Nine chat
 * dials on that row would be nine columns carried through the hottest read in
 * the product to answer a question only the chat module ever asks. A separate
 * row is read by chat and by nothing else.
 *
 * ── An absent row means the defaults, not "off" ───────────────────────────
 * Same posture as `notification_preferences`: a school that has never opened
 * the chat settings screen behaves exactly as one that opened it and changed
 * nothing. The one exception is `student_login_min_grade_sort_order`, which is
 * null by default and null means *no student accounts at all* — see below.
 *
 * ── Minutes since midnight, not `time` ────────────────────────────────────
 * The quiet-hours columns are `integer` minutes from midnight, 0–1439, and not
 * Postgres `time`. A `time` would invite `timestamptz` arithmetic against it and
 * the whole question here is deliberately timezone-free: a school in Lahore
 * means 8pm *there*, on the wall, and the comparison is done in the school's own
 * local hour rather than in UTC. An integer cannot be accidentally compared to
 * an instant, which is the property being bought.
 */

/** How long a student may keep replying after a staff message lands. */
export const DEFAULT_REPLY_WINDOW_MINUTES = 60;

/**
 * How many messages a student may send into a thread before a human answers.
 *
 * This is the flood control, and it is a *turn-taking* rule rather than a rate
 * limit on purpose. "Twenty messages a day" still permits twenty messages in
 * twenty seconds; "three unanswered" cannot be flooded through at any speed,
 * because the fourth needs another person to act first.
 */
export const DEFAULT_MAX_UNANSWERED_FROM_STUDENT = 3;

/** How many conversations a student may have open at once. */
export const DEFAULT_MAX_OPEN_THREADS_PER_STUDENT = 3;

/** 7am and 8pm, as minutes from midnight. */
export const DEFAULT_STUDENT_CONTACT_FROM = 7 * 60;
export const DEFAULT_STUDENT_CONTACT_TO = 20 * 60;

/** How long a frozen conversation is kept before a purge sweep may take it. */
export const DEFAULT_RETENTION_MONTHS = 84;

export const chatSchoolSettings = pgTable(
  'chat_school_settings',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    locationId: text('location_id')
      .notNull()
      .references(() => schools.locationId, { onDelete: 'cascade' }),
    /**
     * The lowest `grades.sort_order` whose students get a login.
     *
     * **Null means no student accounts at all**, and null is the default. A
     * school that has not answered this question has not agreed to issue
     * credentials to minors, and provisioning them because chat was switched on
     * would be deciding that on the school's behalf.
     *
     * A sort order rather than a grade id because it is a *floor*: the answer
     * has to keep meaning the same thing after a grade is renamed, after a new
     * grade is inserted below it, and across the branches of a group that name
     * their grades differently.
     */
    studentLoginMinGradeSortOrder: integer('student_login_min_grade_sort_order'),
    replyWindowMinutes: integer('reply_window_minutes')
      .notNull()
      .default(DEFAULT_REPLY_WINDOW_MINUTES),
    maxUnansweredFromStudent: integer('max_unanswered_from_student')
      .notNull()
      .default(DEFAULT_MAX_UNANSWERED_FROM_STUDENT),
    maxOpenThreadsPerStudent: integer('max_open_threads_per_student')
      .notNull()
      .default(DEFAULT_MAX_OPEN_THREADS_PER_STUDENT),
    /**
     * The wall-clock window during which staff may message a student at all.
     *
     * Not a notification-deferral like `chat_settings.quiet_hours_*` — this one
     * **refuses the send**. A teacher messaging a fourteen-year-old at eleven at
     * night is a thing a school has to be able to say did not happen, and a
     * deferred notification would still have written the message.
     */
    studentContactFrom: integer('student_contact_from')
      .notNull()
      .default(DEFAULT_STUDENT_CONTACT_FROM),
    studentContactTo: integer('student_contact_to')
      .notNull()
      .default(DEFAULT_STUDENT_CONTACT_TO),
    /**
     * Whether an administrator may send outside the student contact window.
     *
     * Off by default. When on, the override still records a reason on the
     * message, so the exception is legible rather than invisible.
     */
    allowContactWindowOverride: boolean('allow_contact_window_override')
      .notNull()
      .default(false),
    /**
     * Where a safeguarding escalation goes. Null falls back to every active
     * `school_admin`, which is worse than a named person and better than
     * nobody.
     */
    safeguardingLeadEmail: text('safeguarding_lead_email'),
    retentionMonths: integer('retention_months').notNull().default(DEFAULT_RETENTION_MONTHS),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('chat_school_settings_location_id_idx').on(table.locationId),
    check(
      'chat_school_settings_windows_check',
      sql`${table.studentContactFrom} BETWEEN 0 AND 1439
          AND ${table.studentContactTo} BETWEEN 0 AND 1439
          AND ${table.studentContactFrom} < ${table.studentContactTo}`,
    ),
    check(
      'chat_school_settings_limits_check',
      sql`${table.replyWindowMinutes} BETWEEN 5 AND 10080
          AND ${table.maxUnansweredFromStudent} BETWEEN 1 AND 50
          AND ${table.maxOpenThreadsPerStudent} BETWEEN 1 AND 50
          AND ${table.retentionMonths} BETWEEN 1 AND 240`,
    ),
  ],
);

export type ChatSchoolSettingsRow = typeof chatSchoolSettings.$inferSelect;
export type NewChatSchoolSettingsRow = typeof chatSchoolSettings.$inferInsert;

/** The settings a school gets when it has no row. */
export const CHAT_SCHOOL_DEFAULTS = {
  studentLoginMinGradeSortOrder: null,
  replyWindowMinutes: DEFAULT_REPLY_WINDOW_MINUTES,
  maxUnansweredFromStudent: DEFAULT_MAX_UNANSWERED_FROM_STUDENT,
  maxOpenThreadsPerStudent: DEFAULT_MAX_OPEN_THREADS_PER_STUDENT,
  studentContactFrom: DEFAULT_STUDENT_CONTACT_FROM,
  studentContactTo: DEFAULT_STUDENT_CONTACT_TO,
  allowContactWindowOverride: false,
  safeguardingLeadEmail: null,
  retentionMonths: DEFAULT_RETENTION_MONTHS,
} as const;
