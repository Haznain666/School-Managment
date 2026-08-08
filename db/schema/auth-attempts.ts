import { sql } from 'drizzle-orm';
import { boolean, check, index, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

/**
 * auth_attempts — one row per attempt at an unauthenticated endpoint.
 *
 * ── Why this table has no `location_id`, and that is not an oversight ─────
 * Every other table in this schema carries the tenant key and is indexed on
 * it. This one deliberately does not, because it guards the surface *before* a
 * tenant exists. A wrong password at a school's login page is answered
 * identically whether or not the address belongs to that school — that is the
 * whole point of the single message — so at the moment the attempt is recorded
 * there is no verified tenant to attribute it to. Writing one anyway would mean
 * writing the *claimed* tenant, and a counter keyed by attacker-supplied data
 * is a counter an attacker can reset.
 *
 * A reviewer looking for the missing `location_id` should stop here. Nothing in
 * this table is ever read on a tenant-scoped path.
 *
 * ── Why one table for two jobs ───────────────────────────────────────────
 * Rate limiting and account lockout are the same question asked with different
 * windows: how many failures has this identity had recently. Two tables would
 * be two schedules to clean up, two things to keep consistent, and two places
 * to look when Sprint 23's security audit asks who has been knocking. This is
 * an audit log that happens to be queried as a rate limiter.
 *
 * ── Why the IP is hashed ─────────────────────────────────────────────────
 * The raw address is personal data that this application has no use for. What
 * the limiter needs is only "is this the same origin as before", and a sha256
 * answers that exactly. A leaked backup then does not hand over a map of where
 * a school's staff sign in from.
 *
 * ── Retention ────────────────────────────────────────────────────────────
 * Rows older than 24 hours are deleted opportunistically on write (see
 * `lib/auth-throttle.ts`). Hostinger has no platform cron, so there is nowhere
 * else to put the sweep; the longest window anything here reads is 15 minutes,
 * so a day is already generous.
 */

export const AUTH_ATTEMPT_SCOPES = [
  'login',
  'otp_request',
  'password_reset',
  'setup',
  'super_admin_login',
] as const;

export type AuthAttemptScope = (typeof AUTH_ATTEMPT_SCOPES)[number];

export const authAttempts = pgTable(
  'auth_attempts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /** Which endpoint. Each scope gets its own counter and its own window. */
    scope: text('scope').notNull().$type<AuthAttemptScope>(),
    /**
     * The email, lowercased and trimmed — or, where an endpoint has no address
     * to work with, whatever stable string identifies the subject of the
     * attempt. Never a password, never a token.
     */
    identifier: text('identifier').notNull(),
    /** sha256 of the client IP. Never the address itself. */
    ipHash: text('ip_hash').notNull(),
    succeeded: boolean('succeeded').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    // The two axes the limiter counts on. Both lead with the scope because
    // every read is scoped, and end with the timestamp because every read is a
    // range over the last few minutes.
    index('auth_attempts_scope_identifier_idx').on(
      table.scope,
      table.identifier,
      table.createdAt,
    ),
    index('auth_attempts_scope_ip_idx').on(table.scope, table.ipHash, table.createdAt),
    check(
      'auth_attempts_scope_check',
      sql`scope IN ('login', 'otp_request', 'password_reset', 'setup', 'super_admin_login')`,
    ),
  ],
);

export type AuthAttempt = typeof authAttempts.$inferSelect;
export type NewAuthAttempt = typeof authAttempts.$inferInsert;
