import { is } from 'drizzle-orm';
import { getTableConfig, PgTable } from 'drizzle-orm/pg-core';

import * as schema from '@/db/schema';
import { apiSuccess, handleApiError } from '@/lib/api-response';
import { getSql } from '@/lib/neon';
import { requireSuperAdmin } from '@/lib/super-admin-guard';

/**
 * GET /api/super-admin/diagnostics/database
 *
 * Answers, from inside the running process, the only three questions worth
 * asking when a table "exists" and the application says it does not:
 *
 *   1. Which database and role is this process actually using?
 *   2. Can it *resolve* the table by the same rules the query planner uses?
 *   3. Did the migration that creates it finish, or only start?
 *
 * ── Why `to_regclass` and not information_schema ─────────────────────────
 * Earlier versions listed `information_schema.tables WHERE table_schema =
 * 'public'`, which answers a different question than the one that matters. A
 * query in this application says `from "email_verifications"` with no schema
 * qualifier, so Postgres resolves it through *this connection's* `search_path`.
 * A table sitting in a schema that is not on that path exists by every
 * catalogue query anyone might run in a console and is still invisible here.
 *
 * `to_regclass('email_verifications')` performs exactly that resolution and
 * returns null when it fails. It is the same lookup the failing query does, so
 * it cannot disagree with it. `schemasContaining` then says where the table
 * really is, across every schema, so a search_path problem names itself.
 *
 * ── Why the per-migration hashes ─────────────────────────────────────────
 * `drizzle-orm/neon-http/migrator` issues one HTTP request per statement with
 * no transaction, and defers every bookkeeping insert to after the entire run.
 * A migration that fails half-way therefore leaves its completed statements
 * behind and records nothing — so "the tables exist" and "the migration ran"
 * are genuinely independent facts, and a bare count cannot tell them apart.
 * Comparing each journal entry's sha256 against the rows in
 * `drizzle.__drizzle_migrations` names precisely which file is unrecorded.
 *
 * Guarded by the Super Admin session, which is a signed cookie and touches no
 * table — so this still answers while every application query is failing,
 * which is precisely when it is needed.
 *
 * Nothing here returns a credential. The connection string is parsed for its
 * host and database name only; `url.username` and `url.password` are never
 * read.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface IdentityRow {
  database: string;
  schema: string | null;
  user: string;
  searchPath: string;
  server: string;
}

interface ResolutionRow {
  name: string;
  regclass: string | null;
  schemas: string | null;
}

interface MigrationRow {
  hash: string;
  created_at: string;
}

interface ColumnRow {
  table_name: string;
  column_name: string;
  is_nullable: string;
}

interface IndexRow {
  indexname: string;
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
 * The host is the useful part: it names the Neon endpoint.
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
    const expected = expectedTables();

    const identityRows = (await sql`
      select current_database()             as database,
             current_schema()::text         as schema,
             current_user                   as user,
             current_setting('search_path') as "searchPath",
             version()                      as server
    `) as unknown as IdentityRow[];

    /**
     * For each table the build expects: can this connection resolve it
     * unqualified, and which schemas actually hold something by that name?
     *
     * `to_regclass` is the planner's own resolver. When `regclass` is null and
     * `schemas` is not, the table exists somewhere this connection cannot
     * reach — a search_path problem, not a missing table.
     */
    const resolutionRows = (await sql`
      select t.name                                    as name,
             to_regclass(quote_ident(t.name))::text    as regclass,
             (
               select string_agg(c.table_schema, ',' order by c.table_schema)
               from information_schema.tables c
               where c.table_name = t.name
             )                                         as schemas
      from unnest(${expected}::text[]) as t(name)
    `) as unknown as ResolutionRow[];

    const unreachable = resolutionRows
      .filter((row) => row.regclass === null)
      .map((row) => ({
        table: row.name,
        // Non-null here is the tell-tale: present in the catalogue, invisible
        // to this connection.
        foundInSchemas: row.schemas === null ? [] : row.schemas.split(','),
      }));

    // Bookkeeping, compared file by file rather than counted.
    let migrations: {
      recordedCount: number | null;
      journalCount: number;
      unrecordedTags: string[];
    };

    try {
      const migrationRows = (await sql`
        select hash, created_at
        from drizzle.__drizzle_migrations
        order by created_at
      `) as unknown as MigrationRow[];

      const recorded = new Set(migrationRows.map((row) => row.hash));

      migrations = {
        recordedCount: migrationRows.length,
        journalCount: MIGRATION_HASHES.length,
        unrecordedTags: MIGRATION_HASHES.filter(
          (entry) => !recorded.has(entry.hash),
        ).map((entry) => entry.tag),
      };
    } catch {
      // No bookkeeping table at all: the database was built by `db:push` or by
      // hand, so `drizzle-kit migrate` would replay 0000 and collide.
      migrations = {
        recordedCount: null,
        journalCount: MIGRATION_HASHES.length,
        unrecordedTags: MIGRATION_HASHES.map((entry) => entry.tag),
      };
    }

    /**
     * The three objects 0011 creates *after* its two CREATE TABLEs. If the
     * migration aborted part-way these are missing while the tables are
     * present, and the failures that produces are nothing like "does not
     * exist": a missing unique index makes every upsert fail with 42P10, and a
     * still-NOT NULL phone column makes the invite insert fail with 23502.
     */
    const columnRows = (await sql`
      select table_name, column_name, is_nullable
      from information_schema.columns
      where table_schema = 'public'
        and table_name = 'school_users'
        and column_name = 'phone'
    `) as unknown as ColumnRow[];

    const indexRows = (await sql`
      select indexname
      from pg_indexes
      where schemaname = 'public'
        and tablename in ('email_verifications', 'user_passwords')
      order by indexname
    `) as unknown as IndexRow[];

    const indexNames = indexRows.map((row) => row.indexname);

    return apiSuccess({
      connection: {
        host: target?.host ?? null,
        databaseInUrl: target?.database ?? null,
        databaseReported: identityRows[0]?.database ?? null,
        currentSchema: identityRows[0]?.schema ?? null,
        searchPath: identityRows[0]?.searchPath ?? null,
        user: identityRows[0]?.user ?? null,
        server: identityRows[0]?.server ?? null,
      },
      resolution: {
        expectedTableCount: expected.length,
        // Empty means every table this build knows about is reachable by the
        // exact rules the failing query uses. A non-empty `foundInSchemas`
        // beside a table name is a search_path problem stating itself.
        unreachable,
        allReachable: unreachable.length === 0,
      },
      migration0011: {
        // Both tables plus everything the migration adds after them.
        phoneIsNullable: columnRows[0]?.is_nullable === 'YES',
        emailVerificationsUniqueIndex: indexNames.includes(
          'email_verifications_location_email_type_idx',
        ),
        userPasswordsUniqueIndex: indexNames.includes(
          'user_passwords_location_id_email_idx',
        ),
        indexes: indexNames,
      },
      migrations,
    });
  } catch (error) {
    return handleApiError(error);
  }
}

