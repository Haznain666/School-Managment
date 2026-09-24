'use client';

import { useEffect, useRef, useState } from 'react';

interface Envelope {
  ok: boolean;
  data?: { redirectTo: string };
  error?: { code?: string; message: string };
}

/**
 * Redeems an apex sign-in hand-off on load — Sprint 35, §7.4.
 *
 * Fires once (the ref survives strict mode's double effect): the token is
 * single-use, so a second request would be refused and would overwrite a
 * success with an error.
 *
 * The next page is reached with a full navigation, not `router.replace`: this
 * page was loaded cold from another host, and `router.refresh()` does nothing
 * on a hard-loaded page — the portal would render with the pre-sign-in RSC
 * payload and bounce to the login screen (STATE.md; the memory of it is why).
 */
export function HandoffClient({ token, schoolSlug }: { token: string; schoolSlug: string | null }) {
  const hasRun = useRef(false);
  const [failure, setFailure] = useState<string | null>(null);

  useEffect(() => {
    if (hasRun.current) return;
    hasRun.current = true;

    const query = schoolSlug === null || schoolSlug === '' ? '' : `?school=${encodeURIComponent(schoolSlug)}`;

    void (async () => {
      try {
        const response = await fetch(`/api/school/auth/handoff/${encodeURIComponent(token)}${query}`, {
          method: 'POST',
        });
        const payload = (await response.json()) as Envelope;

        if (!response.ok || payload.ok !== true || payload.data === undefined) {
          setFailure(payload.error?.message ?? 'This sign-in link cannot be used.');
          return;
        }

        window.location.replace(`${payload.data.redirectTo}${query}`);
      } catch {
        setFailure('The school could not be reached. Sign in again.');
      }
    })();
  }, [token, schoolSlug]);

  if (failure !== null) {
    return (
      <div className="rounded-card border border-line bg-surface-raised p-6 text-center shadow-card">
        <h2 className="text-base font-semibold text-ink">This sign-in link cannot be used</h2>
        <p className="mt-2 text-sm text-ink-muted">{failure}</p>
        <p className="mt-4 text-sm text-ink-muted">
          Links work once, for one minute. Sign in again from the SchoolHub home page, or from
          this school&apos;s own sign-in page.
        </p>
        <a
          href={schoolSlug === null || schoolSlug === '' ? '/login' : `/login?school=${encodeURIComponent(schoolSlug)}`}
          className="mt-4 inline-block text-sm font-medium text-brand-primary hover:underline"
        >
          Go to this school&apos;s sign-in page
        </a>
      </div>
    );
  }

  return (
    <div className="rounded-card border border-line bg-surface-raised p-6 text-center shadow-card">
      <span
        aria-hidden="true"
        className="mx-auto mb-4 block h-8 w-8 animate-spin rounded-full border-2 border-brand-primary border-t-transparent"
      />
      <p role="status" className="text-sm text-ink-muted">
        Signing you in…
      </p>
    </div>
  );
}
