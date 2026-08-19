'use client';

import { useEffect, useState } from 'react';

/**
 * A progress bar across the top of the window while a navigation is in flight.
 *
 * ── Why this exists alongside `loading.tsx` ──────────────────────────────
 * A route's `loading.tsx` is the right answer once the new route has started
 * rendering. It does not cover the gap before that: the click, the request
 * leaving the browser, and the wait for the first byte. Measured against the
 * live origin on 2026-08-19 that gap was ~1s, and during it the old page just
 * sits there — indistinguishable from a click that missed.
 *
 * ── Why it watches `fetch` and not clicks ────────────────────────────────
 * The first version of this listened for clicks on anchors, which was wrong in
 * a way that only showed up in the browser: the landing page navigates with
 * `router.push` from a `<button>`, and so do the panel chooser, the school
 * switcher and every redirect-after-save in the app. None of them are anchors.
 * Widening the listener to all buttons would have lit the bar for every
 * dropdown and dialog in the product.
 *
 * Every App Router navigation — `<Link>`, `router.push`, `router.replace`,
 * `router.refresh` alike — fetches the new route from the server with an
 * `RSC: 1` request header. Counting those in flight catches all of them, and
 * catches nothing else. It is one interception in one component rather than a
 * convention every future call site has to remember, which is the same reason
 * `check-loaders` exists.
 *
 * Prefetches carry `Next-Router-Prefetch` and are excluded: they happen on
 * hover and on viewport entry, nobody is waiting for them, and a bar that
 * flickers when the pointer crosses a menu is noise.
 *
 * ── Why the fallback timer ───────────────────────────────────────────────
 * A request that never settles — a dropped connection, a tab suspended
 * mid-navigation — would otherwise leave the bar up forever. The counter is
 * decremented in a `finally`, so this only covers a promise that never
 * resolves at all.
 */

/** Header Next.js sets on every App Router navigation request. */
const RSC_HEADER = 'rsc';
/** Header it *also* sets when the request is only a prefetch. */
const PREFETCH_HEADER = 'next-router-prefetch';

function headerOf(init: RequestInit | undefined, input: RequestInfo | URL, name: string) {
  const fromInit = init?.headers;
  if (fromInit !== undefined) {
    const headers = new Headers(fromInit);
    const value = headers.get(name);
    if (value !== null) return value;
  }
  if (input instanceof Request) return input.headers.get(name);
  return null;
}

export function RouteProgress() {
  const [pending, setPending] = useState(0);
  const [finishing, setFinishing] = useState(false);

  useEffect(() => {
    // Bound, so the patched version can call it without carrying `this`
    // through — native fetch throws an Illegal invocation if detached.
    const original = window.fetch.bind(window);
    const restore = window.fetch;
    let live = 0;

    window.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
      const isNavigation =
        headerOf(init, input, RSC_HEADER) !== null &&
        headerOf(init, input, PREFETCH_HEADER) === null;

      if (!isNavigation) return original(input, init);

      live += 1;
      setPending(live);

      return original(input, init).finally(() => {
        live = Math.max(0, live - 1);
        setPending(live);
      });
    }) as typeof window.fetch;

    return () => {
      window.fetch = restore;
    };
  }, []);

  // Fill and fade once the last navigation settles, rather than vanishing —
  // a bar that disappears mid-way reads as a failure.
  useEffect(() => {
    if (pending > 0) {
      setFinishing(false);
      return;
    }
    if (!finishing) return;

    const timer = window.setTimeout(() => setFinishing(false), 260);
    return () => window.clearTimeout(timer);
  }, [pending, finishing]);

  useEffect(() => {
    if (pending > 0) setFinishing(true);
  }, [pending]);

  // Retire a bar whose navigation never arrived at all.
  useEffect(() => {
    if (pending === 0) return;
    const timer = window.setTimeout(() => setPending(0), 20_000);
    return () => window.clearTimeout(timer);
  }, [pending]);

  if (pending === 0 && !finishing) return null;

  const running = pending > 0;

  return (
    <div
      // Announced rather than silent: a screen-reader user gets the same
      // "something is loading" the bar gives everyone else.
      role="status"
      aria-live="polite"
      aria-label="Loading page"
      className="pointer-events-none fixed inset-x-0 top-0 z-[100] h-0.5"
    >
      <div
        className={
          running
            ? 'h-full w-full origin-left animate-route-progress bg-brand-primary'
            : 'h-full w-full origin-left scale-x-100 bg-brand-primary opacity-0 transition-[transform,opacity] duration-200 ease-out'
        }
      />
    </div>
  );
}
