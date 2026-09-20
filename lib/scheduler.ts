import 'server-only';

import { randomUUID } from 'node:crypto';
import { hostname } from 'node:os';

import { eq, lt, or } from 'drizzle-orm';

import { schedulerLeases } from '@/db/schema';

import { describeError } from './describe-error';
import { db } from './drizzle';

/**
 * One of the seven server processes runs the background sweeps. This is the
 * claim that decides which, and the clock the sweeps hang off.
 *
 * ── The problem it solves ────────────────────────────────────────────────
 * `instrumentation.ts` starts eight sweeps once per server process, and
 * production runs seven processes — visible in the log as seven distinct
 * 60-second offsets inside the same minute. Each *unit of work* those sweeps
 * do was already claimed with a conditional `UPDATE … RETURNING`, per
 * CLAUDE.md's "background work is claimed, not checked", so nothing was ever
 * sent twice. What happened seven times was the **looking**. Measured from
 * `pg_stat_statements` on 2026-09-20, over 47.8 days:
 *
 *   UPDATE email_outbox … status = 'sending' …   367,329 calls,      0 rows
 *   update late_fee_rules … (auto-send)          111,057 calls,      0 rows
 *   update late_fee_rules … (auto-generate)       66,134 calls,      0 rows
 *   select id from academic_years …              584,786 calls
 *   announcements sweep                          141,437 calls,      2 rows
 *
 * Roughly 1.6 million statements, to find two announcements.
 *
 * Worse than the load: with `idle_timeout: 20` in `lib/postgres.ts` and the
 * shortest sweep at 30s, **every tick opened a brand-new connection**, and
 * postgres-js pays 446 catalogue rows to bootstrap one. That was 98.6% of
 * everything this database returned. `lib/postgres.ts` fixes the timeout; this
 * file removes the reason seven processes were waking up at all.
 *
 * ── The lease is claimed, never checked ──────────────────────────────────
 * The same rule, one level up. A read followed by an `if` lets all seven
 * processes pass the same test; this is a single `INSERT … ON CONFLICT DO
 * UPDATE … WHERE … RETURNING`, which Postgres decides on one row under one
 * lock. Exactly one caller gets a row back.
 *
 * The `WHERE` on the `DO UPDATE` is the whole mechanism:
 *
 *   owner = me            → I already hold it; this is a renewal
 *   OR expires_at < now() → nobody has renewed it; I may take over
 *
 * When neither holds, the `DO UPDATE` is skipped, **no row is returned**, and
 * this process knows it is not the leader without ever having read the table.
 *
 * ── The per-item claims are not removed ──────────────────────────────────
 * This is a second guard, not a replacement. A lease can expire while its
 * holder is mid-sweep — a long SMTP send, a paused process — and two leaders
 * for a few seconds must not be able to produce a double send. Every sweep
 * still claims each row it touches exactly as it did before.
 *
 * ── If the table is not there ────────────────────────────────────────────
 * A deploy that lands before `0051` is applied finds no `scheduler_leases`.
 * The failure is then a choice between two behaviours, and only one of them
 * is safe: treating the error as "not the leader" would stop *every* sweep in
 * *every* process — no invite emails, no scheduled announcements, and nothing
 * on any screen saying so, which is the exact shape of the scheduled-
 * announcement bug that went unnoticed from Sprint 11 to 2026-08-20. So a
 * lease error degrades to **run anyway**: the old seven-process behaviour,
 * which is wasteful and correct, with one loud line in the log.
 */

/** The single lease. One row, one name. */
const LEASE_NAME = 'sweeps';

/**
 * This process, for the lifetime of this process. Random as well as pid-based
 * because a container can reuse a pid, and a restarted process must **not** be
 * able to renew the lease its predecessor held — that would hide a crash loop
 * as a healthy leader.
 */
const OWNER = `${hostname()}:${String(process.pid)}:${randomUUID().slice(0, 8)}`;

/**
 * How often the holder wakes. Also the resolution of every sweep interval, so
 * no sweep can be finer-grained than this.
 *
 * Must stay well under `idle_timeout` in `lib/postgres.ts` (300s) — that is
 * what keeps the pool's connection warm from one tick to the next instead of
 * paying 446 catalogue rows to open a new one.
 */
export const TICK_SECONDS = 30;

/**
 * How often a process that is *not* the holder asks for the lease. Longer than
 * the tick, because six processes politely asking is the standing cost of this
 * design and the only thing it buys is a shorter failover.
 */
const FOLLOWER_PROBE_SECONDS = 60;

/**
 * How long a claim is good for. Four times `TICK_SECONDS`, so an ordinary slow
 * tick never drops the lease; short enough that a process killed between
 * deploys is replaced inside `LEASE_SECONDS + FOLLOWER_PROBE_SECONDS` — at
 * most three minutes with nothing sweeping.
 */
const LEASE_SECONDS = 120;

interface RegisteredSweep {
  /** For the log, and for `check-scheduler`. */
  readonly name: string;
  /** Rounded up to the next whole `TICK_SECONDS` in practice. */
  readonly seconds: number;
  readonly run: () => Promise<void>;
  /** `null` until it has run in this process. Deliberately not persisted. */
  lastRunAt: number | null;
  running: boolean;
}

const sweeps: RegisteredSweep[] = [];

let tickTimer: ReturnType<typeof setInterval> | null = null;
let ticking = false;
let holdsLease = false;
let lastProbeAt = 0;
let degraded = false;
let announcedDegraded = false;

