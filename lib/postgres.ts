import postgres from 'postgres';

import { requireServerEnv } from './env';

/**
 * Supabase PostgreSQL client (postgres-js over the Supavisor pooler).
 *
 * ── Why this replaced the Neon HTTP driver ───────────────────────────────
 * Neon's driver spoke HTTP, which meant it ran anywhere — including the Edge
 * runtime, which is why `middleware.ts` was able to query the database
 * directly. Supabase speaks the real PostgreSQL wire protocol over TCP, and
 * TCP sockets do not exist on the Edge.
 *
 * That is not a downgrade, but it does move a constraint: this module is now
 * Node-only. The middleware lookup it used to serve lives in
 * `lib/school-lookup-edge.ts`, which goes through Supabase's REST API instead.
 * Importing this file from `middleware.ts` will fail the build.
 *
 * ── Connection string ────────────────────────────────────────────────────
 * Use the **transaction-mode pooler** (Supabase -> Project Settings ->
 * Database -> Connection string -> Transaction pooler), port 6543. The
 * application opens and closes connections constantly; the pooler is what
 * keeps that from exhausting Postgres' connection slots.
 *
 * Transaction mode multiplexes several clients onto one backend connection, so
 * a prepared statement created by one client would be invisible to the next.
 * Hence `prepare: false` — omitting it produces intermittent
 * "prepared statement does not exist" errors under load, which are miserable
 * to diagnose because they only appear once there is concurrency.
 */

let cachedSql: ReturnType<typeof postgres> | null = null;

/**
 * Returns the raw postgres-js SQL tag for hand-written queries.
 *
 * Prefer the Drizzle instance from `lib/drizzle.ts` for application queries
 * (CRITICAL RULE #6). Use this only where Drizzle cannot go — currently just
 * the `information_schema` introspection in the super-admin diagnostics route,
 * which queries objects that have no definition in `db/schema`.
 */
export function getSql(): ReturnType<typeof postgres> {
  if (cachedSql === null) {
    cachedSql = postgres(requireServerEnv('DATABASE_URL'), {
      // Required by the transaction-mode pooler. See the note above.
      prepare: false,
      // Supabase terminates TLS at the pooler with its own CA, so the chain is
      // not verifiable from here; the connection is still encrypted.
      ssl: 'require',
      // A single long-lived Node process on Hostinger, not a fleet of lambdas.
      // Keep this well under the pooler's client limit for the plan.
      max: 10,
      idle_timeout: 20,
      connect_timeout: 10,
    });
  }
  return cachedSql;
}

export type Sql = ReturnType<typeof postgres>;
