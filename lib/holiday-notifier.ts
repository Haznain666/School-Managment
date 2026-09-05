import 'server-only';

import { and, eq, gte, lte } from 'drizzle-orm';

import { announcements, holidayNotifications, holidays, schools } from '@/db/schema';

import { sendAnnouncement } from './announcement-queries';
import { describeError } from './describe-error';
import { db } from './drizzle';
import {
  addDays,
  mergeConsecutive,
  parseIsoDate,
  toIsoDate,
  type HolidayBlock,
  type HolidayRange,
} from './holiday-calendar';

/**
 * The day-before holiday notice (Sprint 27, item B8).
 *
 * ── One notice per closure, not per holiday ──────────────────────────────
 * *"The school will be closed from Friday 30 October to Sunday 1 November for
 * Eid Milad-un-Nabi and Kashmir Day. Classes resume Monday 2 November."*
 *
 * That sentence is the requirement, and it dictates the design: the sweep
 * merges adjacent and overlapping rows into **blocks** — across a month
 * boundary and across two different holidays — and notifies the block. Three
 * notices for one closure is the outcome a per-holiday sweep produces, and a
 * parent who receives three stops reading the fourth.
 *
 * ── Claimed with an insert, because that is the shape that suits it ──────
 * Production runs seven schedulers. Every one of them wakes the evening before
 * Eid, computes the same block, and would send the same announcement.
 * CLAUDE.md's rule is *claimed, not checked*, and for a first-time event the
 * claim is `INSERT … ON CONFLICT DO NOTHING RETURNING id`: exactly one process
 * gets a row back and the other six do nothing. There is no read, no `if`, and
 * no window between them.
 *
 * **The claim is deleted on a throw.** It is taken before the announcement
 * exists, so a failure that left it behind would be a notice the school
 * believes went out and nobody received — the same contract `releaseClaim` has
 * in the two voucher sweepers, in the shape an insert takes.
 *
 * ── Weekend-only stretches are not a closure ─────────────────────────────
 * A holiday that covers only a Saturday and a Sunday tells a parent nothing
 * they did not know. Notifying it would train them to ignore the ones that
 * matter, which is the failure mode of every notification system that has one.
 */

/** How often the sweep looks. A minute is well inside "the day before". */
const SWEEP_SECONDS = 60;

let sweepTimer: NodeJS.Timeout | null = null;
let sweeping = false;

/** `2026-10-30` → `Friday 30 October`. */
function formatLongDate(iso: string): string {
  return parseIsoDate(iso).toLocaleDateString('en-GB', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    timeZone: 'UTC',
  });
}

