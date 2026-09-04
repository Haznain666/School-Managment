'use client';

import { useCallback, useEffect, useState } from 'react';

import { Button } from '@/components/ui/Button';
import { schoolErrorMessage, schoolFetch } from '@/lib/school-client';

/**
 * The two switches that decide whether a message makes a noise.
 *
 * ── Why these live on the chat screen and not in Settings ────────────────
 * Somebody who has just been startled by a chime looks for the way to stop it
 * **where they heard it**. A sound control two navigations away in a settings
 * screen is one people ask support about instead of finding.
 *
 * The parent portal also carries the sound switch in `/parent/settings`, beside
 * the email preferences, because that is where a parent goes to turn everything
 * down at once. Both write the same column.
 *
 * ── Push is a browser permission, not a preference ───────────────────────
 * Enabling asks the browser, and a browser that has already been told "block"
 * cannot be asked again from here — the person has to change it in site
 * settings. So the button reports the actual permission state rather than
 * pretending a click will work.
 *
 * On iOS, Safari delivers Web Push **only after the site has been added to the
 * home screen**. That is not something this component can fix and not something
 * to hide: it says so, rather than subscribing and silently never firing.
 */

interface ChatSettings {
  studentsMayInitiate: boolean;
  soundEnabled: boolean;
  quietHoursFrom: number | null;
  quietHoursTo: number | null;
}

interface RealtimeConfig {
  vapidPublicKey: string | null;
}

export interface ChatNotificationControlsProps {
  /** Told when the sound preference changes, so the workspace stops chiming. */
  onSoundChange: (enabled: boolean) => void;
}

/** The base64url VAPID key, as the browser's subscribe call wants it. */
function urlBase64ToUint8Array(base64: string): Uint8Array {
  const padded = base64.padEnd(base64.length + ((4 - (base64.length % 4)) % 4), '=');
  const normalised = padded.replace(/-/g, '+').replace(/_/g, '/');
  const raw = window.atob(normalised);

  const out = new Uint8Array(raw.length);
  for (let index = 0; index < raw.length; index += 1) out[index] = raw.charCodeAt(index);
  return out;
}

/** Safari on iOS delivers push only from a home-screen install. */
function isIosSafari(): boolean {
  if (typeof navigator === 'undefined') return false;
  return /iP(hone|ad|od)/.test(navigator.userAgent);
}

function isStandalone(): boolean {
  if (typeof window === 'undefined') return false;
  return (
    window.matchMedia('(display-mode: standalone)').matches ||
    (window.navigator as unknown as { standalone?: boolean }).standalone === true
  );
}

type PushState = 'unsupported' | 'blocked' | 'off' | 'on' | 'needs-home-screen';

