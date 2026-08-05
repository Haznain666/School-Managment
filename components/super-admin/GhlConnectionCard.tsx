'use client';

import { useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';

import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card, CardTitle } from '@/components/ui/Card';

export interface GhlConnectionCardProps {
  schoolId: string;
  locationId: string;
}

interface Status {
  connected: boolean;
  expiresAt: string | null;
  expired: boolean | null;
  connectedAt: string | null;
}

/** What each `?ghl=` value from the callback means, in the operator's terms. */
const CALLBACK_MESSAGES: Record<string, { tone: 'ok' | 'bad'; text: string }> = {
  connected: { tone: 'ok', text: 'GoHighLevel connected. This school can now send email.' },
  declined: { tone: 'bad', text: 'The install was declined in GoHighLevel. Nothing changed.' },
  state_missing: {
    tone: 'bad',
    text: 'That install link had expired. Start again from this page.',
  },
  state_mismatch: {
    tone: 'bad',
    text: 'The install could not be verified and was refused. Start again from this page.',
  },
  no_code: { tone: 'bad', text: 'GoHighLevel did not return an authorisation code.' },
  exchange_failed: {
    tone: 'bad',
    text: 'GoHighLevel rejected the authorisation code. Check the app credentials and redirect URI.',
  },
  location_mismatch: {
    tone: 'bad',
    text: 'You selected a different GoHighLevel sub-account than this school is configured for. Nothing was saved — select the sub-account whose Location ID matches the one shown here.',
  },
  failed: { tone: 'bad', text: 'The install failed. Check the server log for the reason.' },
};

/**
 * The GoHighLevel connection for one school.
 *
 * This is the entry point to the install that did not exist: without a row in
 * `ghl_tokens` every location-scoped call — every invitation, sign-in code and
 * password reset — fails with "this school has not connected its GoHighLevel
 * account", and there was no way to create the first row from anywhere in the
 * application.
 *
 * Connecting is a full-page navigation, not a `fetch`: the browser has to reach
 * GHL's consent screen, and only a real navigation can take it there.
 */
export function GhlConnectionCard({ schoolId, locationId }: GhlConnectionCardProps) {
  const searchParams = useSearchParams();
  const callbackStatus = searchParams.get('ghl');

  const [status, setStatus] = useState<Status | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isBusy, setIsBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const response = await fetch(`/api/super-admin/schools/${schoolId}/ghl`);
      const payload = (await response.json()) as {
        ok: boolean;
        data?: Status;
        error?: { message: string };
      };

      if (!response.ok || payload.ok !== true || payload.data === undefined) {
        setError(payload.error?.message ?? 'Could not read the GoHighLevel status.');
        return;
      }

      setStatus(payload.data);
      setError(null);
    } catch {
      setError('Could not read the GoHighLevel status.');
    }
  }, [schoolId]);

  useEffect(() => {
    void load();
  }, [load]);

  const disconnect = useCallback(async () => {
    setIsBusy(true);
    setError(null);

    try {
      const response = await fetch(`/api/super-admin/schools/${schoolId}/ghl`, {
        method: 'DELETE',
      });

      if (!response.ok) {
        setError('Could not disconnect.');
        return;
      }

      await load();
    } catch {
      setError('Could not disconnect.');
    } finally {
      setIsBusy(false);
    }
  }, [schoolId, load]);

  const callback =
    callbackStatus === null ? null : CALLBACK_MESSAGES[callbackStatus] ?? null;

  return (
    <Card
      header={
        <CardTitle
          title="GoHighLevel"
          description="The sub-account this school sends email from."
          action={
            status?.connected === true ? (
              <Badge variant="success">Connected</Badge>
            ) : (
              <Badge variant="warning">Not connected</Badge>
            )
          }
        />
      }
    >
      {callback !== null ? (
        <p
          role="status"
          className={
            callback.tone === 'ok'
              ? 'mb-3 rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800'
              : 'mb-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700'
          }
        >
          {callback.text}
        </p>
      ) : null}

      {error !== null ? (
        <p role="alert" className="mb-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </p>
      ) : null}

      {status === null ? (
        <p className="text-sm text-slate-500">Checking…</p>
      ) : status.connected ? (
        <dl className="grid gap-4 sm:grid-cols-2">
          <div>
            <dt className="text-xs uppercase tracking-wide text-slate-500">Location ID</dt>
            <dd className="mt-1 break-words font-mono text-sm text-slate-900">
              {locationId}
            </dd>
          </div>
          <div>
            <dt className="text-xs uppercase tracking-wide text-slate-500">
              Token expires
            </dt>
            <dd className="mt-1 text-sm text-slate-900">
              {status.expiresAt === null
                ? '—'
                : new Date(status.expiresAt).toLocaleString()}
              {status.expired === true ? (
                <span className="ml-2 text-slate-500">
                  (lapsed — refreshes on next use)
                </span>
              ) : null}
            </dd>
          </div>
        </dl>
      ) : (
        <p className="text-sm text-slate-600">
          This school cannot send email until its GoHighLevel sub-account is connected.
          Choose the sub-account whose Location ID is{' '}
          <span className="font-mono">{locationId}</span>.
        </p>
      )}

      <div className="mt-4 flex gap-2">
        {/* A real navigation, not fetch — the browser has to reach GHL. */}
        <a href={`/api/super-admin/schools/${schoolId}/ghl/connect`}>
          <Button disabled={isBusy}>
            {status?.connected === true ? 'Reconnect' : 'Connect GoHighLevel'}
          </Button>
        </a>

        {status?.connected === true ? (
          <Button variant="danger" onClick={disconnect} isLoading={isBusy}>
            Disconnect
          </Button>
        ) : null}
      </div>
    </Card>
  );
}
