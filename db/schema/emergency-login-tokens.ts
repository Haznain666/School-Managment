import { index, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

import { schoolUsers } from './school-users';
import { schools } from './schools';

/** How long an emergency link stays usable. Deliberately short. */
export const EMERGENCY_TOKEN_TTL_MINUTES = 15;

/**
 * emergency_login_tokens — platform-issued, single-use sign-in links.
 *
 * The last line of defence: if email has failed for a
 * school, a platform administrator can hand one user a link that signs them in
 * as themselves. It bypasses passcode delivery entirely, so it is deliberately
 * the most constrained credential in the system — fifteen minutes, one use,
 * bound to one user at one school, and recorded rather than deleted so the
 * issuance is auditable.
 */
export const emergencyLoginTokens = pgTable(
  'emergency_login_tokens',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /** GHL Location ID — the tenant key. */
    locationId: text('location_id')
      .notNull()
      .references(() => schools.locationId, { onDelete: 'cascade' }),
    schoolUserId: uuid('school_user_id')
      .notNull()
      .references(() => schoolUsers.id, { onDelete: 'cascade' }),
    /**
     * Captured at issue time; the account this link signs in as.
     *
     * Nullable since Stage 4: an emergency link may be issued for a member who
     * has not accepted their invitation yet and therefore has no auth account.
     * Redemption resolves the address to one at that point.
     */
    authUserId: text('auth_user_id'),
    /** 32 random bytes, hex encoded. This is the credential. */
    token: text('token').notNull().unique(),
    createdBy: text('created_by').notNull().default('super_admin'),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    /** Stamped on first use; a spent link can never sign anyone in again. */
    usedAt: timestamp('used_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('emergency_login_tokens_token_idx').on(table.token),
    index('emergency_login_tokens_location_id_idx').on(table.locationId),
    index('emergency_login_tokens_expires_at_idx').on(table.expiresAt),
  ],
);

export type EmergencyLoginToken = typeof emergencyLoginTokens.$inferSelect;
export type NewEmergencyLoginToken = typeof emergencyLoginTokens.$inferInsert;

/** Expiry for a newly issued emergency link. */
export function emergencyExpiryFromNow(): Date {
  return new Date(Date.now() + EMERGENCY_TOKEN_TTL_MINUTES * 60 * 1000);
}