export function ChatNotificationControls({ onSoundChange }: ChatNotificationControlsProps) {
  const [settings, setSettings] = useState<ChatSettings | null>(null);
  const [push, setPush] = useState<PushState>('unsupported');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      try {
        const result = await schoolFetch<{ settings: ChatSettings }>(
          '/api/school/chat/settings',
        );
        setSettings(result.settings);
        onSoundChange(result.settings.soundEnabled);
      } catch {
        /* The screen works without the switch; it just shows nothing. */
      }
    })();
    // `onSoundChange` is a stable callback from the parent's `useCallback`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    void (async () => {
      if (typeof window === 'undefined') return;
      if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
        setPush('unsupported');
        return;
      }

      if (isIosSafari() && !isStandalone()) {
        setPush('needs-home-screen');
        return;
      }

      if (Notification.permission === 'denied') {
        setPush('blocked');
        return;
      }

      try {
        const registration = await navigator.serviceWorker.ready;
        const existing = await registration.pushManager.getSubscription();
        setPush(existing === null ? 'off' : 'on');
      } catch {
        setPush('unsupported');
      }
    })();
  }, []);

  const toggleSound = useCallback(async () => {
    if (settings === null || busy) return;

    const next = !settings.soundEnabled;
    setBusy(true);
    setError(null);

    // Optimistic: a switch that waits for a round trip before moving feels
    // broken, and the failure path puts it back.
    setSettings({ ...settings, soundEnabled: next });
    onSoundChange(next);

    try {
      await schoolFetch('/api/school/chat/settings', {
        method: 'PATCH',
        body: JSON.stringify({
          studentsMayInitiate: settings.studentsMayInitiate,
          soundEnabled: next,
          quietHoursFrom: settings.quietHoursFrom,
          quietHoursTo: settings.quietHoursTo,
        }),
      });
    } catch (caught) {
      setSettings({ ...settings, soundEnabled: !next });
      onSoundChange(!next);
      setError(schoolErrorMessage(caught, 'That preference could not be saved.'));
    } finally {
      setBusy(false);
    }
  }, [settings, busy, onSoundChange]);

  const enablePush = useCallback(async () => {
    if (busy) return;
    setBusy(true);
    setError(null);

    try {
      const permission = await Notification.requestPermission();
      if (permission !== 'granted') {
        setPush(permission === 'denied' ? 'blocked' : 'off');
        return;
      }

      const config = await schoolFetch<RealtimeConfig>('/api/school/chat/realtime-config');
      if (config.vapidPublicKey === null) {
        setError('This school cannot send notifications yet.');
        return;
      }

      const registration = await navigator.serviceWorker.ready;
      const subscription = await registration.pushManager.subscribe({
        // Chrome refuses a subscription without it, and a push nobody can read
        // is not one worth sending.
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(config.vapidPublicKey) as BufferSource,
      });

      const json = subscription.toJSON();

      await schoolFetch('/api/school/chat/push-subscription', {
        method: 'POST',
        body: JSON.stringify({
          endpoint: subscription.endpoint,
          p256dh: json.keys?.p256dh ?? '',
          auth: json.keys?.auth ?? '',
          userAgent: navigator.userAgent,
        }),
      });

      setPush('on');
    } catch (caught) {
      setError(schoolErrorMessage(caught, 'Notifications could not be switched on.'));
    } finally {
      setBusy(false);
    }
  }, [busy]);

  const disablePush = useCallback(async () => {
    if (busy) return;
    setBusy(true);
    setError(null);

    try {
      const registration = await navigator.serviceWorker.ready;
      const subscription = await registration.pushManager.getSubscription();

      if (subscription !== null) {
        await schoolFetch('/api/school/chat/push-subscription', {
          method: 'DELETE',
          body: JSON.stringify({ endpoint: subscription.endpoint }),
        });
        await subscription.unsubscribe();
      }

      setPush('off');
    } catch (caught) {
      setError(schoolErrorMessage(caught, 'Notifications could not be switched off.'));
    } finally {
      setBusy(false);
    }
  }, [busy]);

  return (
    <div className="flex flex-wrap items-center gap-3 border-b border-line px-3 py-2">
      {settings !== null ? (
        <label className="flex items-center gap-2 text-sm text-ink">
          <input
            type="checkbox"
            checked={settings.soundEnabled}
            disabled={busy}
            onChange={() => void toggleSound()}
            className="h-4 w-4 rounded border-line-strong"
          />
          Sound when a message arrives
        </label>
      ) : null}

      {push === 'on' ? (
        <Button variant="ghost" size="sm" disabled={busy} onClick={() => void disablePush()}>
          Turn off phone notifications
        </Button>
      ) : null}

      {push === 'off' ? (
        <Button variant="secondary" size="sm" disabled={busy} onClick={() => void enablePush()}>
          Notify me on this device
        </Button>
      ) : null}

      {push === 'blocked' ? (
        <span className="text-xs text-ink-muted">
          Notifications are blocked for this site in your browser settings.
        </span>
      ) : null}

      {push === 'needs-home-screen' ? (
        <span className="text-xs text-ink-muted">
          To get notifications on iPhone, add this site to your Home Screen first.
        </span>
      ) : null}

      {error !== null ? (
        <span role="alert" className="text-xs text-status-danger-onSoft">
          {error}
        </span>
      ) : null}
    </div>
  );
}
