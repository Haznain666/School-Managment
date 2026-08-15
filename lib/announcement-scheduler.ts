import 'server-only';

import { listDueAnnouncements, sendAnnouncement } from './announcement-queries';

/**
 * Releases scheduled announcements when their time comes.
 *
 * ── Why a timer and not cron ─────────────────────────────────────────────
 * Hostinger's shared plan has no cron this application can rely on, and
 * `instrumentation.ts` is the only place this codebase may start background
 * work. So this is a second interval alongside the outbox drainer, held to the
 * same bar: idempotent, never holds the process open, never throws into the
 * runtime.
 *
 * ── Why "due at or before now", never "due in the last N minutes" ────────
 * A process that was down for an hour must send the backlog when it comes
 * back, not skip it. A window would silently drop exactly the announcements a
 * school scheduled for the moment the process happened to be restarting, and
 * nothing would ever report it — the announcement would simply sit as
 * "scheduled" forever with its time in the past.
 *
 * ── Why sends are sequential ─────────────────────────────────────────────
 * Each send resolves an audience and writes a delivery row per person. Running
 * a dozen at once on a shared plan is how one school's assembly notice makes
 * every other school's page slow. The queue is not urgent to the minute; it is
 * urgent to the hour.
 */

/** How often the scheduler looks. A minute is well inside "the right hour". */
const SWEEP_SECONDS = 60;

let sweepTimer: NodeJS.Timeout | null = null;
let sweeping = false;

/**
 * Sends everything that is due. Returns how many went out.
 *
 * Each announcement is sent inside its own try/catch: one school's send
 * failing must not abandon the rest of the queue, and a throw here would reach
 * a timer callback with nothing to catch it.
 */
export async function sweepScheduledAnnouncements(now: Date = new Date()): Promise<number> {
  const due = await listDueAnnouncements(now);
  let sent = 0;

  for (const row of due) {
    try {
      const outcome = await sendAnnouncement(row.locationId, row.id);
      if (outcome !== null) sent += 1;
    } catch (caught) {
      // Left as `scheduled`, so the next sweep tries again. An announcement
      // that silently gave up would be one a school believes went out.
      console.error(
        `[announcements] ${row.id} could not be sent: ${
          caught instanceof Error ? caught.message : String(caught)
        }`,
      );
    }
  }

  return sent;
}

/** Starts the sweep. Idempotent, like the outbox drainer beside it. */
export function startAnnouncementScheduler(): void {
  if (sweepTimer !== null) return;

  sweepTimer = setInterval(() => {
    if (sweeping) return;
    sweeping = true;

    void sweepScheduledAnnouncements()
      .then((sent) => {
        if (sent > 0) console.info(`[announcements] released ${sent} scheduled`);
      })
      .catch((caught: unknown) => {
        console.error(
          `[announcements] sweep failed: ${
            caught instanceof Error ? caught.message : String(caught)
          }`,
        );
      })
      .finally(() => {
        sweeping = false;
      });
  }, SWEEP_SECONDS * 1000);

  // Never a reason to refuse to shut down.
  sweepTimer.unref?.();

  console.info(`[announcements] scheduler started (every ${SWEEP_SECONDS}s)`);
}
