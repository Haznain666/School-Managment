import { index, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';

import { schools } from './schools';

/** Sixty seconds: one redirect, and nothing left worth stealing. */
export const LOGIN_HANDOFF_TTL_SECONDS = 60;

/**
 * login_handoff_tokens — the apex sign-in handing a person to their school.
 * Sprint 35, §7.
 *
 * ── Why a row, when the Super Admin hand-off is a signed JWT ─────────────
 * `lib/platform-school-access.ts` signs a two-minute token and says in its own
 * docblock why it is *not* single-use: that would need a row per hand-off. This
 * one must be. The operator's hand-off opens a school as a synthetic
 * platform account the operator already controls; this one opens it **as a
 * real person** — a parent, a teacher, a pupil — and a URL that can be replayed
 * for two minutes out of a proxy log or a shared screen is a URL that signs
 * somebody else in as them. So: a row, consumed by a conditional `UPDATE …
 * WHERE used_at IS NULL RETURNING` (CLAUDE.md, "claimed, not checked"), and
 * the same shape `emergency_login_tokens` has used since Stage 4.
 *
 * ── Only the hash is stored ──────────────────────────────────────────────
 * The token travels in a URL; the table holds `sha256(token)`. A leaked backup
 * of this table therefore holds nothing that can be redeemed, even inside the
 * sixty seconds.
 *
 * ── `location_id` is the school it opens ─────────────────────────────────
 * Checked at redemption against the school the request actually arrived at, so
 * a token minted for School A and replayed at School B's address is refused —
 * exactly the check the operator hand-off makes.
 */
export const loginHandoffTokens = pgTable(
  'login_handoff_tokens',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    locationId: text('location_id')
      .notNull()
      .references(() => schools.locationId, { onDelete: 'cascade' }),
    /** sha256 hex of the token. The token itself is never stored. */
    tokenHash: text('token_hash').notNull(),
    /** The Supabase account this signs in as. */
    authUserId: text('auth_user_id').notNull(),
    /** The account's address, which `mintSessionForEmail` needs. */
    email: text('email').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    usedAt: timestamp('used_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('login_handoff_tokens_token_hash_idx').on(table.tokenHash),
    index('login_handoff_tokens_location_id_idx').on(table.locationId),
    index('login_handoff_tokens_expires_at_idx').on(table.expiresAt),
  ],
);

export type LoginHandoffToken = typeof loginHandoffTokens.$inferSelect;
