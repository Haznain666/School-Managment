'use client';

import { useEffect } from 'react';

/**
 * Registers `/sw.js`, once, after the page has settled.
 *
 * ── Registration is deferred to `load` ───────────────────────────────────
 * Registering during render competes with the page's own requests for
 * bandwidth on exactly the connections this is meant to help. The worker is
 * useless until the next navigation anyway, so there is nothing to gain by
 * being early.
 *
 * ── Every failure is swallowed ───────────────────────────────────────────
 * A service worker is an enhancement. Registration fails on an insecure origin,
 * in a private window on some browsers, and wherever a policy forbids it — none
 * of which is a reason to show a parent an error about a thing they did not ask
 * for and cannot fix. The application works identically without it.
 *
 * ── It renders nothing ───────────────────────────────────────────────────
 * Mounted inside each portal layout, so the worker exists for signed-in users
 * and not on the public marketing or login routes. That is deliberate: the app
 * a parent installs should open on their portal.
 */
export function ServiceWorkerRegistrar() {
  useEffect(() => {
    if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return;

    const register = (): void => {
      void navigator.serviceWorker.register('/sw.js', { scope: '/' }).catch(() => undefined);
    };

    if (document.readyState === 'complete') {
      register();
      return;
    }

    window.addEventListener('load', register, { once: true });
    return () => window.removeEventListener('load', register);
  }, []);

  return null;
}
