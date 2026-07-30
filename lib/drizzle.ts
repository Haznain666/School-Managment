import { drizzle, type NeonHttpDatabase } from 'drizzle-orm/neon-http';

import * as schema from '@/db/schema';

import { getSql } from './neon';

/**
 * The single Drizzle instance for the whole application (CRITICAL RULE #6).
 *
 * TENANCY: this client has no implicit tenant filter. Every query you write
 * MUST include `eq(table.locationId, locationId)` where `locationId` came from
 * `withAuth()` — i.e. from verified JWT claims, never from user input
 * (CRITICAL RULES #3 and #4).
 */
export type Database = NeonHttpDatabase<typeof schema>;

let cachedDb: Database | null = null;

export function getDb(): Database {
  if (cachedDb === null) {
    cachedDb = drizzle(getSql(), { schema });
  }
  return cachedDb;
}

/**
 * Convenience proxy so call sites can write `db.select()...` directly while the
 * underlying connection is still created lazily on first use.
 */
export const db: Database = new Proxy({} as Database, {
  get(_target, property, receiver) {
    return Reflect.get(getDb(), property, receiver) as unknown;
  },
});

export { schema };
