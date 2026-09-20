-- The scheduler lease — one of seven server processes runs the sweeps.
-- STATE.md §5cl, PENDING.md D6. Paired with `lib/scheduler.ts`.
--
-- ══ What this is for ════════════════════════════════════════════════════
-- `instrumentation.ts` starts eight background sweeps once per server
-- process, and Hostinger runs seven processes. Every unit of work those
-- sweeps do was already claimed with a conditional `UPDATE … RETURNING`, so
-- nothing was ever done twice. What happened seven times was the *looking*.
--
-- Measured from `pg_stat_statements` on 2026-09-20, 47.8 days since reset:
--
--   UPDATE email_outbox … status = 'sending' …   367,329 calls,        0 rows
--   update late_fee_rules … auto_send_last_run   111,057 calls,        0 rows
--   update late_fee_rules … auto_generate…        66,134 calls,        0 rows
--   select id from academic_years …              584,786 calls
--   announcements sweep                          141,437 calls,        2 rows
--
-- This table lets exactly one process look.
--
-- ══ No `location_id`, on purpose ════════════════════════════════════════
-- Every other table in this schema carries the tenant key. This one holds no
-- school's data — it is a lock between operating-system processes, and those
-- are not per-school. A `location_id` here would let seven processes each
-- take "their own" lease and reinstate exactly the behaviour it removes.
--
-- ══ Safe to apply before the code, and safe to leave applied ════════════
-- An empty table means no process holds the lease, and the first tick after
-- deploy claims it. A deploy that rolls back to code which does not know
-- about the lease leaves one stale row that nothing reads. Neither state can
-- lose a scheduled announcement or an outbox message: the per-item claims in
-- `email-outbox.ts`, `announcement-queries.ts`, `voucher-auto-send.ts` and the
-- rest are untouched and still decide, on their own, who sends what.
--
-- ══ Idempotent ══════════════════════════════════════════════════════════
-- Every statement is `IF NOT EXISTS`. Run it twice; the second run does
-- nothing and reports nothing.

CREATE TABLE IF NOT EXISTS "scheduler_leases" (
  "name"        text PRIMARY KEY,
  "owner"       text NOT NULL,
  "acquired_at" timestamptz NOT NULL DEFAULT now(),
  "renewed_at"  timestamptz NOT NULL DEFAULT now(),
  "expires_at"  timestamptz NOT NULL
);

-- The takeover predicate reads `expires_at` on every tick from every process
-- that is not the holder. One row today, so this is cheap insurance rather
-- than a necessity; it costs nothing and stops the question being asked again
-- if a second lease is ever added.
CREATE INDEX IF NOT EXISTS "scheduler_leases_expires_at_idx"
  ON "scheduler_leases" ("expires_at");

COMMENT ON TABLE "scheduler_leases" IS
  'Which server process may run the background sweeps. Platform-level, not per-school: deliberately has no location_id. See lib/scheduler.ts.';
