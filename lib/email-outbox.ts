import 'server-only';

import { eq } from 'drizzle-orm';

import { emailOutbox, EMAIL_MAX_ATTEMPTS } from '@/db/schema';

import { db } from './drizzle';
import { sendEmail, smtpConfigured } from './email-sender';
import { getSql } from './postgres';

/**
 * The outbound email queue.
 *
 * ── What moved, and what did not ─────────────────────────────────────────
 * `lib/email-sender.ts` is still the only transport; nothing here speaks SMTP.
 * What changed is who calls it. A request now writes a row and returns in
 * milliseconds; this module is what eventually hands that row to the transport,
 * outside any request, where taking ~103 seconds is merely slow rather than a
 * spinner an operator is watching.
 *
 * ── Two things drive the drain, on purpose ───────────────────────────────
 * An interval inside the Node process (`instrumentation.ts`), because Hostinger
 * runs one persistent process and that is the whole reason this design works
 * here at all. And `POST /api/internal/email/drain` behind a shared secret, so
 * that when the queue outgrows a single process — or the process is restarted
 * by the host at an awkward moment — a plain cron can drive it without any of
 * this changing. Neither can double-send; see the claim below.
 *
 * ── Why the claim is hand-written SQL ────────────────────────────────────
 * `FOR UPDATE SKIP LOCKED` over a subselect is the one thing Drizzle's builder
 * cannot express, and it is exactly the thing that makes two drainers safe:
 * each one locks the rows it selected and *skips* rows the other already holds,
 * so the same message is never handed to SMTP twice. Selecting and then
 * updating in two statements would race, and a duplicated fee notice to a
 * parent is not a cosmetic bug.
 */

/**
 * How long a row may sit in `sending` before it is assumed abandoned.
 *
 * A process killed mid-send leaves its claim behind — the row is `sending`, no
 * lock is held, and nothing will ever touch it again. Fifteen minutes is
 * comfortably longer than the slowest send measured (~103s) plus the
 * transport's own 20-second socket ceiling, so a reclaim cannot race a send
 * that is merely slow.
 *
 * Age is measured from `scheduled_at`, which the claim resets to `now()` for
 * exactly this purpose: without that, a message enqueued an hour ago would
 * look abandoned the instant it was claimed, and a second drainer would take
 * it back mid-send. The column therefore means "not before this time" while
 * queued and "claimed at this time" while sending.
 */
const RECLAIM_MINUTES = 15;

/**
 * Minutes to wait before retry number N (1-indexed by `attempts`).
 *
 * Backing off matters more than usual here: the failure this queue actually
 * sees is a slow or refusing SMTP host, and retrying that immediately in a loop
 * is how a queue turns one bad hour into a rate-limit ban from the provider.
 * The last value repeats for any further attempt.
 */
const BACKOFF_MINUTES = [1, 5, 15, 60] as const;

export interface EnqueueEmailInput {
  /** The school this message belongs to, or null for platform mail. */
  locationId: string | null;
  to: string;
  subject: string;
  text: string;
}

/**
 * Adds one message to the queue.
 *
 * Returns the row id so a caller can report or log it. Throws only if the
 * INSERT itself fails, which is a real database problem and not something to
 * paper over — the caller has just told a user their message is on its way.
 */
export async function enqueueEmail(input: EnqueueEmailInput): Promise<string> {
  const inserted = await db
    .insert(emailOutbox)
    .values({
      locationId: input.locationId,
      toAddress: input.to.trim(),
      subject: input.subject,
      bodyText: input.text,
    })
    .returning({ id: emailOutbox.id });

  const id = inserted[0]?.id;
  if (id === undefined) {
    throw new Error('The message could not be queued.');
  }

  return id;
}

/**
 * Puts abandoned messages back on the queue.
 *
 * ── Why this is needed at all ────────────────────────────────────────────
 * The outbox gives up after `EMAIL_MAX_ATTEMPTS` and marks the row `failed`.
 * That is right while the fault is transient — retrying a refusing host forever
 * is how a queue earns a rate-limit ban. But the fault this queue actually sees
 * is a *credential* one: on 2026-08-18 every message since the 13th had failed
 * with `535 authentication failed`, because the SMTP user or password in the
 * hosting panel had gone stale.
 *
 * That fault is fixed by editing two environment variables, and at the moment
 * it is fixed the queue is full of mail that will never be tried again. Without
 * this, every one of those invitations has to be found and re-sent by hand from
 * whichever screen created it — and some of them, like the invitation flow, do
 * not offer a resend at all.
 *
 * ── Why attempts is reset rather than incremented ────────────────────────
 * A requeue is a statement that the *cause* has changed, not that the message
 * deserves one more go. Leaving `attempts` at its ceiling would have the
 * drainer abandon the row again on its first failure, which defeats the point.
 * `scheduled_at` is set to now so it goes out on the next drain rather than
 * inheriting an old backoff.
 *
 * `last_error` is deliberately kept. It is the record of why the message sat
 * there, and clearing it would erase the only evidence of an outage that has
 * just been fixed.
 */
export async function requeueFailedEmails(): Promise<number> {
  const requeued = await db
    .update(emailOutbox)
    .set({ status: 'queued', attempts: 0, scheduledAt: new Date() })
    .where(eq(emailOutbox.status, 'failed'))
    .returning({ id: emailOutbox.id });

  if (requeued.length > 0) {
    console.info(`[email-outbox] requeued ${requeued.length} abandoned message(s)`);
  }

  return requeued.length;
}

export interface DrainResult {
  claimed: number;
  sent: number;
  failed: number;
  /** Rows returned to the queue after a crashed drainer left them claimed. */
  reclaimed: number;
}

