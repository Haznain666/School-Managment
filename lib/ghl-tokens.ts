import 'server-only';

import { eq } from 'drizzle-orm';

import { ghlTokens, type GhlTokenType } from '@/db/schema';

import { decrypt, encrypt } from './crypto';
import { db } from './drizzle';

/**
 * Storage layer for GHL OAuth tokens.
 *
 * Tokens are encrypted with AES-256-GCM before they touch the database and are
 * only ever decrypted in memory, immediately before an outbound GHL call
 * (CRITICAL RULE #5). Nothing outside this module should read `ghl_tokens`.
 */

export interface GhlTokenSet {
  locationId: string;
  accessToken: string;
  refreshToken: string;
  expiresAt: Date;
  tokenType: GhlTokenType;
}

export class GhlTokenError extends Error {
  readonly locationId: string;

  constructor(locationId: string, message: string) {
    super(message);
    this.name = 'GhlTokenError';
    this.locationId = locationId;
  }
}

/** Reads and decrypts the token set for a school. Null when not connected. */
export async function readGhlTokens(locationId: string): Promise<GhlTokenSet | null> {
  const rows = await db
    .select()
    .from(ghlTokens)
    .where(eq(ghlTokens.locationId, locationId))
    .limit(1);

  const row = rows[0];
  if (row === undefined) return null;

  return {
    locationId: row.locationId,
    accessToken: decrypt(row.accessToken),
    refreshToken: decrypt(row.refreshToken),
    expiresAt: row.expiresAt,
    tokenType: row.tokenType,
  };
}

/**
 * Encrypts and upserts a token set. Used by the OAuth callback on first
 * connect and by the refresh flow thereafter.
 */
export async function writeGhlTokens(tokens: GhlTokenSet): Promise<void> {
  const encrypted = {
    locationId: tokens.locationId,
    accessToken: encrypt(tokens.accessToken),
    refreshToken: encrypt(tokens.refreshToken),
    expiresAt: tokens.expiresAt,
    tokenType: tokens.tokenType,
    updatedAt: new Date(),
  };

  await db
    .insert(ghlTokens)
    .values(encrypted)
    .onConflictDoUpdate({
      target: ghlTokens.locationId,
      set: {
        accessToken: encrypted.accessToken,
        refreshToken: encrypted.refreshToken,
        expiresAt: encrypted.expiresAt,
        tokenType: encrypted.tokenType,
        updatedAt: encrypted.updatedAt,
      },
    });
}

/** Removes a school's GHL connection (disconnect / uninstall). */
export async function deleteGhlTokens(locationId: string): Promise<void> {
  await db.delete(ghlTokens).where(eq(ghlTokens.locationId, locationId));
}