/**
 * Registers a sweep. Called once per sweep from `instrumentation.ts`; nothing
 * runs until `startScheduler()` does.
 *
 * Registering the same name twice is a no-op, for the same reason every
 * `start*` function it replaced guarded on its own timer: Next's dev server
 * re-evaluates modules, and two registrations would double the rate.
 */
export function registerSweep(
  name: string,
  seconds: number,
  run: () => Promise<void>,
): void {
  if (sweeps.some((sweep) => sweep.name === name)) return;
  sweeps.push({ name, seconds, run, lastRunAt: null, running: false });
}

/** What `check-scheduler` reads, so its list cannot drift from the code. */
export function registeredSweeps(): readonly { name: string; seconds: number }[] {
  return sweeps.map(({ name, seconds }) => ({ name, seconds }));
}

/** This process's owner id. For the log line and for the check script. */
export function schedulerOwner(): string {
  return OWNER;
}

/**
 * Takes the lease, renews it, or reports that somebody else holds it — in one
 * statement, with no read and no `if`.
 *
 * Returns `true` when **this** process may sweep. Returns `true` on an error
 * too; see the docblock at the top of this file for why that direction is the
 * safe one.
 */
export async function claimSchedulerLease(now: Date = new Date()): Promise<boolean> {
  const expiresAt = new Date(now.getTime() + LEASE_SECONDS * 1000);

  try {
    const claimed = await db
      .insert(schedulerLeases)
      .values({ name: LEASE_NAME, owner: OWNER, acquiredAt: now, renewedAt: now, expiresAt })
      .onConflictDoUpdate({
        target: schedulerLeases.name,
        // `acquired_at` is deliberately absent: a renewal must not move it, or
        // the log can never say how long this leader has actually held it.
        set: { owner: OWNER, renewedAt: now, expiresAt },
        // The whole mechanism. Both comparisons go through the column's
        // `mapToDriverValue` via the operators — never a raw `sql` template,
        // per CLAUDE.md: a `Date` handed straight to postgres-js throws
        // ERR_INVALID_ARG_TYPE and names neither the column nor the file.
        setWhere: or(eq(schedulerLeases.owner, OWNER), lt(schedulerLeases.expiresAt, now)),
      })
      .returning({ owner: schedulerLeases.owner });

    if (degraded) {
      console.info('[scheduler] lease table reachable again; back to one leader');
      degraded = false;
      announcedDegraded = false;
    }

    const won = claimed.length > 0;

    if (won && !holdsLease) {
      console.info(`[scheduler] lease taken by ${OWNER} for ${String(LEASE_SECONDS)}s`);
    } else if (!won && holdsLease) {
      console.warn(`[scheduler] lease lost by ${OWNER}; another process holds it`);
    }

    holdsLease = won;
    return won;
  } catch (caught) {
    degraded = true;
    if (!announcedDegraded) {
      announcedDegraded = true;
      console.error(
        '[scheduler] lease unavailable, falling back to one sweeper per process — ' +
          `apply migration 0051 — ${describeError(caught)}`,
      );
    }
    // Wasteful and correct, rather than tidy and silently stopped.
    holdsLease = true;
    return true;
  }
}

/**
 * Runs every sweep whose interval has elapsed, one after another.
 *
 * ── Sequential, not `Promise.all` ────────────────────────────────────────
 * Eight sweeps fired at once open eight pooled connections, and opening a
 * connection is the thing this whole change exists to stop. Nothing here is
 * latency-critical to the second, so they queue on one warm connection.
 *
 * Never throws: it is called from a timer callback, where an unhandled
 * rejection takes the Node process down on Hostinger.
 */
async function runDueSweeps(now: number): Promise<void> {
  for (const sweep of sweeps) {
    if (sweep.running) continue;
    if (sweep.lastRunAt !== null && now - sweep.lastRunAt < sweep.seconds * 1000) continue;

    sweep.running = true;
    sweep.lastRunAt = now;

    try {
      await sweep.run();
    } catch (caught) {
      console.error(`[scheduler] ${sweep.name} failed: ${describeError(caught)}`);
    } finally {
      sweep.running = false;
    }
  }
}

/**
 * Starts the one timer this application has. Idempotent.
 *
 * `unref()` so it never holds the process open on its own — a queue is not a
 * reason to refuse to shut down.
 */
export function startScheduler(): void {
  if (tickTimer !== null) return;

  tickTimer = setInterval(() => {
    if (ticking) return;
    ticking = true;

    const now = Date.now();

    // A holder renews on every tick. A follower asks once a minute — six
    // processes asking at the tick rate would cost more statements than the
    // sweeps this saves.
    const shouldProbe =
      holdsLease || lastProbeAt === 0 || now - lastProbeAt >= FOLLOWER_PROBE_SECONDS * 1000;

    if (!shouldProbe) {
      ticking = false;
      return;
    }

    lastProbeAt = now;

    void claimSchedulerLease()
      .then(async (mine) => {
        if (mine) await runDueSweeps(Date.now());
      })
      .catch((caught: unknown) => {
        console.error(`[scheduler] tick failed: ${describeError(caught)}`);
      })
      .finally(() => {
        ticking = false;
      });
  }, TICK_SECONDS * 1000);

  tickTimer.unref?.();

  const summary = sweeps.map((sweep) => `${sweep.name}/${String(sweep.seconds)}s`).join(', ');

  console.info(
    `[scheduler] started as ${OWNER} — tick ${String(TICK_SECONDS)}s, ` +
      `${String(sweeps.length)} sweeps: ${summary}`,
  );
}
