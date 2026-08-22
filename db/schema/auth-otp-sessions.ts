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

import { schools } from './schools';

export const OTP_PURPOSES = ['login', 'invite_acceptance'] as const;
export type OtpPurpose = (typeof OTP_PURPOSES)[number];

/**
 * auth_otp_sessions — one-time passcodes, emailed.
 *
 * The passcode itself is never stored: only a bcrypt hash, exactly as a
 * password would be. A leaked database therefore does not hand over live
 * codes.
 *
 * Three things bound the attack surface: a short expiry, an attempt counter
 * that locks the session after a few wrong guesses, and single use — `used_at`
 * is stamped the moment a code verifies, so the same code cannot be replayed.
 */
export const authOtpSessions = pgTable(
  'auth_otp_sessions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /** GHL Location ID — the tenant key. */
    locationId: text('location_id')
      .notNull()
      .references(() => schools.locationId, { onDelete: 'cascade' }),
    /** E.164, normalised by `lib/phone.ts` before it reaches here. */
    phone: text('phone').notNull(),
    /** bcrypt hash of the six-digit code. Never the code itself. */
    otpHash: text('otp_hash').notNull(),
    purpose: text('purpose').notNull().$type<OtpPurpose>(),
    /** Set only for invite acceptance, binding the code to one invitation. */
    inviteToken: text('invite_token'),
    attempts: integer('attempts').notNull().default(0),
    maxAttempts: integer('max_attempts').notNull().default(3),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    /** Stamped on success; a used code can never verify again. */
    usedAt: timestamp('used_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('auth_otp_sessions_location_id_idx').on(table.locationId),
    // Partial index: lookups only ever search for a code still in play, so
    // spent rows are kept out of the index entirely.
    index('auth_otp_sessions_lookup_idx')
      .on(table.locationId, table.phone, table.purpose)
      .where(sql`used_at IS NULL`),
    index('auth_otp_sessions_expires_at_idx').on(table.expiresAt),
    check(
      'auth_otp_sessions_purpose_check',
      sql`purpose IN ('login', 'invite_acceptance')`,
    ),
  ],
);

export type AuthOtpSession = typeof authOtpSessions.$inferSelect;
export type NewAuthOtpSession = typeof authOtpSessions.$inferInsert;
