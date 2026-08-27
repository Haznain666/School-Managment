import 'server-only';

import { and, eq, inArray, isNull, lt, or } from 'drizzle-orm';

import {
  feeChallanItems,
  feeChallans,
  lateFeeRules,
  schoolUsers,
  studentProfiles,
  OPEN_CHALLAN_STATUSES,
} from '@/db/schema';

import { formatMonthYear } from './dates';
import { describeError } from './describe-error';
import { db } from './drizzle';
import { sendFeeVouchers, type FeeVoucherNotice } from './fee-notices';
import { toDateOnly } from './fee-queries';

/**
 * Emailing the month's vouchers on a timer (Sprint 18, item 17).
 *
 * ── What it does, and the one thing it will never do ─────────────────────
 * On the day a school chooses, it emails **the vouchers the school has already
 * raised** for the current month to each student's primary contact. It never
 * *generates* one. Raising money demands on a timer is not a thing to ship
 * without being asked, and a school whose bulk run had not happened yet would
 * otherwise find that a scheduler had decided its billing for it.
 *
 * ── Claimed, not checked ─────────────────────────────────────────────────
 * `instrumentation.ts` starts one of these per server process and production
 * runs **seven** — visible in the log as seven distinct 60-second offsets in
 * the same minute. A read followed by an `if` lets all seven pass the same test
 * and send the same school's parents the same email seven times.
 *
 * So a school is claimed with a conditional `UPDATE … RETURNING`:
 * `auto_send_last_run_on` moves to today only where it is null or earlier, and
 * Postgres decides that on one row under one lock. Exactly one process gets the
 * row; the other six get nothing back and do nothing. CLAUDE.md's rule, and
 * this is the whole of it.
 *
 * **Claim first, then hand it back on a throw.** Claiming moves the row before
 * the work is done, so a failure that did not revert would be recorded as a
 * send: the school would believe its parents were written to and nobody would
 * ever be told otherwise. `releaseClaim` below says what the revert writes and
 * why that is the honest value.
 */

/** The 28th, so every month has the day. */
export const DEFAULT_AUTO_SEND_DAY = 28;

/** How often the sweep looks. A minute is well inside "the right day". */
const SWEEP_SECONDS = 60;

let sweepTimer: NodeJS.Timeout | null = null;
let sweeping = false;

/** One school the sweep has taken ownership of for today. */
interface Claim {
  locationId: string;
}

/**
 * Takes today's send for every school due one, and returns what it took.
 *
 * The `WHERE` is the whole design: the school has the feature on, today is its
 * chosen day, and it has not already run today. Any process losing the race
 * simply gets fewer rows back.
 */
async function claimSchools(today: string, dayOfMonth: number): Promise<Claim[]> {
  return db
    .update(lateFeeRules)
    .set({ autoSendLastRunOn: today })
    .where(
      and(
        eq(lateFeeRules.autoSendVouchers, true),
        eq(lateFeeRules.autoSendDay, dayOfMonth),
        or(
          isNull(lateFeeRules.autoSendLastRunOn),
          // `lt`, not a raw `sql` template. A comparison against a column goes
          // through the operator so the value is mapped for the driver — see
          // CLAUDE.md, and the scheduled announcements that never released.
          lt(lateFeeRules.autoSendLastRunOn, today),
        ),
      ),
    )
    .returning({ locationId: lateFeeRules.locationId });
}

/**
 * Hands a claim back, so a transient failure is not recorded as a send.
 *
 * Set to **null**, not to the value it held before. `RETURNING` gives the new
 * row, so recovering the old one would mean reading it first — which is the
 * read-then-check this whole design exists to avoid. Null is the honest and
 * sufficient value: the column means exactly one thing to the claim, "not
 * today", and null passes that test. What is lost is the memory of last
 * month's successful run, which nothing reads.
 */
async function releaseClaim(claim: Claim): Promise<void> {
  await db
    .update(lateFeeRules)
    .set({ autoSendLastRunOn: null })
    .where(eq(lateFeeRules.locationId, claim.locationId));
}

/**
 * The current month's open vouchers for one school, as email notices.
 *
 * Open only: a voucher already paid is not a demand, and a parent who settled
 * on the 3rd should not be written to on the 28th about it. Cancelled and
 * waived are excluded by the same rule.
 */
