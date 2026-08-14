'use client';

import { useCallback, useEffect, useState } from 'react';

import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Input } from '@/components/ui/Input';
import { PLATFORM_INTEGRATIONS } from '@/lib/platform-modules';
import { superAdminFetch, SuperAdminApiError } from '@/lib/super-admin-client';

export interface IntegrationsPanelProps {
  schoolId: string;
}

interface IntegrationsState {
  gohighlevel: { connected: boolean; locationId: string | null };
}

const GHL = PLATFORM_INTEGRATIONS[0];

/**
 * Per-school third-party connections — today, GoHighLevel.
 *
 * ── Why connecting is a text field and not a button ──────────────────────
 * There is no OAuth install flow in this repo. Connecting means telling the
 * platform which GHL sub-account belongs to this school, and that id is
 * something the operator reads out of GoHighLevel. A branch of
 * `claude/school-email-auth-7f5vuh` does carry an OAuth install flow; if that
 * ever lands, this field becomes the manual fallback rather than the only way.
 *
 * ── Disconnecting is confirmed ───────────────────────────────────────────
 * The id is not stored anywhere else, so clearing it means finding it again in
 * GoHighLevel. Cheap to confirm, expensive to undo.
 */
export function IntegrationsPanel({ schoolId }: IntegrationsPanelProps) {
  const [state, setState] = useState<IntegrationsState | null>(null);
  const [value, setValue] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [confirmingDisconnect, setConfirmingDisconnect] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const path = `/api/super-admin/schools/${schoolId}/integrations`;

  useEffect(() => {
    let cancelled = false;

    void superAdminFetch<IntegrationsState>(path)
      .then((data) => {
        if (cancelled) return;
        setState(data);
        setValue(data.gohighlevel.locationId ?? '');
      })
      .catch(() => {
        if (!cancelled) setError('Could not load integration settings.');
      });

    return () => {
      cancelled = true;
    };
  }, [path]);

  const save = useCallback(
    async (locationId: string | null) => {
      setIsSaving(true);
      setError(null);
      setNotice(null);

      try {
        const data = await superAdminFetch<IntegrationsState>(path, {
          method: 'PATCH',
          body: JSON.stringify({ ghl_location_id: locationId }),
        });

        setState(data);
        setValue(data.gohighlevel.locationId ?? '');
        setConfirmingDisconnect(false);
        setNotice(
          locationId === null
            ? `${GHL.label} disconnected.`
            : `${GHL.label} connected.`,
        );
      } catch (caught) {
        setError(
          caught instanceof SuperAdminApiError
            ? caught.message
            : 'Could not save that change.',
        );
      } finally {
        setIsSaving(false);
      }
    },
    [path],
  );

  if (state === null) {
    return (
      <Card>
        <p className="text-sm text-ink-muted">
          {error ?? 'Loading integration settings…'}
        </p>
      </Card>
    );
  }

  const { connected, locationId } = state.gohighlevel;
  const trimmed = value.trim();
  const dirty = trimmed !== (locationId ?? '');

  return (
    <Card>
      <div className="space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <p className="text-sm font-medium text-ink">{GHL.label}</p>
            <p className="mt-1 max-w-prose text-sm text-ink-muted">
              {GHL.description}
            </p>
          </div>

          <span
            className={
              connected
                ? 'shrink-0 rounded-full bg-status-success-subtle px-3 py-1 text-xs font-medium text-status-success-onSubtle'
                : 'shrink-0 rounded-full bg-surface-sunken px-3 py-1 text-xs font-medium text-ink-muted'
            }
          >
            {connected ? 'Connected' : 'Not connected'}
          </span>
        </div>

        <div className="max-w-md">
          <Input
            label={GHL.credentialLabel}
            value={value}
            disabled={isSaving}
            placeholder="e.g. ve9EPM428h8vShlRW1KT"
            hint="Copy it from the sub-account in GoHighLevel. One sub-account belongs to one school."
            onChange={(event) => {
              setValue(event.target.value);
              setNotice(null);
              setError(null);
            }}
          />
        </div>

        {connected ? (
          <p className="text-sm text-ink-muted">
            Contact sync and — when the WhatsApp channel is on — message
            delivery run through this sub-account.
          </p>
        ) : (
          <p className="text-sm text-ink-muted">
            This school works fully without GoHighLevel. Anything that would
            have gone to it is skipped, and the WhatsApp channel cannot send
            until it is connected.
          </p>
        )}

        {error !== null ? (
          <p role="alert" className="rounded-lg bg-status-danger-subtle px-3 py-2 text-sm text-status-danger-ink">
            {error}
          </p>
        ) : notice !== null ? (
          <p role="status" className="rounded-lg bg-status-success-subtle px-3 py-2 text-sm text-status-success-ink">
            {notice}
          </p>
        ) : null}

        {confirmingDisconnect ? (
          <div className="rounded-lg bg-status-danger-subtle px-4 py-3">
            <p className="text-sm text-status-danger-onSubtle">
              Disconnect {GHL.label} from this school? The{' '}
              {GHL.credentialLabel} is not stored anywhere else, so
              reconnecting means finding it again in GoHighLevel.
            </p>
            <div className="mt-3 flex gap-2">
              <Button
                variant="danger"
                size="sm"
                isLoading={isSaving}
                onClick={() => void save(null)}
              >
                Disconnect
              </Button>
              <Button
                variant="secondary"
                size="sm"
                disabled={isSaving}
                onClick={() => {
                  setConfirmingDisconnect(false);
                }}
              >
                Cancel
              </Button>
            </div>
          </div>
        ) : (
          <div className="flex flex-wrap gap-2">
            <Button
              isLoading={isSaving}
              disabled={!dirty || trimmed === ''}
              onClick={() => void save(trimmed)}
            >
              {connected ? 'Update connection' : 'Connect'}
            </Button>

            {connected ? (
              <Button
                variant="secondary"
                disabled={isSaving}
                onClick={() => {
                  setConfirmingDisconnect(true);
                }}
              >
                Disconnect
              </Button>
            ) : null}

            {dirty && locationId !== null ? (
              <Button
                variant="ghost"
                disabled={isSaving}
                onClick={() => {
                  setValue(locationId);
                }}
              >
                Discard
              </Button>
            ) : null}
          </div>
        )}
      </div>
    </Card>
  );
}
