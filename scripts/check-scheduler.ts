/**
 * The scheduler lease and the connection settings behind it.
 *
 *     npm run check-scheduler
 *
 * ── The defect this exists about ─────────────────────────────────────────
 * `PENDING.md` D6 / `STATE.md` §5cl. Supabase billed an egress overage on a
 * three-school estate, and `pg_stat_statements` said why. Measured 2026-09-20,
 * 47.8 days since the stats reset:
 *
 *   rows returned, all statements      346,350,353
 *   rows returned by ONE statement     341,509,822   (98.60%)
 *
 * That statement is postgres-js's type bootstrap — the catalogue read it does
 * once per **new connection** — and it had run 766,278 times, 16,041 a day.
 * None of it is application data.
 *
 * The cause was arithmetic, not a leak. `idle_timeout: 20` in `lib/postgres.ts`
 * was shorter than every background sweep's interval (30s at the shortest), and
 * `instrumentation.ts` started eight sweeps in each of the seven server
 * processes Hostinger runs. So every tick of every sweep found the pool empty,
 * opened a connection, paid 446 catalogue rows, did work that almost always
 * found nothing, and let the connection expire before the next tick.
 *
 * ── Part one: the settings, which need no database ───────────────────────
 * Three of them, and each one is a way for this to come straight back:
 *
 *   · **R1.** `idle_timeout` is comfortably greater than `TICK_SECONDS`. If it
 *     is not, the pool cannot survive one tick to the next and the churn
 *     returns in full.
 *   · **R2.** `fetch_types` is not set. It is the obvious fix and it is a
 *     data-corruption bug — see R2's own note below.
 *   · **R3.** No sweep module keeps a `setInterval` of its own. Eight timers
 *     per process is what this change removed; one left behind is one that
 *     still runs seven times.
 *
 * ── Part two: the lease statement, executed ──────────────────────────────
 * Printing `toSQL()` proves the names; only a server proves the statement
 * (CLAUDE.md). `INSERT ... ON CONFLICT DO UPDATE ... WHERE ... RETURNING` is a
 * shape this repository has not used before, and the `WHERE` on the `DO UPDATE`
 * is the entire mechanism — get it wrong and the failure is that every process
 * wins, or that none does. Neither throws.
 *
 * So the statement runs against the real schema. The script reads whether
 * `0051` is applied rather than being told: before it, every execution must
 * fail with exactly **42P01** and any other SQLSTATE is a real defect wearing
 * a predicted failure's clothes; after it, the behaviour itself is asserted.
 *
 * The SQLSTATE lives on the error's `cause` and not on the error. Reading
 * `.code` reports every failure as unpredicted — the trap this pattern has
 * paid for twice.
 *
 * ── Part three is the only part that proves anything ─────────────────────
 * **A check that reads a claim proves nothing.** Part two says the statement
 * plans; it does not say it excludes. So part three drives seven contenders at
 * one lease, under a name no server process uses, and requires:
 *
 *   · exactly **one** of seven wins a free lease;
 *   · the winner renews, and the other six still get nothing;
 *   · `acquired_at` does not move on a renewal, while `renewed_at` does;
 *   · once `expires_at` is in the past, exactly **one** of the other six takes
 *     it over -- the holder is held out of that round on purpose, so the last
 *     assertion below cannot be decided by who wins a race;
 *   · and the process that held it before is no longer able to renew.
 *
 * Break the `setWhere` and the first and fourth go red on exactly those lines.
 *
 * Everything it writes is under `check-scheduler:*`, in a table that holds no
 * school's data, and it is deleted at the end and again at the start of the
 * next run. No tenant row is read or written anywhere in this file.
 *
 * ── No emoji, and that is not a style choice ─────────────────────────────
 * This file is edited by tooling that has already truncated a sibling to zero
 * bytes on an astral-plane character. Markers here are ASCII.
 *
 * Reads `DATABASE_URL` from the main checkout's `.env.local`, because a
 * worktree has no env of its own.
 */

import { readFileSync } from 'node:fs';

