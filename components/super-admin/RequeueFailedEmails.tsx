'use client';

import { useRouter } from 'next/navigation';
import { useCallback, useState } from 'react';

import { Button } from '@/components/ui/Button';
import { superAdminFetch, SuperAdminApiError } from '@/lib/super-admin-client';

export interface RequeueFailedEmailsProps {
  /** How many messages have been abandoned. Only rendered when above zero. */
  failed: number;
}

interface RequeueResult {
  requeued: number;
  sent: number;
  stillFailing: number;
}

/**
 * "Try the abandoned mail again", for after the SMTP credentials are fixed.
 *
 * ── The gap this closes ──────────────────────────────────────────────────
 * The outbox abandons a message after five attempts, which is correct for a
 * transient fault and wrong for the fault this queue actually gets: stale SMTP
 * credentials in the hosting panel. That is repaired by editing two environment
 * variables, and at the moment it is repaired the queue holds invitations that
 * will never be retried. Some of them have no resend button anywhere in the
 * product, so without this they are simply lost.
 *
 * ── Why the result is reported in this much detail ───────────────────────
 * The operator pressing this has just changed a credential and is asking "did
 * that work?". "Requeued 7" does not answer it. `sent` and `stillFailing` do,
 * and `stillFailing` above zero is the useful outcome — it means the panel
 * still holds the wrong value, which is worth knowing before they walk away
 * believing the outage is over.
 */
export function RequeueFailedEmails({ failed }: RequeueFailedEmailsProps) {
  const router = useRouter();
  const [isSending, setIsSending] = useState(false);
  const [result, setResult] = useState<RequeueResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const requeue = useCallback(async () => {
    setIsSending(true);
    setError(null);
    setResult(null);

    try {
      const outcome = await superAdminFetch<RequeueResult>(
        '/api/super-admin/email/requeue',
        { method: 'POST' },
      );
      setResult(outcome);
      // The card above is a server component reading the same table.
      router.refresh();
    } catch (caught) {
      setError(
        caught instanceof SuperAdminApiError
          ? caught.message
          : 'Could not requeue the abandoned messages.',
      );
    } finally {
      setIsSending(false);
    }
  }, [router]);

  if (failed === 0) return null;

  return (
    <div className="mt-3 space-y-2">
      <Button
        size="sm"
        variant="secondary"
        isLoading={isSending}
        onClick={() => {
          void requeue();
        }}
      >
        Retry {failed} abandoned {failed === 1 ? 'message' : 'messages'}
      </Button>

      <p className="text-xs text-ink-muted">
        Fix <code className="font-mono">SMTP_USER</code> and{' '}
        <code className="font-mono">SMTP_PASS</code> in the hosting panel first —
        this resends what was given up on, it does not repair the credentials.
      </p>

      {result !== null ? (
        <p
          role="status"
          className={
            result.stillFailing > 0
              ? 'text-sm text-status-danger-ink'
              : 'text-sm text-status-success-ink'
          }
        >
          {result.stillFailing > 0
            ? `Requeued ${result.requeued}, but ${result.stillFailing} failed again — the credentials are still wrong.`
            : `Requeued ${result.requeued} and sent ${result.sent}.`}
        </p>
      ) : null}

      {error !== null ? (
        <p role="alert" className="text-sm text-status-danger-ink">
          {error}
        </p>
      ) : null}
    </div>
  );
}
