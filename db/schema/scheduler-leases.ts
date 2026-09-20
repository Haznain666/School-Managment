import { sql } from 'drizzle-orm';
import { index, pgTable, text, timestamp } from 'drizzle-orm/pg-core';

/**
 * Which server process is currently allowed to run the background sweeps.
 *
 * ── The only table in this schema with no `location_id` ──────────────────
 * Every other table carries the tenant key because every other table holds a
 * school's data. This one holds none: it is a lock between the **seven Node
 * processes Hostinger runs**, and those processes are not per-school. Giving
 * it a `location_id` would be inventing a tenant for a row that has no school
 * behind it, and would let seven processes each claim "their" school's lease
 * and go back to doing the same work seven times.
 *
 * ── Why it exists ────────────────────────────────────────────────────────
 * `instrumentation.ts` starts the sweeps once per server process, and
 * production runs seven of them — visible in the log as seven distinct
 * 60-second offsets inside the same minute. Each individual unit of work was
 * already claimed with a conditional `UPDATE … RETURNING` (CLAUDE.md, "background
 * work is claimed, not checked"), so seven processes never sent the same email
 * twice. What they did do is **look** seven times. Measured from
 * `pg_stat_statements` on 2026-09-20, over 47.8 days:
 *
 *   UPDATE email_outbox … WHERE status = 'sending' AND …   367,329 calls, 0 rows
 *   update late_fee_rules … (auto-send)                    111,057 calls, 0 rows
 *   update late_fee_rules … (auto-generate)                 66,134 calls, 0 rows
 *   select id from academic_years …                        584,786 calls
 *   announcements sweep                                    141,437 calls, 2 rows
 *
 * Roughly 1.6 million statements to find, in total, two announcements. The
 * claim rule made the *work* safe; it never made the *looking* cheap.
 *
 * So the lease moves the claim up one level: one process holds it, and only
 * the holder looks at all. The per-item claims stay exactly as they are —
 * this is a second guard, not a replacement, because a lease that expires
 * mid-sweep must not be able to produce a double send.
 *
 * ── Shape ────────────────────────────────────────────────────────────────
 * One row, `name = 'sweeps'`. `owner` is a per-process id minted at boot, so
 * a restarted process is a different owner and cannot renew the lease its
 * predecessor held. `expires_at` is what makes a dead leader recoverable:
 * once it is in the past, any process may take over, and nothing has to
 * notice the death for that to happen.
 */
export const schedulerLeases = pgTable(
  'scheduler_leases',
  {
    /** The lease. Exactly one today: `'sweeps'`. */
    name: text('name').primaryKey(),

    /**
     * The process that holds it — `${hostname}:${pid}:${random}`, minted once
     * per process. Random because a container can reuse a pid.
     */
    owner: text('owner').notNull(),

    /** When the current holder first took it, for the log line. */
    acquiredAt: timestamp('acquired_at', { withTimezone: true })
      .notNull()
      .default(sql`now()`),

    /** Last renewal, so a stalled-but-alive leader is visible. */
    renewedAt: timestamp('renewed_at', { withTimezone: true })
      .notNull()
      .default(sql`now()`),

    /**
     * After this instant any process may take the lease. Never read with an
     * `if` in application code — the takeover is decided inside the same
     * statement that performs it.
     */
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  },
  (table) => [index('scheduler_leases_expires_at_idx').on(table.expiresAt)],
);

export type SchedulerLease = typeof schedulerLeases.$inferSelect;
