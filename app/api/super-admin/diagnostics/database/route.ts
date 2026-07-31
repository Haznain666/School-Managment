import { apiSuccess, handleApiError } from '@/lib/api-response';
import { getSql } from '@/lib/neon';
import { requireSuperAdmin } from '@/lib/super-admin-guard';

/**
 * GET /api/super-admin/diagnostics/database
 *
 * Reports which database the running application is actually connected to, and
 * whether the Sprint 4 objects exist there.
 *
 * ── Why this exists ──────────────────────────────────────────────────────
 * "The column is in Neon but the app says it is missing" has exactly one
 * cause: the app is reading a different database than the one being looked at
 * — usually a different Neon branch, since each branch has its own `ep-…`
 * endpoint. Comparing a dashboard against a console is guesswork; this asks
 * the deployed process itself, which is the only authority on what its own
 * DATABASE_URL resolves to.
 *
 * Guarded by the Super Admin session, which is a signed cookie and touches no
 * table — so this still answers while every `schools` query is failing, which
 * is precisely when it is needed.
 *
 * Raw SQL rather than Drizzle: `information_schema` and Drizzle's own
 * migration bookkeeping have no schema definitions in `db/schema`, so the
 * query builder cannot express them. `lib/neon.ts` documents this as the
 * sanctioned escape hatch for exactly that case.
 *
 * Temporary. Delete once the environment mismatch is resolved.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** The eight tables migration 0006 creates. */
const SPRINT4_TABLES: readonly string[] = [
  'academic_years',
  'grades',
  'sections',
  'student_profiles',
  'student_enrollments',
  'student_guardians',
  'admission_applications',
  'school_id_sequences',
];

interface IdentityRow {
  database: string;
  schema: string;
  server: string;
}

interface NameRow {
  name: string;
}

interface MigrationRow {
  hash: string;
  created_at: string;
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
      select current_database() as database,
             current_schema()   as schema,
             version()          as server
    `) as unknown as IdentityRow[];

    const columnRows = (await sql`
      select column_name as name
      from information_schema.columns
      where table_schema = 'public' and table_name = 'schools'
      order by ordinal_position
    `) as unknown as NameRow[];

    const tableRows = (await sql`
      select table_name as name
      from information_schema.tables
      where table_schema = 'public'
      order by table_name
    `) as unknown as NameRow[];

    // Drizzle's bookkeeping. Absent when the database was built with
    // `db:push` or by hand rather than `drizzle-kit migrate`, which is itself
    // worth knowing — it decides whether `migrate` is safe to run.
    let appliedMigrations: number | null = null;
    try {
      const migrationRows = (await sql`
        select hash, created_at
        from drizzle.__drizzle_migrations
        order by created_at
      `) as unknown as MigrationRow[];
      appliedMigrations = migrationRows.length;
    } catch {
      appliedMigrations = null;
    }

    const schoolColumns = columnRows.map((row) => row.name);
    const publicTables = tableRows.map((row) => row.name);

    const present = SPRINT4_TABLES.filter((table) => publicTables.includes(table));
    const missing = SPRINT4_TABLES.filter((table) => !publicTables.includes(table));

    return apiSuccess({
      connection: {
        // Identifies the Neon branch. Compare this against the branch you ran
        // the migration on — if they differ, that is the whole problem.
        host: target?.host ?? null,
        databaseInUrl: target?.database ?? null,
        databaseReported: identityRows[0]?.database ?? null,
        schema: identityRows[0]?.schema ?? null,
        server: identityRows[0]?.server ?? null,
      },
      migration0006: {
        schoolsHasSchoolCode: schoolColumns.includes('school_code'),
        sprint4TablesPresent: present,
        sprint4TablesMissing: missing,
        fullyApplied: missing.length === 0 && schoolColumns.includes('school_code'),
      },
      drizzleBookkeeping: {
        // 6 before 0006, 7 after. Null means the table does not exist, so
        // `drizzle-kit migrate` would try to replay 0000 and collide.
        appliedMigrationCount: appliedMigrations,
      },
      schoolsColumns: schoolColumns,
    });
  } catch (error) {
    return handleApiError(error);
  }
}