/**
 * sha256 of each migration file, matching what the migrator stores.
 *
 * Hard-coded rather than hashed at request time because `db/migrations` is
 * excluded from the TypeScript build and is not traced into the serverless
 * bundle, so the files are not on disk at runtime. Regenerate after adding a
 * migration:
 *
 *   node -e "const c=require('crypto'),f=require('fs');\
 *   JSON.parse(f.readFileSync('db/migrations/meta/_journal.json')).entries\
 *   .forEach(e=>console.log(JSON.stringify({tag:e.tag,\
 *   hash:c.createHash('sha256').update(f.readFileSync('db/migrations/'+e.tag+'.sql')).digest('hex')})+','))"
 */
const MIGRATION_HASHES: ReadonlyArray<{ tag: string; hash: string }> = [
  { tag: '0000_initial_schema', hash: '47b20b1ca82b02a3b0b76133fb3f5042d9e7cfb8ec5defe74112b654961ff463' },
  { tag: '0001_sprint2_super_admin_tables', hash: '6e3960a6089a108eb8cbdd17d93e94772147351090cf165d4727390d09600c0e' },
  { tag: '0002_sprint2_drop_school_subdomains', hash: '0a5cd253cc7da891518238bd71abb599c41f72ef1dec07ac57197bcbd55b3e41' },
  { tag: '0003_sprint3_school_users_invitations', hash: '498251f43f0fd6b5d854b9a911a4e63d97c78b337cb927b508fe6c6f3b92b8be' },
  { tag: '0004_sprint3_patch_auth_otp_sessions', hash: '43ea99173bf2ea98df5cb25b5134e2b84e7bf17316c5fbcf7aada0bd9a7a9285' },
  { tag: '0005_sprint3_emergency_login_tokens', hash: '40135b283a0f16e563f4c5abdbf838fcf463fee4574279ad1bb141ede978d0b1' },
  { tag: '0006_sprint4_admissions', hash: '4daa28e5edc96ca2606fcc482f12c084f9e902bc9dc82a439c65f86930534ebe' },
  { tag: '0007_sprint5_fee_management', hash: '6b8d93d443b6c3dc1e85e5bcb675a18ae5f52486bafbf651195254e726ad6ffc' },
  { tag: '0008_sprint6_academics_timetable', hash: 'df8ea853e620d3a2736f92e7ab495d429c344c42ee981772ebf5e2726103828c' },
  { tag: '0009_sprint7_hr_payroll', hash: 'cc6c8689116025a655e3e00567ac1d2bdcefcac23f4182e497c053aad9baf919' },
  { tag: '0010_sprint8_roles_permissions', hash: 'd7e11699bb0607deee461733e3dad763329fa63d6899fdc4a8c3cb90818d39a2' },
  { tag: '0011_sprint9_email_auth', hash: '020c22b4f62d6782a826ac9a7714940cce59af0e257f5587c73c0a9a7924e99e' },
];
