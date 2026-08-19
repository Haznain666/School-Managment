'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { Button } from '@/components/ui/Button';
import { Card, CardTitle } from '@/components/ui/Card';
import { schoolErrorMessage, schoolFetch } from '@/lib/school-client';

/**
 * "Has this admission been paid for?" — on one student's profile.
 *
 * ── Why it is a card and not a badge ─────────────────────────────────────
 * The state it shows has a consequence somebody has to be able to see coming:
 * while the fee is outstanding the parents have no portal login, and the
 * welcome that carries one goes out by itself the moment the fee clears. A
 * badge could say "Fee outstanding"; it could not say what that means or what
 * happens next, and the first person to meet this feature will be an
 * administrator wondering why a father never received an email.
 *
 * ── The button, and who gets it ──────────────────────────────────────────
 * Only somebody holding `fees.write`. Recording a payment against a challan
 * clears this on its own, and that is the path a school billing through the
 * system will always take. The button is for the school that took cash across
 * a desk and never raised a challan at all — for whom it is the only path
 * there is.
 *
 * It is one-way. Clearing sends email to real people, and an "un-clear" would
 * imply those messages could be recalled.
 */

export interface FeeClearancePanelProps {
  studentProfileId: string;
  feeStatus: 'outstanding' | 'cleared';
  feeClearedAt: string | null;
  /** `fees.write`. Without it this is read-only. */
  canClear: boolean;
  /** Whether any guardian has an address the welcome could go to. */
  hasContactableGuardian: boolean;
}

export function FeeClearancePanel({
  studentProfileId,
  feeStatus,
  feeClearedAt,
  canClear,
  hasContactableGuardian,
}: FeeClearancePanelProps) {
  const router = useRouter();

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const clear = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    setNotice(null);

    try {
      const result = await schoolFetch<{
        welcomesQueued: number;
        problems: string[];
      }>(`/api/school/students/${studentProfileId}/fee-clearance`, { method: 'POST' });

      setNotice(
        [
          'Enrolment confirmed.',
          result.welcomesQueued === 0
            ? 'No parent portal welcome could be queued.'
            : `${result.welcomesQueued} parent portal welcome${
                result.welcomesQueued === 1 ? '' : 's'
              } queued.`,
          ...result.problems,
        ].join(' '),
      );

      router.refresh();
    } catch (caught) {
      setError(schoolErrorMessage(caught, 'Could not confirm the enrolment.'));
    } finally {
      setBusy(false);
    }
  };

  if (feeStatus === 'cleared') {
    return (
      <Card header={<CardTitle title="Admission fee" />}>
        <p className="text-sm text-ink-muted">
          Paid, so this enrolment is confirmed
          {feeClearedAt === null
            ? '.'
            : ` — recorded ${new Date(feeClearedAt).toLocaleDateString('en-GB')}.`}{' '}
          Guardians with an email address have been sent their parent portal
          welcome.
        </p>
      </Card>
    );
  }

  return (
    <Card
      header={
        <CardTitle
          title="Admission fee"
          description="A new admission is confirmed once the school has been paid."
        />
      }
    >
      <p className="rounded-lg bg-status-warning-subtle px-3 py-2 text-sm text-status-warning-onSubtle">
        Outstanding. The student is enrolled and appears on every register and
        class list, but the admission is not yet confirmed and the guardians have
        no parent portal login. Recording payment against their challan confirms
        it automatically and sends the welcome.
      </p>

      {hasContactableGuardian ? null : (
        <p className="mt-3 text-sm text-ink-muted">
          No guardian on this record has an email address, so there is nowhere to
          send a portal welcome even once the fee clears. Add one below.
        </p>
      )}

      {canClear ? (
        <>
          <Button
            className="mt-4"
            variant="secondary"
            isLoading={busy}
            onClick={() => {
              void clear();
            }}
          >
            Confirm the fee was paid
          </Button>
          <p className="mt-2 text-xs text-ink-muted">
            For a fee taken in cash without a challan. This cannot be undone —
            it sends the guardians their portal welcome.
          </p>
        </>
      ) : null}

      {notice !== null ? (
        <p className="mt-3 rounded-lg bg-status-success-subtle px-3 py-2 text-sm text-status-success-onSubtle">
          {notice}
        </p>
      ) : null}

      {error !== null ? (
        <p
          role="alert"
          className="mt-3 rounded-lg bg-status-danger-subtle px-3 py-2 text-sm text-status-danger-ink"
        >
          {error}
        </p>
      ) : null}
    </Card>
  );
}
