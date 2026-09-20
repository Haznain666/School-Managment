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
 *
 * ── `idle_timeout`, and the 98.6% ────────────────────────────────────────
 * This option used to be `20`, with a comment saying the application "opens
 * and closes connections constantly". That was backwards: `idle_timeout: 20`
 * is what *made* it do so, and it cost more egress than every school's data
 * put together.
 *
 * postgres-js bootstraps each **new** connection by asking the catalogue for
 * the oid of every array type (`pg_type … where typcategory = 'A'`). On this
 * database that is **446 rows**, and it runs once per connection, before a
 * single byte of school data moves. Measured from `pg_stat_statements` on
 * 2026-09-20, over the 47.8 days since the stats reset:
 *
 *   connections opened   766,278   (16,041/day)
 *   rows they returned   341,509,822
 *   share of everything  98.60%
 *
 * The cause is arithmetic. The shortest background sweep ran every 30s and
 * the rest every 60s, against an idle timeout of 20s — so **every tick of
 * every sweep in every one of the seven server processes found the pool
 * empty and opened a fresh connection**, paid the 446 rows, did work that
 * almost always found nothing, and let the connection expire before the next
 * tick. The pool never got to be a pool.
 *
 * 300s is longer than the longest tick (60s) by a wide margin, so a working
 * process keeps its connection across every sweep; it is still short enough
 * that a burst of web traffic does not leave spare connections holding pooler
 * client slots overnight.
 *
 * ── `fetch_types` is NOT the fix, and this is the evidence ───────────────
 * `fetch_types: false` skips that bootstrap entirely, which looks like the
 * obvious answer and is a data-corruption bug. That query is precisely what
 * registers postgres-js's array parsers and serializers, and this schema has
 * six array columns — `branches.class_levels`, `principal_assignments.grade_ids`,
 * `staff.saturday_ordinals`, `saturday_duty_policies.ordinals` and two on
 * `staff_kpis`. Run against the live database on 2026-09-20:
 *
 *   fetch_types=true    class_levels → ["PRE_SCHOOL","NURSERY",…]   (string[])
 *   fetch_types=false   class_levels → "{PRE_SCHOOL,NURSERY,…}"     (string)
 *   fetch_types=false   writing one  → throws: malformed array literal
 *
 * The read side is the dangerous half: no error, no warning, a `string` where
 * every caller expects `string[]`, so `class_levels.includes('GRADE_1')` starts
 * doing substring matching and a campus quietly claims to teach a grade it
 * does not. The driver's own `arrayParser` is not reachable — `postgres`
 * declares `exports` and the subpath is blocked — so there is no safe way to
 * re-register the types by hand either. **Do not set this option.**
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
      // Five minutes, not twenty seconds. See the note above: this one number
      // was 98.6% of the database's egress. It must stay comfortably above
      // `SWEEP_TICK_SECONDS` in `lib/scheduler.ts` or the churn comes back.
      idle_timeout: 300,
      connect_timeout: 10,
    });
  }
  return cachedSql;
}

export type Sql = ReturnType<typeof postgres>;
