import { apiFailure, apiSuccess, handleApiError } from '@/lib/api-response';
import { drainOutbox, requeueFailedEmails } from '@/lib/email-outbox';
import { smtpConfigured } from '@/lib/email-sender';
import { requireSuperAdmin } from '@/lib/super-admin-guard';

/**
 * POST /api/super-admin/email/requeue
 *
 * Puts every abandoned message back on the queue and drains once immediately.
 *
 * ── Why the drain is part of the same press ──────────────────────────────
 * The operator pressing this has just fixed the SMTP credentials and wants to
 * know whether that worked. Requeuing alone would answer "42 messages are back
 * in the queue", which is not the question — the in-process drainer runs every
 * thirty seconds, so they would then sit refreshing a card. Draining here means
 * the response can say how many actually went out, which either confirms the
 * fix or hands back the SMTP server's new complaint.
 *
 * The drain is bounded and never throws (see `drainOutbox`), and it is safe to
 * run beside the interval drainer: the claim is `FOR UPDATE SKIP LOCKED`, so
 * the two cannot hand the same row to SMTP twice.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST() {
  try {
    await requireSuperAdmin();

    // Checked before anything is requeued. Requeuing into a transport that does
    // not exist would burn every message's attempts again and leave the queue
    // in exactly the state it started in, only with the history overwritten.
    if (!smtpConfigured()) {
      return apiFailure(
        'misconfigured',
        'No SMTP transport is configured, so there is nowhere to send. Set ' +
          'SMTP_HOST and SMTP_FROM in the hosting panel first.',
        500,
      );
    }

    const requeued = await requeueFailedEmails();
    const drained = await drainOutbox();

    return apiSuccess({
      requeued,
      sent: drained.sent,
      // Still failing after a requeue means the credentials are not fixed yet.
      // Worth returning plainly rather than reporting the requeue as a success.
      stillFailing: drained.failed,
    });
  } catch (error) {
    return handleApiError(error);
  }
}
