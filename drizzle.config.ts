import { defineConfig } from 'drizzle-kit';

/**
 * Drizzle Kit reads DATABASE_URL directly from the environment. `npm run
 * db:migrate` does **not** load `.env.local` — pass it explicitly:
 *
 *   DATABASE_URL="…:5432/postgres" npx drizzle-kit migrate
 *
 * ── Which connection, and the trap ───────────────────────────────────────
 * Two things are true at once, and taking only the first of them costs an
 * hour:
 *
 *   1. Migrations want a **session**, not transaction pooling. DDL and
 *      advisory locks need one stable connection, which the pooler on 6543
 *      cannot promise. So the port must be **5432**, not the 6543 the
 *      application uses.
 *
 *   2. The obvious way to get a session — the direct connection,
 *      `db.<ref>.supabase.co:5432` — **does not work here.** Supabase serves
 *      it over IPv6 only without a paid add-on, so on an ordinary network it
 *      fails with `getaddrinfo ENOTFOUND`. This comment used to recommend it.
 *
 * The answer is the *pooler host* on port **5432**, which is session mode:
 *
 *   aws-0-<region>.pooler.supabase.com:5432
 *
 * Same host as the app's connection string, different port. See STATE.md §5c.
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
