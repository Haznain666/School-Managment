'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { Button } from '@/components/ui/Button';
import { Card, CardTitle } from '@/components/ui/Card';
import { Input } from '@/components/ui/Input';

/**
 * Delete a campus — the confirm, the refusal, and why the code has to be typed.
 *
 * ── Every school group has two campuses called "Main" ────────────────────
 * A yes/no box is clicked through; a code that has to be typed is read. The
 * same reasoning as the student delete's admission number (§5bf) and the school
 * delete's name — and here it matters more, because the two rows a group is
 * most likely to confuse are the two most similar ones.
 *
 * ── The refusal is the normal outcome, not the error case ────────────────
 * A campus with a child enrolled in it is not a row anybody may drop, and the
 * route says so with a **409** naming the counts. So the 409 is rendered as an
 * explanation in the card rather than as a red failure banner: "142 students,
 * 11 staff" tells the operator what they would have to move and where to start,
 * where "could not delete" sends them hunting.
 */
export function BranchDeleteCard({
  branchId,
  branchCode,
  branchName,
}: {
  branchId: string;
  branchCode: string;
  branchName: string;
}) {
  const router = useRouter();

  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);
  const [refusal, setRefusal] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const matches = typed.trim().toUpperCase() === branchCode.toUpperCase();

  const remove = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    setRefusal(null);

    try {
      const response = await fetch(`/api/school/branches/${branchId}`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ confirmCode: typed.trim() }),
      });

      const payload = (await response.json()) as {
        ok?: boolean;
        error?: { code?: string; message?: string };
      };

      if (response.status === 409) {
        setRefusal(payload.error?.message ?? 'This campus is still in use.');
        return;
      }

      if (!response.ok || payload.ok !== true) {
        setError(payload.error?.message ?? 'Could not delete this campus.');
        return;
      }

      router.push('/dashboard/branches');
      router.refresh();
    } catch {
      setError('Could not delete this campus. Please try again.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card
      className="border-status-danger/40"
      header={
        <CardTitle
          title="Delete this campus"
          description="Only possible while nothing is attached to it. Everything else is a refusal that names what is."
        />
      }
    >
      {refusal !== null ? (
        <p className="mb-3 rounded-lg bg-status-warning-subtle px-3 py-2 text-sm text-status-warning-onSubtle">
          {refusal}
        </p>
      ) : null}

      {error !== null ? (
        <p
          role="alert"
          className="mb-3 rounded-lg bg-status-danger-subtle px-3 py-2 text-sm text-status-danger-ink"
        >
          {error}
        </p>
      ) : null}

      <p className="text-sm text-ink-muted">
        Deleting {branchName} cannot be undone. Type its code to confirm.
      </p>

      <div className="mt-3 flex flex-wrap items-end gap-3">
        <Input
          label="Branch code"
          value={typed}
          disabled={busy}
          placeholder={branchCode}
          hint="Case does not matter."
          onChange={(event) => {
            setTyped(event.target.value);
          }}
        />
        <Button
          variant="danger"
          disabled={!matches}
          isLoading={busy}
          onClick={() => {
            void remove();
          }}
        >
          Delete campus
        </Button>
      </div>
    </Card>
  );
}
