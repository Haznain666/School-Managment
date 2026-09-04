'use client';

import { useCallback, useEffect, useState } from 'react';

import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { schoolFetch } from '@/lib/school-client';

/**
 * Three buttons, and each one is its own ruling.
 *
 * ── Why three and not a checkbox ─────────────────────────────────────────
 * "Remove this student" and "switch off their family's logins" are two
 * decisions, and a tick-box beside a Delete button gets the second one made by
 * accident — either way. A clerk clearing a duplicate record does not mean to
 * lock a father out of his other children's fees; a clerk processing a
 * departure does mean to close the account.
 *
 * So the dialog asks, and the two answers are separate buttons with different
 * words on them. **Cancel does nothing at all** and is the default focus,
 * because the other two are hard to undo.
 *
 * ── It shows the consequence before it asks ──────────────────────────────
 * "Disable and continue" is a very different act when it switches off two
 * parents than when it switches off none. The dialog fetches who is actually
 * affected first, and names them — including the guardians who will **keep**
 * their login because another child of theirs is still enrolled, since that is
 * the half a clerk is most likely to be worried about and least able to guess.
 *
 * That rule is enforced on the server regardless of what this screen renders.
 * `lib/student-departure.ts` computes it again; this is a courtesy, not the
 * control.
 */

export interface DepartureImpact {
  losingLastChild: { schoolUserId: string; name: string }[];
  keptWithOtherChildren: { schoolUserId: string; name: string }[];
}

export type RemovalMode = 'delete' | 'withdraw';

export interface StudentRemovalDialogProps {
  open: boolean;
  studentProfileId: string;
  studentName: string;
  mode: RemovalMode;
  onClose: () => void;
  /** Called with the clerk's ruling. `false` = continue without disabling. */
  onConfirm: (disablePortals: boolean) => void | Promise<void>;
  busy?: boolean;
}

export function StudentRemovalDialog({
  open,
  studentProfileId,
  studentName,
  mode,
  onClose,
  onConfirm,
  busy = false,
}: StudentRemovalDialogProps) {
  const [impact, setImpact] = useState<DepartureImpact | null>(null);

  useEffect(() => {
    if (!open) {
      setImpact(null);
      return;
    }

    void (async () => {
      try {
        // The withdraw route's GET answers this for both modes: the question
        // "who loses their last child here" does not depend on how the child
        // is leaving.
        const result = await schoolFetch<DepartureImpact>(
          `/api/school/students/${studentProfileId}/withdraw`,
        );
        setImpact(result);
      } catch {
        // The dialog still works without the preview; it just cannot name
        // anybody, and the server enforces the rule either way.
        setImpact({ losingLastChild: [], keptWithOtherChildren: [] });
      }
    })();
  }, [open, studentProfileId]);

  const confirm = useCallback(
    (disablePortals: boolean) => {
      void onConfirm(disablePortals);
    },
    [onConfirm],
  );

  const verb = mode === 'delete' ? 'Delete' : 'Withdraw';

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={`${verb} ${studentName}?`}
      // The house convention: a right-aligned action row, primary action last.
      // Cancel is first and holds focus, because the other two are hard to undo.
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy} autoFocus>
            Cancel
          </Button>
          <Button
            variant="secondary"
            onClick={() => {
              confirm(false);
            }}
            disabled={busy}
          >
            Continue without disabling
          </Button>
          <Button
            variant="danger"
            onClick={() => {
              confirm(true);
            }}
            disabled={busy}
          >
            Disable and continue
          </Button>
        </>
      }
    >
      <div className="space-y-4 text-sm text-ink">
        <p>
          {mode === 'delete'
            ? 'This removes the student record. Their conversations are kept but closed.'
            : 'This ends their placement. The record, the fee history and their conversations are all kept.'}
        </p>

        {impact === null ? (
          <p className="text-ink-muted">Checking who else this affects…</p>
        ) : (
          <>
            {impact.losingLastChild.length > 0 ? (
              <div className="rounded-card bg-surface px-3 py-2">
                <p className="font-medium">
                  These parents have no other child at the school:
                </p>
                <ul className="mt-1 list-disc pl-5 text-ink-muted">
                  {impact.losingLastChild.map((guardian) => (
                    <li key={guardian.schoolUserId}>{guardian.name}</li>
                  ))}
                </ul>
                <p className="mt-2 text-xs text-ink-muted">
                  Only these can be switched off.
                </p>
              </div>
            ) : null}

            {impact.keptWithOtherChildren.length > 0 ? (
              <div className="rounded-card bg-surface px-3 py-2">
                <p className="font-medium">
                  These parents keep their login either way:
                </p>
                <ul className="mt-1 list-disc pl-5 text-ink-muted">
                  {impact.keptWithOtherChildren.map((guardian) => (
                    <li key={guardian.schoolUserId}>{guardian.name}</li>
                  ))}
                </ul>
                <p className="mt-2 text-xs text-ink-muted">
                  They have another child still enrolled, so switching them off would
                  lock them out of that child&rsquo;s fees and results.
                </p>
              </div>
            ) : null}
          </>
        )}
      </div>
    </Modal>
  );
}
