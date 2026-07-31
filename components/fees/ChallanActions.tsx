'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { Button } from '@/components/ui/Button';
import { Card, CardTitle } from '@/components/ui/Card';
import type { ChallanStatus } from '@/db/schema/fee-challans';
import { schoolErrorMessage, schoolFetch } from '@/lib/school-client';

/**
 * The destructive and outbound actions on a challan.
 *
 * Cancelling asks for confirmation and is refused outright once money has been
 * taken — a cancelled challan with payments against it would strand those rows
 * on a bill that no longer counts, and this module has no refund path.
 */

export interface ChallanActionsProps {
  challanId: string;
  status: ChallanStatus;
  hasPayments: boolean;
  guardianPhone: string | null;
  canManage: boolean;
}

export function ChallanActions({
  challanId,
  status,
  hasPayments,
  guardianPhone,
  canManage,
}: ChallanActionsProps) {
  const router = useRouter();

  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [confirmingCancel, setConfirmingCancel] = useState(false);

  if (!canManage) return null;

  const isOpen = status === 'unpaid' || status === 'partial';

  const sendReminder = async (): Promise<void> => {
    setBusy('remind');
    setError(null);
    setNotice(null);

    try {
      const result = await schoolFetch<{ queued: number; failed: number }>(
        '/api/school/fees/reminders',
        { method: 'POST', body: JSON.stringify({ challanIds: [challanId] }) },
      );

      setNotice(
        result.queued > 0
          ? 'Reminder sent to the guardian over WhatsApp.'
          : 'The reminder could not be delivered — check the GoHighLevel connection.',
      );
    } catch (caught) {
      setError(schoolErrorMessage(caught, 'Could not send the reminder.'));
    } finally {
      setBusy(null);
    }
  };

  const cancel = async (): Promise<void> => {
    setBusy('cancel');
    setError(null);

    try {
      await schoolFetch(`/api/school/fees/challans/${challanId}`, {
        method: 'PATCH',
        body: JSON.stringify({ status: 'cancelled' }),
      });

      setConfirmingCancel(false);
      router.refresh();
    } catch (caught) {
      setError(schoolErrorMessage(caught, 'Could not cancel the challan.'));
    } finally {
      setBusy(null);
    }
  };

  return (
    <Card header={<CardTitle title="Actions" />}>
      <div className="flex flex-wrap gap-3">
        {isOpen && guardianPhone !== null ? (
          <Button
            variant="secondary"
            isLoading={busy === 'remind'}
            onClick={() => {
              void sendReminder();
            }}
          >
            Send WhatsApp reminder
          </Button>
        ) : null}

        {isOpen && !hasPayments && !confirmingCancel ? (
          <Button
            variant="ghost"
            onClick={() => {
              setConfirmingCancel(true);
            }}
          >
            Cancel challan
          </Button>
        ) : null}
      </div>

      {isOpen && hasPayments ? (
        <p className="mt-3 text-sm text-slate-500">
          This challan has payments recorded against it, so it can no longer be
          cancelled. Record a refund outside the system and add a note instead.
        </p>
      ) : null}

      {guardianPhone === null && isOpen ? (
        <p className="mt-3 text-sm text-slate-500">
          No guardian phone number is on file for this student, so no reminder can
          be sent.
        </p>
      ) : null}

      {confirmingCancel ? (
        <div className="mt-4 rounded-lg border border-red-200 bg-red-50 p-4">
          <p className="text-sm text-red-800">
            Cancelling marks this challan void. It stays in the register for the
            record, but stops counting towards what the family owes. This cannot
            be undone.
          </p>
          <div className="mt-3 flex gap-3">
            <Button
              variant="danger"
              isLoading={busy === 'cancel'}
              onClick={() => {
                void cancel();
              }}
            >
              Yes, cancel it
            </Button>
            <Button
              variant="secondary"
              disabled={busy === 'cancel'}
              onClick={() => {
                setConfirmingCancel(false);
              }}
            >
              Keep it
            </Button>
          </div>
        </div>
      ) : null}

      {notice !== null ? (
        <p className="mt-3 rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
          {notice}
        </p>
      ) : null}

      {error !== null ? (
        <p role="alert" className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </p>
      ) : null}
    </Card>
  );
}
