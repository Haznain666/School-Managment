'use client';

import { useEffect, useState } from 'react';

import { Button } from '@/components/ui/Button';
import { Card, CardTitle } from '@/components/ui/Card';
import { Toggle } from '@/components/ui/Toggle';
import {
  NOTIFICATION_CATEGORIES,
  NOTIFICATION_CATEGORY_DESCRIPTIONS,
  NOTIFICATION_CATEGORY_LABELS,
  type NotificationCategory,
} from '@/db/schema';
import { schoolErrorMessage, schoolFetch } from '@/lib/school-client';

/**
 * A parent's own email preferences.
 *
 * ── The screen says what it does not do ──────────────────────────────────
 * Each switch is labelled with the fact that it governs the email and not the
 * thing itself: the notice board, the fee page and the register are always
 * there. A preference page that appeared to switch off fee notices and did not
 * would be worse than no preference page at all — the parent would believe they
 * had been told nothing was owed.
 *
 * ── Every category is sent on every save ─────────────────────────────────
 * The API requires all three, so an absent key can never mean two things. That
 * is the ambiguity the bulk module screen was rebuilt to remove (`STATE.md`
 * §5s), and it is cheaper to refuse it here than to discover it once.
 */

type Settings = Record<NotificationCategory, boolean>;

const ALL_ON: Settings = { announcements: true, fees: true, attendance: true };

export function NotificationPreferencesForm() {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void (async () => {
      try {
        setSettings(await schoolFetch<Settings>('/api/school/notification-preferences'));
      } catch (caught) {
        setError(schoolErrorMessage(caught, 'Could not load your preferences.'));
        // Falling back to all-on matches what the server does with no row, so
        // the screen never shows switches that disagree with the stored state.
        setSettings(ALL_ON);
      }
    })();
  }, []);

  const save = async (next: Settings): Promise<void> => {
    setBusy(true);
    setError(null);
    setNotice(null);
    const previous = settings;
    setSettings(next);

    try {
      await schoolFetch('/api/school/notification-preferences', {
        method: 'PATCH',
        body: JSON.stringify(next),
      });
      setNotice('Saved.');
    } catch (caught) {
      // Put the switch back. A toggle that stayed moved after a failed save
      // would tell the parent they had opted out when they had not.
      setSettings(previous);
      setError(schoolErrorMessage(caught, 'Could not save your preferences.'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card
      header={
        <CardTitle
          title="Email notifications"
          description="Which emails this school sends you. Everything is on until you change it."
        />
      }
    >
      {error !== null ? (
        <p
          role="alert"
          className="mb-4 rounded-lg bg-status-danger-subtle px-3 py-2 text-sm text-status-danger-ink"
        >
          {error}
        </p>
      ) : null}

      {notice !== null ? (
        <p className="mb-4 rounded-lg bg-status-success-subtle px-3 py-2 text-sm text-status-success-ink">
          {notice}
        </p>
      ) : null}

      {settings === null ? (
        <p className="text-sm text-ink-muted">Loading your preferences…</p>
      ) : (
        <>
          <ul className="divide-y divide-line">
            {NOTIFICATION_CATEGORIES.map((category) => (
              <li key={category} className="py-4 first:pt-0 last:pb-0">
                <Toggle
                  checked={settings[category]}
                  disabled={busy}
                  label={NOTIFICATION_CATEGORY_LABELS[category]}
                  description={NOTIFICATION_CATEGORY_DESCRIPTIONS[category]}
                  onChange={(next) =>
                    void save({ ...settings, [category]: next })
                  }
                />
              </li>
            ))}
          </ul>

          <p className="mt-5 rounded-lg bg-surface-sunken px-3 py-2 text-xs text-ink-muted">
            Switching an email off never hides anything from you. Notices still
            appear on your notice board and challans still appear on your fee
            page — you simply stop being mailed about them.
          </p>

          {/* Each switch saves on change, so there is nothing to submit. The
              button exists only to retry after a failure, and is shown only
              then. */}
          {error === null ? null : (
            <Button
              className="mt-4"
              variant="secondary"
              isLoading={busy}
              onClick={() => void save(settings)}
            >
              Try again
            </Button>
          )}
        </>
      )}
    </Card>
  );
}
