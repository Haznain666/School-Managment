'use client';

import { Trash2 } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useCallback, useState } from 'react';

import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import {
  FEEDBACK_DECISION_STATUSES,
  FEEDBACK_STATUS_LABELS,
  type FeedbackDecisionStatus,
  type FeedbackStatus,
} from '@/db/schema';
import { cn } from '@/lib/utils';

/**
 * The decision controls on one ticket: three statuses, and delete.
 *
 * ── Three buttons, not a dropdown ────────────────────────────────────────
 * On the listing the same choice is a `<select>`, because there it is one cell
 * in a row of five and a row of buttons per ticket would be forty buttons on a
 * screen. Here there is one ticket and the operator is deciding about it, so
 * the options are visible rather than hidden behind a click — and the current
 * one is marked, which a closed dropdown cannot do.
 *
 * ── Deleting asks first, and says what it takes with it ──────────────────
 * A ticket carries a conversation and up to five files, all of which go. That
 * is the sentence in the dialog, because "Are you sure?" is a question nobody
 * can answer — the answer depends on what is about to be lost, and only the
 * dialog knows.
 */

export interface FeedbackDecisionProps {
  ticketId: string;
  status: FeedbackStatus;
  attachmentCount: number;
  replyCount: number;
}

export function FeedbackDecision({
  ticketId,
  status,
  attachmentCount,
  replyCount,
}: FeedbackDecisionProps) {
  const router = useRouter();
  const [saving, setSaving] = useState<FeedbackDecisionStatus | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const setStatus = useCallback(
    async (next: FeedbackDecisionStatus) => {
      setSaving(next);
      setError(null);

      try {
        const response = await fetch(`/api/super-admin/feedback/${ticketId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ status: next }),
        });

        const payload = (await response.json()) as {
          ok: boolean;
          error?: { message: string };
        };

        if (!payload.ok) {
          setError(payload.error?.message ?? 'The status could not be changed.');
          return;
        }

        router.refresh();
      } catch {
        setError('The status could not be changed. Check your connection and try again.');
      } finally {
        setSaving(null);
      }
    },
    [router, ticketId],
  );

  const remove = useCallback(async () => {
    setDeleting(true);
    setError(null);

    try {
      const response = await fetch(`/api/super-admin/feedback/${ticketId}`, {
        method: 'DELETE',
      });

      const payload = (await response.json()) as {
        ok: boolean;
        error?: { message: string };
      };

      if (!payload.ok) {
        setError(payload.error?.message ?? 'The feedback could not be deleted.');
        setConfirming(false);
        return;
      }

      router.push('/super-admin/feedback');
      router.refresh();
    } catch {
      setError('The feedback could not be deleted. Check your connection and try again.');
      setConfirming(false);
    } finally {
      setDeleting(false);
    }
  }, [router, ticketId]);

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        {FEEDBACK_DECISION_STATUSES.map((value) => {
          const current = status === value;

          return (
            <button
              key={value}
              type="button"
              aria-pressed={current}
              disabled={saving !== null}
              onClick={() => {
                void setStatus(value);
              }}
              className={cn(
                'flex w-full items-center justify-between gap-3 rounded-control border px-3 py-2 text-sm font-medium transition-colors duration-fast',
                current
                  ? 'border-brand-primary bg-brand-primarySubtle text-brand-onPrimarySubtle'
                  : 'border-line bg-surface-raised text-ink hover:bg-surface-hover',
                saving !== null && 'opacity-60',
              )}
            >
              {FEEDBACK_STATUS_LABELS[value]}
              {current ? <span className="text-xs">Current</span> : null}
              {saving === value ? <span className="text-xs">Saving…</span> : null}
            </button>
          );
        })}
      </div>

      <p className="text-sm text-ink-muted">
        Changing the status emails the person who sent this and puts it in their
        portal.
      </p>

      {error === null ? null : (
        <p
          role="alert"
          className="rounded-control border border-status-danger bg-status-danger-subtle px-3 py-2 text-sm text-status-danger-onSubtle"
        >
          {error}
        </p>
      )}

      <Button
        variant="danger"
        size="sm"
        icon={Trash2}
        fullWidth
        onClick={() => {
          setConfirming(true);
        }}
      >
        Delete feedback
      </Button>

      <Modal
        open={confirming}
        onClose={() => {
          setConfirming(false);
        }}
        title="Delete this feedback?"
        footer={
          <div className="flex justify-end gap-2">
            <Button
              variant="secondary"
              onClick={() => {
                setConfirming(false);
              }}
            >
              Keep it
            </Button>
            <Button
              variant="danger"
              isLoading={deleting}
              onClick={() => {
                void remove();
              }}
            >
              Delete
            </Button>
          </div>
        }
      >
        <p className="text-sm text-ink">
          The message goes, along with {replyCount === 0 ? 'no replies' : `${replyCount} repl${replyCount === 1 ? 'y' : 'ies'}`}{' '}
          and {attachmentCount === 0 ? 'no files' : `${attachmentCount} file${attachmentCount === 1 ? '' : 's'}`}. This
          cannot be undone, and the school is not told.
        </p>
        <p className="mt-3 text-sm text-ink-muted">
          If you mean to close it rather than erase it, mark it Resolved instead —
          that answers the school and keeps the record.
        </p>
      </Modal>
    </div>
  );
}