/** Every distinct holiday name in a block, in the order they start. */
function namesIn(block: HolidayBlock): string {
  const names = [...new Set(block.holidays.map((holiday) => holiday.name))];

  if (names.length === 1) return names[0] ?? '';
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1] ?? ''}`;
}

/**
 * The notice, as a school would write it.
 *
 * "Classes resume" names the day **after** the block, not the next working day.
 * That is deliberate and it is the honest thing to say: whether the day after
 * is itself a Saturday somebody is on duty for depends on who is reading, and a
 * notice that told four hundred parents the wrong resumption day to be clever
 * about a rota would be worse than one that states the closure and stops.
 */
export function noticeFor(block: HolidayBlock): { title: string; body: string } {
  const single = block.startsOn === block.endsOn;
  const names = namesIn(block);

  const title = single
    ? `School closed — ${names}`
    : `School closed ${formatLongDate(block.startsOn)} to ${formatLongDate(block.endsOn)}`;

  const body = single
    ? `The school will be closed on ${formatLongDate(block.startsOn)} for ${names}. Classes resume ${formatLongDate(addDays(block.endsOn, 1))}.`
    : `The school will be closed from ${formatLongDate(block.startsOn)} to ${formatLongDate(block.endsOn)} for ${names}. Classes resume ${formatLongDate(addDays(block.endsOn, 1))}.`;

  return { title, body };
}

/** True when every day of a block is a Saturday or a Sunday. */
function isWeekendOnly(block: HolidayBlock): boolean {
  let cursor = block.startsOn;

  while (cursor <= block.endsOn) {
    const weekday = parseIsoDate(cursor).getUTCDay();
    if (weekday !== 0 && weekday !== 6) return false;
    cursor = addDays(cursor, 1);
  }

  return true;
}

/**
 * Blocks starting tomorrow, for one school.
 *
 * The window reaches **back** thirty days as well as forward, because a block
 * is only correct if every row that could merge into it is in the set. A
 * holiday running from the 28th into the 1st is what decides whether the 1st is
 * the start of a block or the middle of one, and reading only from tomorrow
 * would notify the middle of a closure the school is already in.
 */
async function blocksStartingTomorrow(
  locationId: string,
  tomorrow: string,
): Promise<HolidayBlock[]> {
  const rows = await db
    .select({
      id: holidays.id,
      name: holidays.name,
      startsOn: holidays.startsOn,
      endsOn: holidays.endsOn,
      branchId: holidays.branchId,
    })
    .from(holidays)
    .where(
      and(
        eq(holidays.locationId, locationId),
        // `gte` / `lte`, not a raw `sql` template — CLAUDE.md's rule, and the
        // reason scheduled announcements never released for eleven sprints.
        gte(holidays.endsOn, addDays(tomorrow, -30)),
        lte(holidays.startsOn, addDays(tomorrow, 30)),
      ),
    );

  return mergeConsecutive(rows as HolidayRange[]).filter(
    (block) => block.startsOn === tomorrow && !isWeekendOnly(block),
  );
}

/**
 * Takes the notice for one block, or reports that somebody else has it.
 *
 * The insert **is** the lock. Returning null is the ordinary outcome for six of
 * the seven processes and means nothing is wrong.
 */
async function claimBlock(
  locationId: string,
  block: HolidayBlock,
): Promise<string | null> {
  const claimed = await db
    .insert(holidayNotifications)
    .values({
      locationId,
      blockStart: block.startsOn,
      blockEnd: block.endsOn,
    })
    .onConflictDoNothing()
    .returning({ id: holidayNotifications.id });

  return claimed[0]?.id ?? null;
}

/** Hands a claim back, so tomorrow's tick retries. */
async function releaseClaim(claimId: string): Promise<void> {
  await db.delete(holidayNotifications).where(eq(holidayNotifications.id, claimId));
}

/**
 * One tick. Returns how many notices went out.
 *
 * Every school is worked inside its own try/catch: one school's failure must
 * not abandon the rest, and a throw here would reach a timer callback with
 * nothing to catch it.
 */
export async function sweepHolidayNotices(now: Date = new Date()): Promise<number> {
  const tomorrow = toIsoDate(new Date(now.getTime() + 86_400_000));

  const active = await db
    .select({ locationId: schools.locationId })
    .from(schools)
    .where(eq(schools.isActive, true));

  let sent = 0;

  for (const school of active) {
    try {
      const blocks = await blocksStartingTomorrow(school.locationId, tomorrow);

      for (const block of blocks) {
        const claimId = await claimBlock(school.locationId, block);
        if (claimId === null) continue;

        try {
          const notice = noticeFor(block);

          const [announcement] = await db
            .insert(announcements)
            .values({
              locationId: school.locationId,
              title: notice.title,
              body: notice.body,
              // Everybody. A closure is not a role's business — it is the
              // school's, and a parent who did not hear about it turns up.
              audience: { kind: 'all' },
              status: 'draft',
              // The notice board and the bell, not four hundred emails. A
              // school that wants this emailed sends it explicitly from
              // `/holidays/[holidayId]/notify`, which is what that route is for.
              sendEmail: false,
            })
            .returning({ id: announcements.id });

          if (announcement === undefined) {
            throw new Error('the announcement row was not written');
          }

          // `sendAnnouncement` claims the row, resolves the audience, writes the
          // notice rows and — since Sprint 27 — the bell. Reusing it is what
          // keeps one path deciding who gets what.
          await sendAnnouncement(school.locationId, announcement.id);

          await db
            .update(holidayNotifications)
            .set({ announcementId: announcement.id, sentAt: new Date() })
            .where(eq(holidayNotifications.id, claimId));

          sent += 1;

          console.info(
            `[holiday-notice] ${school.locationId}: ${block.startsOn}–${block.endsOn} announced`,
          );
        } catch (caught) {
          await releaseClaim(claimId).catch((error: unknown) => {
            console.error(
              `[holiday-notice] could not release the claim for ${school.locationId} ${block.startsOn}: ${describeError(error)}`,
            );
          });

          throw caught;
        }
      }
    } catch (caught) {
      console.error(
        `[holiday-notice] ${school.locationId} failed: ${describeError(caught)}`,
      );
    }
  }

  return sent;
}

/** Starts the sweep. Idempotent, like every other timer in this codebase. */
export function startHolidayNotifier(): void {
  if (sweepTimer !== null) return;

  sweepTimer = setInterval(() => {
    if (sweeping) return;
    sweeping = true;

    void sweepHolidayNotices()
      .then((sent) => {
        if (sent > 0) console.info(`[holiday-notice] ${String(sent)} notice(s) sent`);
      })
      .catch((caught: unknown) => {
        console.error(`[holiday-notice] sweep failed: ${describeError(caught)}`);
      })
      .finally(() => {
        sweeping = false;
      });
  }, SWEEP_SECONDS * 1000);

  // Never a reason to refuse to shut down.
  sweepTimer.unref?.();

  console.info(
    `[holiday-notice] holiday scheduler started (every ${String(SWEEP_SECONDS)}s)`,
  );
}
