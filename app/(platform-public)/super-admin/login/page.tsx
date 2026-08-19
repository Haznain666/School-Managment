import type { Metadata } from 'next';
import { Suspense } from 'react';

import { SuperAdminLoginForm } from './SuperAdminLoginForm';

export const metadata: Metadata = {
  title: 'Super Admin sign in',
};

/**
 * Super Admin sign-in.
 *
 * Middleware lets this page through without a session and redirects here from
 * anywhere else under `/super-admin`. If a valid session already exists it
 * redirects away, so this form is only ever shown to a signed-out operator.
 *
 * ── Why this page is static, and must stay static ────────────────────────
 * It used to `await searchParams` for the post-login redirect target, which
 * forced `dynamic = 'force-dynamic'`. Measured against the live origin on
 * 2026-08-19, that cost **0.82–1.23s of server time on 12 of 12 samples** — for
 * a page that runs no query, reads no session and renders a form. Every other
 * public page in the app answered in ~85ms over the same minutes, because the
 * CDN could cache them and this one it could never cache.
 *
 * The parameter now reaches `SuperAdminLoginForm` through `useSearchParams`,
 * so nothing on the server depends on the request and the page is prerendered
 * once at build time. `safeRedirect` in that component is what makes the value
 * safe to act on, and it always was — moving where it is read changes nothing
 * about the check.
 *
 * Do not reintroduce `searchParams`, `cookies()`, `headers()` or a database
 * read here. Any one of them silently returns this route to ~1s per request.
 *
 * ── Why it sits in `(platform-public)` and not `(super-admin)` ───────────
 * Making the page itself static was not enough. `app/(super-admin)/layout.tsx`
 * is `force-dynamic` and reads the session cookie, and a dynamic layout drags
 * every route beneath it dynamic too — the build still marked this route `ƒ`
 * after the `searchParams` change, and the measurement did not move.
 *
 * It renders identically either way: that layout returns `<>{children}</>`
 * when there is no session, which on this route is always. So the route lives
 * in its own group, outside the shell it was never inside, with a copy of the
 * same error boundary.
 *
 * Nothing else belongs in `(platform-public)`. Anything that needs the
 * operator's session belongs under `(super-admin)`, where the layout verifies
 * it.
 */
export default function SuperAdminLoginPage() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-surface-sunken px-4 py-12">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <h1 className="text-2xl font-bold text-ink">SMS Platform</h1>
          <p className="mt-1 text-sm text-ink-muted">Super Admin sign in</p>
        </div>

        {/*
          `useSearchParams` in a prerendered route must sit behind a Suspense
          boundary — without one Next.js refuses to statically render the page
          and quietly opts the whole route back into dynamic rendering, which is
          exactly the cost this page was changed to avoid.
        */}
        <Suspense fallback={<div className="h-64" aria-hidden="true" />}>
          <SuperAdminLoginForm />
        </Suspense>

        <p className="mt-6 text-center text-xs text-ink-muted">
          This panel manages every school on the platform.
        </p>
      </div>
    </main>
  );
}
