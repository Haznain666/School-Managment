import 'server-only';

import { listDueAnnouncements, sendAnnouncement } from './announcement-queries';
import { describeError } from './describe-error';
import { registerSweep } from './scheduler';

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
        `[announcements] ${row.id} could not be sent: ${describeError(caught)}`,
      );
    }
  }

  return sent;
}

/**
 * Registers the sweep with the shared scheduler.
 *
 * ── Why this is no longer a timer of its own ─────────────────────────────
 * It used to be `setInterval` in every server process, and Hostinger runs
 * seven. `lib/scheduler.ts` now owns the one timer this application has, and
 * only the process holding the lease runs what is registered here. The claims
 * inside the sweep are untouched and still decide who does what — the lease is
 * a second guard, not a replacement.
 *
 * Re-entrancy, `unref()` and the never-throw guarantee all moved to the
 * scheduler with it.
 */
export function registerAnnouncementSweep(): void {
  registerSweep('announcements', SWEEP_SECONDS, async () => {
    const sent = await sweepScheduledAnnouncements();
    if (sent > 0) console.info(`[announcements] released ${String(sent)} scheduled`);
  });
}