interface ClaimedRow {
  id: string;
  to_address: string;
  subject: string;
  body_text: string;
  attempts: number;
}

/**
 * Sends up to `limit` due messages.
 *
 * Safe to run concurrently with itself and with the internal route: the claim
 * is atomic and skips locked rows.
 *
 * Never throws. It is called from an unattended interval, where an unhandled
 * rejection takes the whole Node process down on Hostinger, and from a route
 * that reports rather than propagates.
 */
export async function drainOutbox(limit = 20): Promise<DrainResult> {
  const result: DrainResult = { claimed: 0, sent: 0, failed: 0, reclaimed: 0 };

  // Nothing is claimed when there is nowhere to send it. Claiming and failing
  // would burn all five attempts against a misconfiguration that a single
  // environment variable fixes, and the queue would be empty of anything
  // recoverable by the time anyone noticed.
  if (!smtpConfigured()) return result;

  const sql = getSql();

  try {
    const reclaimed = await sql`
      UPDATE email_outbox
         SET status = 'queued'
       WHERE status = 'sending'
         AND scheduled_at < now() - (${RECLAIM_MINUTES} || ' minutes')::interval
      RETURNING id
    `;
    result.reclaimed = reclaimed.length;
  } catch (error) {
    console.warn('[email-outbox] could not reclaim abandoned rows:', error);
  }

  let rows: ClaimedRow[];

  try {
    // One statement: pick the oldest due rows, lock them, skip anything another
    // drainer already holds, and mark them `sending` before releasing. A row is
    // now owned by exactly one drainer.
    rows = (await sql`
      UPDATE email_outbox
         SET status = 'sending',
             attempts = attempts + 1,
             scheduled_at = now()
       WHERE id IN (
             SELECT id
               FROM email_outbox
              WHERE status = 'queued'
                AND scheduled_at <= now()
              ORDER BY scheduled_at
              LIMIT ${limit}
                FOR UPDATE SKIP LOCKED
             )
      RETURNING id, to_address, subject, body_text, attempts
    `) as unknown as ClaimedRow[];
  } catch (error) {
    console.warn('[email-outbox] could not claim rows:', error);
    return result;
  }

  result.claimed = rows.length;

  // Sequential, not `Promise.all`. The transport opens its own SMTP connection
  // per send and the host this talks to is slow under one; twenty at once is
  // how a shared mailbox account gets throttled or blocked outright.
  for (const row of rows) {
    try {
      await sendEmail(row.to_address, row.subject, row.body_text);

      await db
        .update(emailOutbox)
        .set({ status: 'sent', sentAt: new Date(), lastError: null })
        .where(eq(emailOutbox.id, row.id));

      result.sent += 1;
    } catch (error) {
      const reason = error instanceof Error ? error.message : 'Unknown transport error';
      const exhausted = row.attempts >= EMAIL_MAX_ATTEMPTS;

      // The error is kept either way, because "it failed" without the reason
      // is what makes a queue unmaintainable.
      await db
        .update(emailOutbox)
        .set(
          exhausted
            ? { status: 'failed', lastError: reason }
            : { status: 'queued', lastError: reason, scheduledAt: nextAttemptAt(row.attempts) },
        )
        .where(eq(emailOutbox.id, row.id))
        .catch((updateError: unknown) => {
          // Left `sending`; the reclaim above picks it up in fifteen minutes.
          console.warn('[email-outbox] could not record a failure:', updateError);
        });

      if (exhausted) result.failed += 1;

      console.warn(
        `[email-outbox] send failed for ${row.id} (attempt ${row.attempts}/${EMAIL_MAX_ATTEMPTS}):`,
        reason,
      );
    }
  }

  return result;
}

function nextAttemptAt(attempts: number): Date {
  const minutes =
    BACKOFF_MINUTES[Math.min(attempts, BACKOFF_MINUTES.length) - 1] ??
    BACKOFF_MINUTES[BACKOFF_MINUTES.length - 1] ??
    60;

  return new Date(Date.now() + minutes * 60 * 1000);
}

/** Seconds between in-process drains. */
const DRAIN_INTERVAL_SECONDS = 30;

let drainTimer: ReturnType<typeof setInterval> | null = null;
let draining = false;

/**
 * Starts the in-process drainer. Called once from `instrumentation.ts`.
 *
 * ── Why an interval is enough ────────────────────────────────────────────
 * Hostinger runs this as one long-lived Node process — the same fact that
 * makes `output: 'standalone'` the right build target. There is no fleet to
 * coordinate and no cold start to lose a timer to, so the simplest thing that
 * could work is also the correct thing. If that ever stops being true, the
 * internal route already exists and a host cron drives the same function.
 *
 * ── The guards ───────────────────────────────────────────────────────────
 * `drainTimer` makes a second call a no-op, because Next's dev server
 * re-evaluates modules and two timers would double the send rate for no
 * reason. `draining` means a slow drain never overlaps itself — with a
 * ~103-second transport, a 30-second interval otherwise stacks drainers until
 * the process falls over.
 *
 * `unref()` so the timer never holds the process open on its own; a queue is
 * not a reason to refuse to shut down.
 */
export function startOutboxDrainer(): void {
  if (drainTimer !== null) return;

  drainTimer = setInterval(() => {
    if (draining) return;
    draining = true;

    void drainOutbox()
      .then((result) => {
        if (result.claimed > 0) {
          console.info(
            `[email-outbox] drained ${result.sent}/${result.claimed} (${result.failed} abandoned)`,
          );
        }
      })
      .finally(() => {
        draining = false;
      });
  }, DRAIN_INTERVAL_SECONDS * 1000);

  drainTimer.unref?.();

  console.info(`[email-outbox] drainer started (every ${DRAIN_INTERVAL_SECONDS}s)`);
}
