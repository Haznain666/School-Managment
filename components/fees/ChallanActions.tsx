'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { Button } from '@/components/ui/Button';
import { schoolErrorMessage, schoolFetch } from '@/lib/school-client';

/**
 * The actions available on one challan.
 *
 * Print is a browser call rather than a server round trip — the print view is
 * already rendered into the page and `@media print` reveals it, so there is no
 * document to fetch and no PDF to generate.
 *
 * Cancel and waive both destroy a school's ability to collect on a bill, so
 * both sit behind a confirmation. Cancel is refused server-side once money has
 * been taken; the button says so rather than letting the user find out.
 */

export interface ChallanActionsProps {
  challanId: string;
  status: string;
  hasPayments: boolean;
  hasGuardian: boolean;
  canWrite: boolean;
  lateFeesEnabled: boolean;
  isOverdue: boolean;
}

export function ChallanActions({
  challanId,
  status,
  hasPayments,
  hasGuardian,
  canWrite,
  lateFeesEnabled,
  isOverdue,
}: ChallanActionsProps) {
  const router = useRouter();

  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const isOpen = status === 'unpaid' || status === 'partial';

  const patch = async (
    action: string,
    body: Record<string, unknown>,
    successMessage: string,
  ): Promise<void> => {
    setBusy(action);
    setError(null);
    setNotice(null);

    try {
      await schoolFetch(`/api/school/fees/challans/${challanId}`, {
        method: 'PATCH',
        body: JSON.stringify(body),
      });
      setNotice(successMessage);
      router.refresh();
    } catch (caught) {
      setError(schoolErrorMessage(caught, 'That action could not be completed.'));
    } finally {
      setBusy(null);
    }
  };

  const sendReminder = async (): Promise<void> => {
    setBusy('remind');
    setError(null);
    setNotice(null);

    try {
      const result = await schoolFetch<{ queued: number; noGuardian: number }>(
        '/api/school/fees/reminders',
        { method: 'POST', body: JSON.stringify({ challanIds: [challanId] }) },
      );

      setNotice(
        result.queued > 0
          ? 'Reminder queued for the primary guardian.'
          : 'No reminder was sent — this voucher has no guardian on file, or nothing is owed.',
      );
    } catch (caught) {
      setError(schoolErrorMessage(caught, 'Could not send the reminder.'));
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-3">
        <Button
          variant="secondary"
          onClick={() => {
            window.print();
          }}
        >
          Print challan
        </Button>

        {canWrite && isOpen ? (
          <Button
            onClick={() => {
              router.push(`/dashboard/fees/challans/${challanId}/record-payment`);
            }}
          >
            Record payment
          </Button>
        ) : null}

        {canWrite && isOpen ? (
          <Button
            variant="secondary"
            disabled={!hasGuardian}
            title={hasGuardian ? undefined : 'No guardian is recorded for this student.'}
            isLoading={busy === 'remind'}
            onClick={() => {
              void sendReminder();
            }}
          >
            Send reminder
          </Button>
        ) : null}

        {canWrite && isOpen && lateFeesEnabled && isOverdue ? (
          <Button
            variant="secondary"
            isLoading={busy === 'lateFee'}
            onClick={() => {
              void patch(
                'lateFee',
                { applyLateFee: true },
                'The late fee has been added to this challan.',
              );
            }}
          >
            Apply late fee
          </Button>
        ) : null}

        {canWrite && isOpen ? (
          <Button
            variant="ghost"
            isLoading={busy === 'waive'}
            onClick={() => {
              if (
                window.confirm(
                  'Waive this voucher? The outstanding balance will no longer be collectable.',
                )
              ) {
                void patch('waive', { action: 'waive' }, 'This voucher has been waived.');
              }
            }}
          >
            Waive
          </Button>
        ) : null}

        {canWrite && isOpen && !hasPayments ? (
          <Button
            variant="danger"
            isLoading={busy === 'cancel'}
            onClick={() => {
              if (
                window.confirm(
                  'Cancel this voucher? It will stay on record but will no longer be owed.',
                )
              ) {
                void patch(
                  'cancel',
                  { action: 'cancel' },
                  'This voucher has been cancelled.',
                );
              }
            }}
          >
            Cancel challan
          </Button>
        ) : null}
      </div>

      {error !== null ? (
        <p role="alert" className="rounded-lg bg-status-danger-subtle px-3 py-2 text-sm text-status-danger-ink">
          {error}
        </p>
      ) : null}

      {notice !== null ? (
        <p className="rounded-lg bg-status-success-subtle px-3 py-2 text-sm text-status-success-ink">
          {notice}
        </p>
      ) : null}
    </div>
  );
}
