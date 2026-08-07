import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';

import * as schema from '@/db/schema';

import { getSql } from './postgres';

/**
 * The single Drizzle instance for the whole application (CRITICAL RULE #6).
 *
 * TENANCY: this client has no implicit tenant filter. Every query you write
 * MUST include `eq(table.locationId, locationId)` where `locationId` came from
 * `withSchoolAuth()` — i.e. from verified session claims, never from user input
 * (CRITICAL RULES #3 and #4).
 *
 * NODE ONLY. The underlying driver opens a TCP socket, so this cannot be
 * imported from `middleware.ts` or any other Edge-runtime module. See
 * `lib/school-lookup-edge.ts` for the Edge-safe path.
 */
export type Database = PostgresJsDatabase<typeof schema>;

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

/** The transaction handle Drizzle hands to a `db.transaction()` callback. */
export type Tx = Parameters<Parameters<Database['transaction']>[0]>[0];

/**
 * Runs several statements in one transaction and returns their results in
 * order.
 *
 * ── Why this exists ──────────────────────────────────────────────────────
 * This replaces neon-http's `db.batch()`, which postgres-js has no equivalent
 * for. `batch()` existed to spend one HTTP round-trip instead of several, and
 * its atomicity was a side effect — Neon wrapped the batch in a transaction.
 * Here the atomicity is the whole point and it is explicit.
 *
 * ── Why the callback ─────────────────────────────────────────────────────
 * A Drizzle query builder is bound to the session it was created from, so a
 * statement built on `db` executes on a pooled connection *outside* the
 * transaction even if it is awaited inside one. Statements must therefore be
 * built on `tx`, and taking a builder callback is what makes that impossible
 * to get wrong — there is no `db` in scope to reach for.
 *
 * Statements are awaited in order rather than with `Promise.all`: a
 * transaction owns a single connection, and sequential execution is what the
 * callers that read one statement's effect in the next one rely on.
 */
export async function batch<T extends readonly PromiseLike<unknown>[]>(
  database: Database,
  build: (tx: Tx) => [...T],
): Promise<{ -readonly [K in keyof T]: Awaited<T[K]> }> {
  return database.transaction(async (tx) => {
    const results: unknown[] = [];
    for (const statement of build(tx)) results.push(await statement);
    return results as never;
  });
}

export { schema };