import { and, eq, like, lt, or, sql } from 'drizzle-orm';

/**
 * Returns false rather than throwing when there is no `DATABASE_URL`.
 *
 * Part one needs no database and is the half that stops this regression coming
 * back — `idle_timeout` shorter than a tick, `fetch_types` set, a `setInterval`
 * left in a sweep module. CI has no credentials, so a script that threw
 * without them could not enforce any of that, and the three rules most worth
 * enforcing would live only in whoever remembered them. Parts two and three
 * are then reported as **not exercised**, never as passed.
 */
function loadDatabaseUrl(): boolean {
  if ((process.env.DATABASE_URL ?? '') !== '') return true;

  for (const candidate of [
    'D:/School-Management-System/.env.local',
    '../../../.env.local',
    '.env.local',
  ]) {
    try {
      const match = /^DATABASE_URL=(.*)$/m.exec(readFileSync(candidate, 'utf8'));
      if (match?.[1] !== undefined) {
        process.env.DATABASE_URL = match[1].trim().replace(/^['"]|['"]$/g, '');
        console.log(`  using DATABASE_URL from ${candidate}`);
        return true;
      }
    } catch {
      // Try the next candidate.
    }
  }

  return false;
}

let passes = 0;
let failures = 0;
const notExercised: string[] = [];

function pass(label: string, detail = ''): void {
  passes += 1;
  console.log(`  ok    ${label}${detail === '' ? '' : ` — ${detail}`}`);
}

function fail(label: string, detail: string): void {
  failures += 1;
  console.error(`  FAIL  ${label}\n        ${detail}`);
}

function assert(label: string, condition: boolean, detail = ''): void {
  if (condition) pass(label);
  else fail(label, detail);
}

/** Reported as its own outcome, never as a pass. */
function skip(label: string, why: string): void {
  notExercised.push(`${label} — ${why}`);
  console.log(`  --    ${label} (not exercised: ${why})`);
}

/** The SQLSTATE lives on the error's `cause` chain, not on the error. */
function sqlState(error: unknown): string | null {
  let current: unknown = error;
  for (let depth = 0; depth < 6 && current != null; depth += 1) {
    const code = (current as { code?: unknown }).code;
    if (typeof code === 'string' && /^[0-9A-Z]{5}$/.test(code)) return code;
    current = (current as { cause?: unknown }).cause;
  }
  return null;
}

/** The reason, without postgres-js's copy of the whole statement. */
function reason(error: unknown): string {
  let current: unknown = error;
  for (let depth = 0; depth < 6 && current != null; depth += 1) {
    const message = (current as { message?: unknown }).message;
    if (typeof message === 'string' && !message.startsWith('Failed query')) {
      return (message.split('\n')[0] ?? message).slice(0, 160);
    }
    current = (current as { cause?: unknown }).cause;
  }
  return String(error).slice(0, 160);
}

/** Source text, always LF. */
function source(path: string): string {
  return readFileSync(path, 'utf8').replace(/\r\n/g, '\n');
}

/**
 * Source with every comment removed.
 *
 * -- Why this is not fussiness --------------------------------------------
 * The first run of this script reported R1 and R2 red against a file that had
 * already been fixed. `lib/postgres.ts` explains at length why `idle_timeout`
 * is no longer 20 and why `fetch_types` must never be set -- so it *contains*
 * the strings `idle_timeout: 20` and `fetch_types: false`, in prose, above the
 * code that does neither.
 *
 * A check that reads comments reports the documentation and not the
 * behaviour, and the better the documentation the more confidently it lies.
 */
function code(path: string): string {
  return source(path)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/[^\n]*/gm, '$1');
}

// ══ Part one — the settings ═══════════════════════════════════════════════

console.log('\nPart one — the connection settings, no database needed\n');

const postgresTs = code('lib/postgres.ts');
const schedulerTs = code('lib/scheduler.ts');

const idleTimeout = Number(/idle_timeout:\s*(\d+)/.exec(postgresTs)?.[1] ?? NaN);
const tickSeconds = Number(/export const TICK_SECONDS = (\d+);/.exec(schedulerTs)?.[1] ?? NaN);

assert(
  'R1  idle_timeout is comfortably longer than one scheduler tick',
  Number.isFinite(idleTimeout) && Number.isFinite(tickSeconds) && idleTimeout >= tickSeconds * 4,
  `idle_timeout=${String(idleTimeout)} TICK_SECONDS=${String(tickSeconds)} — ` +
    'a pool that cannot survive one tick opens a fresh connection for every ' +
    'sweep, and each one costs 446 catalogue rows',
);

assert(
  // Proven against the live database on 2026-09-20, not reasoned about:
  //   fetch_types=true    branches.class_levels -> ["PRE_SCHOOL", ...]  string[]
  //   fetch_types=false   branches.class_levels -> "{PRE_SCHOOL,...}"   string
  //   fetch_types=false   writing one           -> throws, malformed array literal
  // The read side is the dangerous half: no error, a string where every caller
  // expects an array, so `class_levels.includes('GRADE_1')` starts doing
  // substring matching and a campus quietly claims a grade it does not teach.
  'R2  fetch_types is not set (it skips the bootstrap AND breaks every array column)',
  !/fetch_types\s*:/.test(postgresTs),
  'lib/postgres.ts sets fetch_types. Six columns are arrays — branches.class_levels, ' +
    'principal_assignments.grade_ids, staff.saturday_ordinals, ' +
    'saturday_duty_policies.ordinals and two on staff_kpis — and that query is ' +
    'exactly what registers the array parsers.',
);

const SWEEP_MODULES = [
  'lib/email-outbox.ts',
  'lib/announcement-scheduler.ts',
  'lib/voucher-auto-send.ts',
  'lib/voucher-auto-generate.ts',
  'lib/sibling-discounts.ts',
  'lib/chat-digest.ts',
  'lib/holiday-notifier.ts',
  'lib/probation-notifier.ts',
];

const stillTiming = SWEEP_MODULES.filter((path) => /setInterval\s*\(/.test(code(path)));

assert(
  'R3  no sweep module keeps a setInterval of its own',
  stillTiming.length === 0,
  `${stillTiming.join(', ')} — one timer left behind is one that still runs in all seven processes`,
);

const instrumentation = code('instrumentation.ts');

assert(
  'R3  every sweep module is registered from instrumentation.ts',
  SWEEP_MODULES.every((path) => {
    const registrar = /export function (register\w+)\(\): void/.exec(code(path))?.[1];
    return registrar !== undefined && instrumentation.includes(`${registrar}()`);
  }),
  'a module that registers nothing has simply stopped running',
);

assert(
  'R3  startScheduler() is called after every registration',
  instrumentation.lastIndexOf('startScheduler()') > instrumentation.lastIndexOf('register'),
  'a sweep registered after the start line runs without appearing in the log line that lists them',
);

// ══ Parts two and three — against the real schema ═════════════════════════

if (!loadDatabaseUrl()) {
  skip('part two — the lease statement', 'no DATABASE_URL; part one is the half CI can run');
  skip('part three — mutual exclusion', 'no DATABASE_URL');
  console.log(
    `
  ${String(passes)} ok, ${String(failures)} failed, ${String(notExercised.length)} not exercised`,
  );
  for (const line of notExercised) console.log(`    not exercised: ${line}`);
  process.exit(failures > 0 ? 1 : 0);
}

const { drizzle } = await import('drizzle-orm/postgres-js');
const postgresJs = (await import('postgres')).default;
const schema = await import('../db/schema');

const client = postgresJs(process.env.DATABASE_URL ?? '', {
  max: 1,
  prepare: false,
  connect_timeout: 20,
});
const db = drizzle(client, { schema });
const { schedulerLeases } = schema;

/** `0051` applied? Read it, never be told it. */
async function tableExists(): Promise<boolean> {
  const [row] = await client<{ present: boolean }[]>`
    select to_regclass('public.scheduler_leases') is not null as present`;
  return row?.present === true;
}

/** The statement under test, exactly as `lib/scheduler.ts` builds it. */
function claim(owner: string, name: string, now: Date, ttlSeconds: number) {
  const expiresAt = new Date(now.getTime() + ttlSeconds * 1000);
  return db
    .insert(schedulerLeases)
    .values({ name, owner, acquiredAt: now, renewedAt: now, expiresAt })
    .onConflictDoUpdate({
      target: schedulerLeases.name,
      set: { owner, renewedAt: now, expiresAt },
      setWhere: or(eq(schedulerLeases.owner, owner), lt(schedulerLeases.expiresAt, now)),
    })
    .returning({ owner: schedulerLeases.owner });
}

const LEASE = 'check-scheduler:sweeps';
const CONTENDERS = Array.from({ length: 7 }, (_, i) => `check-scheduler:process-${String(i + 1)}`);

async function wipe(): Promise<void> {
  await db.delete(schedulerLeases).where(like(schedulerLeases.name, 'check-scheduler:%'));
}

let exitCode = 0;

try {
  const applied = await tableExists();
  console.log(`\n  migration 0051: ${applied ? 'APPLIED' : 'NOT applied'}`);

  console.log('\nPart two — the lease statement, executed against the real schema\n');

  if (!applied) {
    // Before the migration, exactly 42P01 and nothing else. Any other SQLSTATE
    // is a real defect wearing a predicted failure's clothes.
    try {
      await claim(CONTENDERS[0] ?? 'x', LEASE, new Date(), 120);
      fail(
        'the lease statement fails with 42P01 before 0051',
        'it succeeded, so scheduler_leases exists under another definition',
      );
    } catch (error) {
      const code = sqlState(error);
      assert(
        'the lease statement fails with exactly 42P01 before 0051',
        code === '42P01',
        `got ${code ?? '?'}: ${reason(error)}`,
      );
    }

    skip('part three — mutual exclusion', 'scheduler_leases does not exist yet; apply 0051');
    console.log('\n  Apply the migration, then run this again:');
    console.log('    node scripts/apply-0051.mjs --apply\n');
  } else {
    await wipe();

    // ── Executes and plans ────────────────────────────────────────────────
    try {
      const rows = await claim(CONTENDERS[0] ?? 'x', LEASE, new Date(), 120);
      pass('the lease statement plans and executes', `${String(rows.length)} row(s)`);
    } catch (error) {
      fail('the lease statement plans and executes', `${sqlState(error) ?? '?'} ${reason(error)}`);
    }

    await wipe();

    console.log('\nPart three — seven contenders at one lease\n');

    // ── Exactly one of seven wins a free lease ────────────────────────────
    const now = new Date();
    const firstRound = await Promise.all(
      CONTENDERS.map(async (owner) => ({
        owner,
        won: (await claim(owner, LEASE, now, 120)).length > 0,
      })),
    );
    const winners = firstRound.filter((r) => r.won);

    assert(
      'exactly one of seven contenders takes a free lease',
      winners.length === 1,
      `${String(winners.length)} won: ${winners.map((w) => w.owner).join(', ')} — ` +
        'more than one means the ON CONFLICT WHERE is not excluding anything, ' +
        'and every process would sweep',
    );

    const holder = winners[0]?.owner;

    if (holder === undefined) {
      skip('the holder renews', 'nobody won the first round, so there is no holder to renew');
      skip('acquired_at does not move on a renewal', 'no holder');
      skip('takeover of an expired lease', 'no holder');
    } else {
      const [before] = await db
        .select({ acquiredAt: schedulerLeases.acquiredAt, renewedAt: schedulerLeases.renewedAt })
        .from(schedulerLeases)
        .where(eq(schedulerLeases.name, LEASE));

      // ── The holder renews; the other six still get nothing ─────────────
      const later = new Date(Date.now() + 1500);
      const secondRound = await Promise.all(
        CONTENDERS.map(async (owner) => ({
          owner,
          won: (await claim(owner, LEASE, later, 120)).length > 0,
        })),
      );
      const secondWinners = secondRound.filter((r) => r.won).map((r) => r.owner);

      assert(
        'the holder renews and the other six get nothing',
        secondWinners.length === 1 && secondWinners[0] === holder,
        `won: ${secondWinners.join(', ') || '(nobody)'} — expected only ${holder}`,
      );

      // ── acquired_at is the takeover clock, renewed_at the liveness one ──
      const [after] = await db
        .select({ acquiredAt: schedulerLeases.acquiredAt, renewedAt: schedulerLeases.renewedAt })
        .from(schedulerLeases)
        .where(eq(schedulerLeases.name, LEASE));

      if (before === undefined || after === undefined) {
        skip('acquired_at does not move on a renewal', 'the lease row could not be read back');
      } else {
        assert(
          'a renewal moves renewed_at and leaves acquired_at alone',
          before.acquiredAt.getTime() === after.acquiredAt.getTime() &&
            after.renewedAt.getTime() > before.renewedAt.getTime(),
          `acquired ${before.acquiredAt.toISOString()} -> ${after.acquiredAt.toISOString()}, ` +
            `renewed ${before.renewedAt.toISOString()} -> ${after.renewedAt.toISOString()} — ` +
            'an acquired_at that moves on every renewal can never say how long a leader has held it',
        );
      }

      // ── An expired lease is taken over, by exactly one ──────────────────
      // Expire it the way a dead process does: leave the row, move the clock.
      await db
        .update(schedulerLeases)
        .set({ expiresAt: new Date(Date.now() - 60_000) })
        .where(eq(schedulerLeases.name, LEASE));

      // The holder is deliberately NOT among the contenders here. Letting it
      // race with the rest leaves the next assertion — that a displaced holder
      // cannot renew — dependent on who happens to win, and the first run of
      // this script reported it "not exercised" for exactly that reason. A
      // test that only sometimes tests something is a test nobody can read.
      const takeoverAt = new Date();
      const challengers = CONTENDERS.filter((owner) => owner !== holder);
      const thirdRound = await Promise.all(
        challengers.map(async (owner) => ({
          owner,
          won: (await claim(owner, LEASE, takeoverAt, 120)).length > 0,
        })),
      );
      const takers = thirdRound.filter((r) => r.won).map((r) => r.owner);

      assert(
        'exactly one of six takes over an expired lease',
        takers.length === 1,
        `${String(takers.length)} took it: ${takers.join(', ')} — ` +
          'zero means a dead leader stops every sweep for ever; more than one ' +
          'means the expiry branch does not exclude',
      );

      // ── And a stale holder cannot simply renew its way back in ──────────
      const newHolder = takers[0];
      if (newHolder === undefined) {
        skip('the displaced holder cannot renew', 'nobody took the lease over');
      } else {
        const displaced = await claim(holder, LEASE, new Date(), 120);
        assert(
          'the displaced holder cannot renew a lease it no longer owns',
          displaced.length === 0,
          `${holder} got a row back while ${newHolder} holds the lease — ` +
            'two leaders is the double-send the per-item claims then have to absorb alone',
        );
      }
    }

    // ── The real lease is untouched ───────────────────────────────────────
    const [real] = await db
      .select({ owner: schedulerLeases.owner, expiresAt: schedulerLeases.expiresAt })
      .from(schedulerLeases)
      .where(and(eq(schedulerLeases.name, 'sweeps'), sql`true`));

    console.log(
      real === undefined
        ? "\n  the live 'sweeps' lease: not yet claimed (no process has ticked since deploy)"
        : `\n  the live 'sweeps' lease: ${real.owner}, expires ${real.expiresAt.toISOString()}`,
    );

    await wipe();
  }
} catch (error) {
  fail('the run itself', `${sqlState(error) ?? '?'} ${reason(error)}`);
} finally {
  await client.end({ timeout: 10 });
}

console.log(`\n  ${String(passes)} ok, ${String(failures)} failed, ${String(notExercised.length)} not exercised`);
for (const line of notExercised) console.log(`    not exercised: ${line}`);

if (failures > 0) exitCode = 1;
process.exit(exitCode);
