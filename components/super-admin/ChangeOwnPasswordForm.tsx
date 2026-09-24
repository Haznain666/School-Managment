'use client';

import { useCallback, useState } from 'react';

import { Button } from '@/components/ui/Button';
import { Card, CardTitle } from '@/components/ui/Card';
import { Input } from '@/components/ui/Input';
import { superAdminFetch, SuperAdminApiError } from '@/lib/super-admin-client';

/**
 * "My account" — change your own password, with the current one. §9.
 *
 * The new password is typed twice and compared here; the server checks the
 * current password and the strength rule, which is the part that matters.
 */
export function ChangeOwnPasswordForm({ disabledReason }: { disabledReason: string | null }) {
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const mismatch = confirm !== '' && confirm !== next;

  const submit = useCallback(async () => {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await superAdminFetch('/api/super-admin/account/password', {
        method: 'PATCH',
        body: JSON.stringify({ currentPassword: current, newPassword: next }),
      });
      setNotice('Password changed. Use the new one next time you sign in.');
      setCurrent('');
      setNext('');
      setConfirm('');
    } catch (caught) {
      setError(caught instanceof SuperAdminApiError ? caught.message : 'Could not change the password.');
    } finally {
      setBusy(false);
    }
  }, [current, next]);

  return (
    <Card header={<CardTitle title="Change password" />}>
      <div className="max-w-md space-y-4">
        {disabledReason !== null ? (
          <p className="text-sm text-ink-muted">{disabledReason}</p>
        ) : (
          <>
            <Input
              label="Current password"
              type="password"
              autoComplete="current-password"
              value={current}
              disabled={busy}
              onChange={(event) => {
                setCurrent(event.target.value);
              }}
            />
            <Input
              label="New password"
              type="password"
              autoComplete="new-password"
              value={next}
              disabled={busy}
              hint="At least 12 characters, with letters and a number."
              onChange={(event) => {
                setNext(event.target.value);
              }}
            />
            <Input
              label="New password again"
              type="password"
              autoComplete="new-password"
              value={confirm}
              disabled={busy}
              error={mismatch ? 'The two new passwords differ.' : undefined}
              onChange={(event) => {
                setConfirm(event.target.value);
              }}
            />
            {error !== null ? (
              <p role="alert" className="text-sm text-status-danger-ink">
                {error}
              </p>
            ) : null}
            {notice !== null ? (
              <p role="status" className="text-sm text-status-success-ink">
                {notice}
              </p>
            ) : null}
            <Button
              isLoading={busy}
              disabled={current === '' || next === '' || confirm !== next}
              onClick={() => void submit()}
            >
              Change password
            </Button>
          </>
        )}
      </div>
    </Card>
  );
}
