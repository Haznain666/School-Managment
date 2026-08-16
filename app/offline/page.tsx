import type { Metadata } from 'next';
import Link from 'next/link';

export const metadata: Metadata = {
  title: 'Offline',
};

/**
 * The offline shell.
 *
 * ── It knows nothing about anybody, and that is the requirement ──────────
 * This is the one page the service worker caches, so it is served from a store
 * that outlives a session on a device that may be shared. It therefore holds no
 * school name, no colours read from a tenant, no user's name — nothing that
 * could identify whose phone this was the last time it worked. Everything on it
 * is a fixed string.
 *
 * It is also the only page in the app that is deliberately *not* branded, which
 * looks like an oversight and is not.
 *
 * ── Static, and it must stay static ──────────────────────────────────────
 * No `force-dynamic`, no session read, no database. A page the worker
 * pre-caches at install time cannot depend on a request that will not exist
 * when it is served.
 */
export default function OfflinePage() {
  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col items-center justify-center gap-4 p-6 text-center">
      <h1 className="text-xl font-semibold text-ink">You are offline</h1>
      <p className="text-sm text-ink-muted">
        This app needs a connection to show your attendance, fees and results —
        they change through the day, and showing you yesterday&rsquo;s would be
        worse than showing you none.
      </p>
      <p className="text-sm text-ink-muted">
        Reconnect and try again. Nothing you had entered has been lost.
      </p>
      {/*
        `Link` rather than a bare anchor, because the lint rule that forbids one
        here is right: a plain <a> to an internal route throws away the client
        router. The concern that suggested an anchor — that this page is served
        from a cache to a browser which may have loaded nothing else — is
        answered by the fact that a Next `Link` still renders a real anchor and
        still navigates with JavaScript disabled.
      */}
      <Link
        href="/"
        className="rounded-lg bg-brand-primary px-4 py-2 text-sm font-medium text-brand-onPrimary"
      >
        Try again
      </Link>
    </main>
  );
}
