'use client';

import { Scale } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { Button } from '@/components/ui/Button';
import { schoolErrorMessage, schoolFetch } from '@/lib/school-client';

/**
 * "Set up the chart of accounts" — the one click out of the empty state.
 *
 * A client component for one reason: it has a pending state. The rule in
 * `CLAUDE.md` is that `loading.tsx` covers the server render and anything a
 * client fetches after mount carries its own visible pending state, and a
 * button that writes fifteen accounts and eleven categories is exactly the kind
 * of thing somebody presses twice when it looks like nothing happened.
 *
 * Pressing it twice is harmless anyway — the route is idempotent — but "looks
 * like nothing happened" is the defect, not the second write.
 */
export function SetUpChartButton() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const setUp = async (): Promise<void> => {
    setBusy(true);
    setError(null);

    try {
      await schoolFetch('/api/school/accounting/accounts', { method: 'PUT' });
      router.refresh();
    } catch (caught) {
      setError(schoolErrorMessage(caught, 'The chart of accounts could not be created.'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-2">
      <Button icon={Scale} isLoading={busy} onClick={() => void setUp()}>
        Set up the chart of accounts
      </Button>
      {error !== null ? (
        <p role="alert" className="text-sm text-status-danger-ink">
          {error}
        </p>
      ) : null}
    </div>
  );
}
