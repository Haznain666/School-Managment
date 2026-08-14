'use client';

import { useCallback, useEffect, useState } from 'react';

import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import {
  emptyChannelFlags,
  PLATFORM_CHANNELS,
  type PlatformChannelKey,
  type SchoolChannelFlags,
} from '@/lib/platform-modules';
import { superAdminFetch } from '@/lib/super-admin-client';

export interface ChannelToggleListProps {
  schoolId: string;
}

/**
 * Delivery channels for one school — today, WhatsApp.
 *
 * ── Why this is not part of ModuleToggleGrid ─────────────────────────────
 * It writes through the same endpoint and the same table, so merging them
 * would have been easy. It reads as a different thing though: a module is
 * something the school's staff open, and switching one off removes a menu
 * item. A channel is how messages leave the building, and switching this one
 * off silently changes who receives a fee notice. Those deserve different
 * space on the page and different words around them.
 *
 * ── Saved immediately, not staged ────────────────────────────────────────
 * The module grid stages changes and saves a batch, which is right when there
 * are ten toggles. There is one here, and it is a commercial decision someone
 * has just made on a call — so it saves on click, and says so.
 */
export function ChannelToggleList({ schoolId }: ChannelToggleListProps) {
  const [flags, setFlags] = useState<SchoolChannelFlags>(emptyChannelFlags);
  const [loaded, setLoaded] = useState(false);
  const [savingKey, setSavingKey] = useState<PlatformChannelKey | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    void superAdminFetch<{ channels: SchoolChannelFlags }>(
      `/api/super-admin/schools/${schoolId}/modules`,
    )
      .then((data) => {
        if (cancelled) return;
        setFlags(data.channels);
        setLoaded(true);
      })
      .catch(() => {
        if (!cancelled) setError('Could not load channel settings.');
      });

    return () => {
      cancelled = true;
    };
  }, [schoolId]);

  const toggle = useCallback(
    async (key: PlatformChannelKey, enabled: boolean) => {
      setSavingKey(key);
      setError(null);
      setNotice(null);

      try {
        const result = await superAdminFetch<{ channels: SchoolChannelFlags }>(
          `/api/super-admin/schools/${schoolId}/modules`,
          {
            method: 'PATCH',
            body: JSON.stringify({
              modules: [{ module_key: key, is_enabled: enabled }],
            }),
          },
        );

        setFlags(result.channels);
        setNotice(enabled ? 'WhatsApp switched on.' : 'WhatsApp switched off.');
      } catch {
        setError('Could not save that change.');
      } finally {
        setSavingKey(null);
      }
    },
    [schoolId],
  );

  return (
    <Card>
      <div className="space-y-4">
        {PLATFORM_CHANNELS.map((channel) => {
          const enabled = flags[channel.key];
          const isSaving = savingKey === channel.key;

          return (
            <div
              key={channel.key}
              className="flex items-start justify-between gap-6 border-b border-line pb-4 last:border-0 last:pb-0"
            >
              <div className="min-w-0">
                <p className="text-sm font-medium text-ink">{channel.label}</p>
                <p className="mt-1 text-sm text-ink-muted">{channel.description}</p>

                {enabled ? null : (
                  <p className="mt-2 text-sm text-status-warning-ink">
                    Guardians with no email address on file will not receive fee
                    notices while this is off.
                  </p>
                )}
              </div>

              <Button
                variant={enabled ? 'secondary' : 'primary'}
                isLoading={isSaving}
                disabled={!loaded}
                onClick={() => {
                  void toggle(channel.key, !enabled);
                }}
              >
                {enabled ? 'Disconnect' : 'Connect'}
              </Button>
            </div>
          );
        })}

        {error !== null ? (
          <p role="alert" className="rounded-lg bg-status-danger-subtle px-3 py-2 text-sm text-status-danger-ink">
            {error}
          </p>
        ) : notice !== null ? (
          <p role="status" className="rounded-lg bg-surface-sunken px-3 py-2 text-sm text-ink-muted">
            {notice}
          </p>
        ) : null}
      </div>
    </Card>
  );
}
