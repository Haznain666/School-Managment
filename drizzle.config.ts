import { defineConfig } from 'drizzle-kit';

/**
 * Drizzle Kit reads DATABASE_URL directly from the environment.
 * Load it from `.env.local` before running: `node --env-file=.env.local ...`
 * or export it in your shell / CI.
 *
 * Migrations run best against the **direct** Supabase connection
 * (`db.<ref>.supabase.co:5432`), not the transaction pooler the app uses:
 * DDL and advisory locks want one stable session, which transaction pooling
 * cannot promise.
 */
const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  throw new Error(
    'DATABASE_URL is not set. Drizzle Kit needs the Supabase connection ' +
      'string. Copy .env.example to .env.local and fill it in.',
  );
}

export default defineConfig({
  schema: './db/schema/index.ts',
  out: './db/migrations',
  dialect: 'postgresql',
  dbCredentials: {
    url: databaseUrl,
  },
  strict: true,
  verbose: true,
});
