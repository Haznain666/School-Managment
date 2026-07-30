import { index, pgTable, text, timestamp } from 'drizzle-orm/pg-core';

import { schoolSubdomains } from './school-subdomains';

export const GHL_TOKEN_TYPES = ['location', 'company'] as const;
export type GhlTokenType = (typeof GHL_TOKEN_TYPES)[number];

/**
 * ghl_tokens — one GHL OAuth token set per school (per Location ID).
 *
 * SECURITY: `access_token` and `refresh_token` are stored ENCRYPTED
 * (AES-256-GCM, see `lib/crypto.ts`). Never write a plaintext token here —
 * always go through `lib/ghl-tokens.ts`.
 */
export const ghlTokens = pgTable(
  'ghl_tokens',
  {
    locationId: text('location_id')
      .primaryKey()
      .references(() => schoolSubdomains.locationId, { onDelete: 'cascade' }),
    /** AES-256-GCM ciphertext — NOT the raw token. */
    accessToken: text('access_token').notNull(),
    /** AES-256-GCM ciphertext — NOT the raw token. */
    refreshToken: text('refresh_token').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    tokenType: text('token_type').notNull().default('location').$type<GhlTokenType>(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index('ghl_tokens_location_id_idx').on(table.locationId),
    // Background refresh job scans for tokens nearing expiry.
    index('ghl_tokens_expires_at_idx').on(table.expiresAt),
  ],
);

export type GhlTokenRow = typeof ghlTokens.$inferSelect;
export type NewGhlTokenRow = typeof ghlTokens.$inferInsert;
