'use client';

import { useState } from 'react';

import { Toggle } from '@/components/ui/Toggle';
import { schoolErrorMessage, schoolFetch } from '@/lib/school-client';

/**
 * "May a class have more than one principal?" — Sprint 23, item 2.
 *
 * ── Why it is here and not on the branch page ────────────────────────────
 * The *assignments* live on each campus's own page, because "who runs this
 * campus" is a question about a campus. This is not that question. It is one
 * rule for the whole school — grades are per campus already, so a school with
 * four campuses still has exactly one answer to whether two heads may share a
 * class — and a rule that appeared four times, once per campus, would be four
 * controls a clerk could reasonably expect to set differently.
 *
 * ── The toggle is a courtesy; the API is the rule ────────────────────────
 * `POST /api/school/principals` re-reads the column and decides for itself,
 * so a stale tab left open across a change here cannot write an overlap the
 * school has switched off. That is the same posture as the greyed-out grade
 * chips on the assignment card.
 *
 * ── Turning it off does not undo anything ────────────────────────────────
 * Existing overlaps are grandfathered — migration `0039` alters no assignment —
 * and the sentence below says so, because an administrator who switches this
 * off and sees two heads still on grade 3 needs to know that is deliberate
 * rather than a control that did not work.
 */
export function SharedPrincipalGradesToggle({
  initial,
  canEdit,
}: {
  initial: boolean;
  canEdit: boolean;
}) {
  const [allowed, setAllowed] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const save = async (next: boolean): Promise<void> => {
    setBusy(true);
    setError(null);
    setNotice(null);

    // Moved before the request, and put back below if it fails. A switch that
    // does not move until the round trip finishes reads as a dead control on a
    // connection like the one CLAUDE.md measures at a second.
    setAllowed(next);

    try {
      await schoolFetch('/api/school/settings', {
        method: 'PATCH',
        body: JSON.stringify({ allowSharedPrincipalGrades: next }),
      });
      setNotice(
        next
          ? 'A class may now be assigned to more than one principal.'
          : 'A class may now be assigned to one principal at a time. Assignments that already overlap are kept — the campus page shows them.',
      );
    } catch (caught) {
      setAllowed(!next);
      setError(schoolErrorMessage(caught, 'Could not change that setting.'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mt-4 border-t border-line pt-4">
      {error !== null ? (
        <p
          role="alert"
          className="mb-3 rounded-lg bg-status-danger-subtle px-3 py-2 text-sm text-status-danger-ink"
        >
          {error}
        </p>
      ) : null}

      {notice !== null ? (
        <p className="mb-3 rounded-lg bg-status-success-subtle px-3 py-2 text-sm text-status-success-ink">
          {notice}
        </p>
      ) : null}

      <Toggle
        checked={allowed}
        onChange={(next) => void save(next)}
        disabled={!canEdit || busy}
        label="Allow a class to have more than one principal"
        description="Off by default. With it off, assigning a class that another head already holds is refused, and the assignment card greys it out with their name."
      />
    </div>
  );
}
