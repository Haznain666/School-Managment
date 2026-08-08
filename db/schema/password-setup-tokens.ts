import { index, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

import { schoolUsers } from './school-users';
import { schools } from './schools';

/**
 * How long a setup link stays usable.
 *
 * Longer than an emergency link (15 minutes) because this one is posted to a
 * mailbox and waited on — a school administrator may not read their email
 * until tomorrow. Shorter than an invitation would traditionally be, because
 * it is not merely an invitation: it sets a password and opens a session, so
 * it is a credential sitting in an inbox and every extra day is another day it
 * can be found there. Two days is the compromise; if it lapses, the operator
 * presses "Resend sign-in email" and a fresh one is issued.
 */
export const SETUP_TOKEN_TTL_HOURS = 48;

/**
 * password_setup_tokens — single-use links that let a new member choose their
 * first password without a code.
 *
 * ── Why this exists ──────────────────────────────────────────────────────
 * Signing in for the first time used to mean: open the portal, type your
 * address, ask for a six-digit code, read a second email, type the code, then
 * choose a password. Two emails and a transcription for someone who had
 * already proved they hold the mailbox simply by opening the first one.
 *
 * The link in that first email is now the proof. Possession of the mailbox is
 * exactly what a code demonstrates, and this demonstrates the same thing with
 * one fewer step.
 *
 * ── What that costs, stated plainly ──────────────────────────────────────
 * The email becomes a credential rather than instructions. Anyone who can read
 * that mailbox — or intercept the message — can claim the account. That is the
 * same trust model as every "reset your password" link on the internet, which
 * is why it is acceptable, but it is a real change from the code flow and the
 * constraints below are what keep it narrow:
 *
 *   - 32 random bytes, single use (`used_at` is stamped in the same statement
 *     that redeems it, so two simultaneous clicks cannot both win)
 *   - two days, then dead
 *   - bound to one member at one school
 *   - **only ever issued to a member who has never signed in.** An account
 *     with a password is never resettable this way; that person must use
 *     Forgot Password and prove the mailbox with a code. Otherwise this link
 *     would be a permanent bypass of the stronger path for every established
 *     account, which is precisely backwards.
 *
 * Kept after use rather than deleted, like `emergency_login_tokens`, so that
 * issuance and redemption remain auditable.
 */
export const passwordSetupTokens = pgTable(
  'password_setup_tokens',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /** The tenant key. */
    locationId: text('location_id')
      .notNull()
      .references(() => schools.locationId, { onDelete: 'cascade' }),
    schoolUserId: uuid('school_user_id')
      .notNull()
      .references(() => schoolUsers.id, { onDelete: 'cascade' }),
    /** 32 random bytes, hex encoded. This is the credential. */
    token: text('token').notNull().unique(),
    /** Who asked for it — an operator email, for the audit trail. */
    createdBy: text('created_by').notNull().default('super_admin'),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    /** Stamped on redemption; a spent link can never be used again. */
    usedAt: timestamp('used_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('password_setup_tokens_token_idx').on(table.token),
    index('password_setup_tokens_school_user_id_idx').on(table.schoolUserId),
    index('password_setup_tokens_expires_at_idx').on(table.expiresAt),
  ],
);

export type PasswordSetupToken = typeof passwordSetupTokens.$inferSelect;
export type NewPasswordSetupToken = typeof passwordSetupTokens.$inferInsert;

/** Expiry for a newly issued setup link. */
export function setupExpiryFromNow(): Date {
  return new Date(Date.now() + SETUP_TOKEN_TTL_HOURS * 60 * 60 * 1000);
}
