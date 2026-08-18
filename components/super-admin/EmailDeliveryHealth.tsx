import { and, desc, eq, sql } from 'drizzle-orm';

import { emailOutbox, EMAIL_MAX_ATTEMPTS } from '@/db/schema';
import { Card, CardTitle } from '@/components/ui/Card';
import { db } from '@/lib/drizzle';

/**
 * Whether the platform's email is actually going out.
 *
 * ── Why this exists ──────────────────────────────────────────────────────
 * An SMTP misconfiguration is completely silent from every screen. Sprint 0's
 * outbox is doing its job — it accepts the message, retries with backoff and
 * records the reason — but the reason lives in `email_outbox.last_error` and
 * nothing renders it. On 2026-08-18 an invitation to a new principal sat
 * queued with `535 5.7.8 Error: authentication failed`, and the only way to
 * discover that was to query the database. From the product it looked like the
 * invitation had simply not been sent, which is exactly what a school would
 * report and exactly what nobody could act on.
 *
 * The outbox gives up after `EMAIL_MAX_ATTEMPTS` and the backoff spans roughly
 * two hours, so this is a card with a deadline on it: a queue that is failing
 * is a queue that will shortly be abandoned mail.
 *
 * ── It shows the error verbatim ──────────────────────────────────────────
 * `535 authentication failed` names the fix — the credentials — where a
 * friendlier "email could not be sent" would not. SMTP replies are terse but
 * they are precise, and the audience for this card is an operator.
 *
 * No secret can reach here: `last_error` holds a server's reply, and the
 * outbox never records a password.
 */
export async function EmailDeliveryHealth() {
  const [counts] = await db
    .select({
      queued: sql<number>`count(*) filter (where ${emailOutbox.status} = 'queued')`.mapWith(Number),
      failed: sql<number>`count(*) filter (where ${emailOutbox.status} = 'failed')`.mapWith(Number),
      sent: sql<number>`count(*) filter (where ${emailOutbox.status} = 'sent')`.mapWith(Number),
      // Queued *and* already refused at least once. A plain queued count would
      // include mail that is simply waiting its turn, which is not a problem.
      struggling: sql<number>`count(*) filter (where ${emailOutbox.status} = 'queued' and ${emailOutbox.attempts} > 0)`.mapWith(
        Number,
      ),
    })
    .from(emailOutbox);

  const recentError = await db
    .select({
      toAddress: emailOutbox.toAddress,
      subject: emailOutbox.subject,
      attempts: emailOutbox.attempts,
      lastError: emailOutbox.lastError,
    })
    .from(emailOutbox)
    .where(and(eq(emailOutbox.status, 'queued'), sql`${emailOutbox.attempts} > 0`))
    // `scheduled_at` moves forward on every failed attempt (the backoff), so
    // it is the closest thing this table has to "most recently tried". There is
    // no `updated_at` column.
    .orderBy(desc(emailOutbox.scheduledAt))
    .limit(1);

  const struggling = counts?.struggling ?? 0;
  const failed = counts?.failed ?? 0;
  const problem = recentError[0];

  // Nothing queued badly and nothing abandoned: say so in one line and stop.
  // A dashboard card that is loud when everything is fine trains people to
  // ignore it on the day it is not.
  if (struggling === 0 && failed === 0) {
    return (
      <Card header={<CardTitle title="Email delivery" />}>
        <p className="text-sm text-ink-muted">
          {counts?.sent ?? 0} message{(counts?.sent ?? 0) === 1 ? '' : 's'} sent,
          nothing stuck.
        </p>
      </Card>
    );
  }

  return (
    <Card
      header={
        <CardTitle
          title="Email delivery is failing"
          description="Invitations, sign-in emails and fee notices are queued and not going out."
        />
      }
    >
      <p className="text-sm text-status-danger-ink">
        {struggling > 0
          ? `${struggling} message${struggling === 1 ? '' : 's'} queued after a failed attempt.`
          : null}{' '}
        {failed > 0
          ? `${failed} abandoned after ${EMAIL_MAX_ATTEMPTS} attempts.`
          : null}
      </p>

      {problem === undefined ? null : (
        <div className="mt-3 rounded-lg bg-surface-sunken p-3">
          <p className="text-xs uppercase tracking-wide text-ink-muted">
            What the mail server said
          </p>
          <p className="mt-1 break-words font-mono text-xs text-ink">
            {problem.lastError ?? 'No reason was recorded.'}
          </p>
          <p className="mt-2 text-xs text-ink-muted">
            Most recent: &ldquo;{problem.subject}&rdquo; to {problem.toAddress},
            attempt {problem.attempts} of {EMAIL_MAX_ATTEMPTS}.
          </p>
        </div>
      )}

      <p className="mt-3 text-sm text-ink-muted">
        A <span className="font-mono">535</span> or{' '}
        <span className="font-mono">authentication failed</span> reply means{' '}
        <span className="font-mono">SMTP_USER</span> or{' '}
        <span className="font-mono">SMTP_PASS</span> is wrong in the hosting
        panel. Queued mail is retried with backoff and abandoned after{' '}
        {EMAIL_MAX_ATTEMPTS} attempts — roughly two hours — so fixing the
        credentials sooner means the queued messages go out on their own rather
        than needing to be re-sent.
      </p>
    </Card>
  );
}
