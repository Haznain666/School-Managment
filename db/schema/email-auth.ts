import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

import { schools } from './schools';

/**
 * Email-based authentication.
 *
 * The WhatsApp flow proves possession of a handset and needs nothing at rest.
 * Email auth is the opposite: there is a long-lived secret per user, so the
 * two tables here exist to hold it safely and to bound every way it can be
 * obtained or reset.
 *
 *   user_passwords       — the credential itself, bcrypt only
 *   email_verifications  — every short-lived proof: invitation, OTP login,
 *                          forgotten password
 *
 * Firebase remains the identity provider. It does not check the password —
 * this application does, and then mints a custom token. That keeps one Firebase
 * account usable by a person who belongs to two different schools, which
 * Firebase's own globally-unique email would not allow.
 */

/** How long each kind of proof stays usable. */
export const INVITATION_EXPIRY_HOURS = 72;
export const OTP_LOGIN_EXPIRY_MINUTES = 10;
export const FORGOT_PASSWORD_EXPIRY_MINUTES = 15;

/** Wrong-OTP guesses allowed before the token is burned. */
export const EMAIL_OTP_MAX_ATTEMPTS = 5;

/** Sends allowed per email, per type, inside one window. */
export const EMAIL_OTP_MAX_SENDS = 3;
export const EMAIL_OTP_SEND_WINDOW_MINUTES = 15;

/**
 * How long a used invitation token stays acceptable as proof at
 * `/api/auth/set-password`. Verifying the OTP and choosing a password are two
 * requests; this is the gap between them, not a second login window.
 */
export const SET_PASSWORD_GRACE_MINUTES = 30;

export const EMAIL_VERIFICATION_TYPES = [
  'invitation',
  'otp_login',
  'forgot_password',
] as const;

export type EmailVerificationType = (typeof EMAIL_VERIFICATION_TYPES)[number];

/**
 * user_passwords — one bcrypt hash per person per school.
 *
 * Scoped by `location_id` rather than by email alone, because the same address
 * may belong to a teacher at one school and a parent at another; those are two
 * accounts with two passwords, and neither may open the other's portal.
 */
export const userPasswords = pgTable(
  'user_passwords',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /** GHL Location ID — the tenant key. */
    locationId: text('location_id')
      .notNull()
      .references(() => schools.locationId, { onDelete: 'cascade' }),
    /** The Firebase account this credential signs in as. */
    firebaseUid: text('firebase_uid').notNull().unique(),
    email: text('email').notNull(),
    /** bcrypt, cost 12. Never anything else, and never the password itself. */
    passwordHash: text('password_hash').notNull(),
    /** Set when an administrator issues a credential the user must replace. */
    mustChangePassword: boolean('must_change_password').notNull().default(false),
    lastPasswordChange: timestamp('last_password_change', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('user_passwords_location_id_idx').on(table.locationId),
    index('user_passwords_email_idx').on(table.email),
    uniqueIndex('user_passwords_location_id_email_idx').on(table.locationId, table.email),
  ],
);

export type UserPassword = typeof userPasswords.$inferSelect;
export type NewUserPassword = typeof userPasswords.$inferInsert;

/**
 * email_verifications — every short-lived proof sent to an inbox.
 *
 * One row per (school, email, type): a new code supersedes the old one rather
 * than living alongside it, so requesting a second code never doubles the
 * guessing surface. That is also why `send_count` and `window_started_at` are
 * here — with one row per address there is nothing to count, so the send rate
 * limit has to be carried on the row that survives.
 *
 * `token` and `otp` are different credentials for different links in the chain:
 * the token travels in an invitation URL and identifies the row; the OTP is
 * typed by the person and is what actually proves they read the mail.
 */
export const emailVerifications = pgTable(
  'email_verifications',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /** GHL Location ID — the tenant key. */
    locationId: text('location_id')
      .notNull()
      .references(() => schools.locationId, { onDelete: 'cascade' }),
    email: text('email').notNull(),
    /** 32 random bytes, hex encoded. Carried by invitation links. */
    token: text('token').notNull(),
    /** Six digits. Typed by the person, never guessable from the token. */
    otp: text('otp').notNull(),
    type: text('type').notNull().$type<EmailVerificationType>(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    /** Stamped the moment the OTP verifies; a spent proof never verifies twice. */
    usedAt: timestamp('used_at', { withTimezone: true }),
    /** Wrong guesses so far. At `EMAIL_OTP_MAX_ATTEMPTS` the row is burned. */
    attempts: integer('attempts').notNull().default(0),
    /** Sends inside the current window. See the note above. */
    sendCount: integer('send_count').notNull().default(1),
    windowStartedAt: timestamp('window_started_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('email_verifications_email_idx').on(table.email),
    index('email_verifications_token_idx').on(table.token),
    index('email_verifications_expires_at_idx').on(table.expiresAt),
    uniqueIndex('email_verifications_location_email_type_idx').on(
      table.locationId,
      table.email,
      table.type,
    ),
    check(
      'email_verifications_type_check',
      sql`type IN ('invitation', 'otp_login', 'forgot_password')`,
    ),
  ],
);

export type EmailVerification = typeof emailVerifications.$inferSelect;
export type NewEmailVerification = typeof emailVerifications.$inferInsert;
