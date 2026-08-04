import { neon, type NeonQueryFunction } from '@neondatabase/serverless';

import { requireServerEnv } from './env';

/**
 * Neon serverless PostgreSQL client.
 *
 * Uses the HTTP driver, which works in both the Node.js and Edge runtimes —
 * important because `middleware.ts` resolves subdomains on the Edge.
 *
 * This module deliberately does NOT import `server-only`: middleware is server
 * code but is not covered by that guard. It is still never bundled for the
 * browser, because nothing under `components/` imports it.
 */

let cachedClient: NeonQueryFunction<false, false> | null = null;

/**
 * Returns the raw Neon SQL tag for hand-written queries.
 *
 * Prefer the Drizzle instance from `lib/drizzle.ts` for application queries
 * (CRITICAL RULE #6). Use this only where Drizzle cannot go — currently just
 * the Edge middleware lookup, which must stay dependency-light.
 */
export function getSql(): NeonQueryFunction<false, false> {
  if (cachedClient === null) {
    const url = requireServerEnv('DATABASE_URL');
    logConnectionTarget(url);
    cachedClient = neon(url);
  }
  return cachedClient;
}

/**
 * Names the database this process is about to talk to, once per cold start.
 *
 * "The table exists in Neon but the app cannot see it" is always the same
 * thing: two different databases. Neon gives every branch its own `ep-…`
 * endpoint, so the host is what tells them apart — and having it in the log
 * immediately above the `relation … does not exist` error turns a hunt through
 * three environments into reading two lines.
 *
 * Host and database name only. `url.username` and `url.password` are never
 * read, so no credential can reach the log even if the whole URL is malformed.
 */
function logConnectionTarget(raw: string): void {
  try {
    const url = new URL(raw);
    console.info(
      `[neon] connected to ${url.host}/${url.pathname.replace(/^\//, '')} ` +
        `(env: ${process.env['VERCEL_ENV'] ?? process.env.NODE_ENV ?? 'unknown'})`,
    );
  } catch {
    // A malformed URL is about to fail loudly on its own; say nothing that
    // might quote part of it.
    console.warn('[neon] DATABASE_URL is not a parseable connection string.');
  }
}

export type { NeonQueryFunction };
