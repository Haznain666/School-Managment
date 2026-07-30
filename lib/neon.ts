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
    cachedClient = neon(requireServerEnv('DATABASE_URL'));
  }
  return cachedClient;
}

export type { NeonQueryFunction };