async function noticesFor(
  locationId: string,
  month: number,
  year: number,
): Promise<FeeVoucherNotice[]> {
  const rows = await db
    .select({
      id: feeChallans.id,
      challanNumber: feeChallans.challanNumber,
      studentProfileId: feeChallans.studentProfileId,
      studentName: schoolUsers.name,
      dueDate: feeChallans.dueDate,
      totalAmount: feeChallans.totalAmount,
    })
    .from(feeChallans)
    .innerJoin(studentProfiles, eq(studentProfiles.id, feeChallans.studentProfileId))
    .innerJoin(schoolUsers, eq(schoolUsers.id, studentProfiles.schoolUserId))
    .where(
      and(
        eq(feeChallans.locationId, locationId),
        eq(feeChallans.billingMonth, month),
        eq(feeChallans.billingYear, year),
        inArray(feeChallans.status, [...OPEN_CHALLAN_STATUSES]),
      ),
    );

  if (rows.length === 0) return [];

  const items = await db
    .select({
      challanId: feeChallanItems.challanId,
      description: feeChallanItems.description,
      netAmount: feeChallanItems.netAmount,
      concessionDetail: feeChallanItems.concessionDetail,
    })
    .from(feeChallanItems)
    .where(
      and(
        eq(feeChallanItems.locationId, locationId),
        inArray(
          feeChallanItems.challanId,
          rows.map((row) => row.id),
        ),
      ),
    );

  return rows.map((row) => ({
    studentProfileId: row.studentProfileId,
    studentName: row.studentName,
    challanNumber: row.challanNumber,
    periodLabel: formatMonthYear(month, year),
    dueDate: row.dueDate,
    totalAmount: row.totalAmount,
    items: items.filter((item) => item.challanId === row.id),
  }));
}

/**
 * One tick. Returns how many schools were sent for.
 *
 * Each school is claimed, worked and — on a throw — released, inside its own
 * try/catch: one school's failure must not abandon the rest, and a throw here
 * would reach a timer callback with nothing to catch it.
 */
export async function sweepAutoSendVouchers(now: Date = new Date()): Promise<number> {
  const today = toDateOnly(now);
  const claims = await claimSchools(today, now.getDate());

  let sent = 0;

  for (const claim of claims) {
    try {
      const notices = await noticesFor(
        claim.locationId,
        now.getMonth() + 1,
        now.getFullYear(),
      );

      // Nothing open is a legitimate outcome — a school that has not run its
      // billing yet, or one whose parents have all paid. The claim stands: the
      // day's send happened and found nothing, and re-running it every minute
      // until midnight would be worse than useless.
      if (notices.length > 0) {
        await sendFeeVouchers(db, claim.locationId, notices);
        sent += 1;
      }

      console.info(
        `[auto-send] ${claim.locationId}: ${String(notices.length)} voucher email(s) queued`,
      );
    } catch (caught) {
      // Handed back, so tomorrow's tick — or the next process's — tries again.
      await releaseClaim(claim).catch((error: unknown) => {
        console.error(
          `[auto-send] could not release the claim for ${claim.locationId}: ${describeError(error)}`,
        );
      });

      console.error(
        `[auto-send] ${claim.locationId} failed: ${describeError(caught)}`,
      );
    }
  }

  return sent;
}

/** Starts the sweep. Idempotent, like the outbox drainer beside it. */
export function startVoucherAutoSend(): void {
  if (sweepTimer !== null) return;

  sweepTimer = setInterval(() => {
    if (sweeping) return;
    sweeping = true;

    void sweepAutoSendVouchers()
      .then((sent) => {
        if (sent > 0) console.info(`[auto-send] sent for ${String(sent)} school(s)`);
      })
      .catch((caught: unknown) => {
        console.error(`[auto-send] sweep failed: ${describeError(caught)}`);
      })
      .finally(() => {
        sweeping = false;
      });
  }, SWEEP_SECONDS * 1000);

  // Never a reason to refuse to shut down.
  sweepTimer.unref?.();

  console.info(`[auto-send] voucher scheduler started (every ${String(SWEEP_SECONDS)}s)`);
}
