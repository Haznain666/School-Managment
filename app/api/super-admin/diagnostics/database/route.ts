import { is } from 'drizzle-orm';
import { getTableConfig, PgTable } from 'drizzle-orm/pg-core';

import * as schema from '@/db/schema';
import { apiSuccess, handleApiError } from '@/lib/api-response';
import { getSql } from '@/lib/neon';
import { requireSuperAdmin } from '@/lib/super-admin-guard';

/**
 * GET /api/super-admin/diagnostics/database
 *
 * Reports which database the running application is actually connected to, and
 * which tables its own schema expects but cannot find there.
 *
 * ── Why this exists ──────────────────────────────────────────────────────
 * "The table is in Neon but the app says it is missing" has exactly one cause:
 * the app is reading a different database than the one being looked at —
 * usually a different Neon branch, since each branch has its own `ep-…`
 * endpoint and the console's branch selector is not the deployment's
 * DATABASE_URL. Comparing a dashboard against a console is guesswork; this
 * asks the deployed process itself, which is the only authority on what its
 * own connection string resolves to.
 *
 * Guarded by the Super Admin session, which is a signed cookie and touches no
 * table — so this still answers while every application query is failing,
 * which is precisely when it is needed.
 *
 * ── On being schema-driven ───────────────────────────────────────────────
 * The first version of this endpoint hard-coded the eight tables migration
 * 0006 creates. It then reported nothing useful about 0011, because the list
 * was a snapshot of one sprint. The expected set is now derived from the
 * Drizzle schema itself, so it covers whatever the deployed build actually
 * knows about and cannot fall behind again.
 *
 * Raw SQL rather than Drizzle: `information_schema` and Drizzle's own
 * migration bookkeeping have no definitions in `db/schema`, so the query
 * builder cannot express them. `lib/neon.ts` documents this as the sanctioned
 * escape hatch for exactly that case.
 *
 * Nothing here returns a credential. The connection string is parsed for its
 * host and database name only; `url.username` and `url.password` are never
 * read.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface IdentityRow {
  database: string;
  schema: string;
  user: string;
  server: string;
  searchPath: string;
}

interface NameRow {
  name: string;
}

interface MigrationRow {
  hash: string;
  created_at: string;
}

/** Every table name this build's schema defines, from the schema itself. */
function expectedTables(): string[] {
  const names: string[] = [];

  for (const value of Object.values(schema)) {
    if (is(value, PgTable)) {
      names.push(getTableConfig(value).name);
    }
  }

  return [...new Set(names)].sort();
}

/**
 * The connection target, with the credentials removed.
 * The host is the useful part: it names the Neon branch endpoint.
 */
function connectionTarget(): { host: string; database: string } | null {
  const raw = process.env['DATABASE_URL'];
  if (raw === undefined || raw === '') return null;

  try {
    const url = new URL(raw);
    // Deliberately never touches url.username / url.password.
    return { host: url.host, database: url.pathname.replace(/^\//, '') };
  } catch {
    return null;
  }
}

export async function GET() {
  try {
    await requireSuperAdmin();

    const target = connectionTarget();
    const sql = getSql();

    const identityRows = (await sql`
      select current_database()      as database,
             current_schema()        as schema,
             current_user            as user,
             version()               as server,
             current_setting('search_path') as "searchPath"
    `) as unknown as IdentityRow[];

    const tableRows = (await sql`
      select table_name as name
      from information_schema.tables
      where table_schema = 'public'
      order by table_name
    `) as unknown as NameRow[];

    const publicTables = tableRows.map((row) => row.name);
    const expected = expectedTables();
    const missing = expected.filter((table) => !publicTables.includes(table));

    // Drizzle's bookkeeping. Absent when the database was built with `db:push`
    // or by hand rather than `drizzle-kit migrate`, which is itself worth
    // knowing — it decides whether `migrate` is safe to run here.
    let migrations: { count: number; latestAppliedAt: string | null } | null = null;
    try {
      const migrationRows = (await sql`
        select hash, created_at
        from drizzle.__drizzle_migrations
        order by created_at
      `) as unknown as MigrationRow[];

      const latest = migrationRows[migrationRows.length - 1];
      migrations = {
        count: migrationRows.length,
        latestAppliedAt:
          latest === undefined
            ? null
            : new Date(Number(latest.created_at)).toISOString(),
      };
    } catch {
      migrations = null;
    }

    return apiSuccess({
      connection: {
        // Identifies the Neon branch. Compare this against the branch you ran
        // the migration on — if they differ, that is the whole problem.
        host: target?.host ?? null,
        databaseInUrl: target?.database ?? null,
        databaseReported: identityRows[0]?.database ?? null,
        schema: identityRows[0]?.schema ?? null,
        searchPath: identityRows[0]?.searchPath ?? null,
        user: identityRows[0]?.user ?? null,
        server: identityRows[0]?.server ?? null,
      },
      schemaState: {
        expectedTableCount: expected.length,
        presentTableCount: expected.length - missing.length,
        // Empty means this database matches what the deployed build expects.
        missingTables: missing,
        upToDate: missing.length === 0,
      },
      emailAuth: {
        // Named explicitly because this is the pair migration 0011 adds, and
        // the reason this endpoint gets opened today.
        emailVerifications: publicTables.includes('email_verifications'),
        userPasswords: publicTables.includes('user_passwords'),
        migration0011Applied:
          publicTables.includes('email_verifications') &&
          publicTables.includes('user_passwords'),
      },
      drizzleBookkeeping: {
        // 12 once 0000–0011 have all been applied by `drizzle-kit migrate`.
        // Null means the table does not exist, so `migrate` would try to
        // replay 0000 and collide with the objects already there.
        ...(migrations ?? { count: null, latestAppliedAt: null }),
      },
      publicTables,
    });
  } catch (error) {
    return handleApiError(error);
  }
}
