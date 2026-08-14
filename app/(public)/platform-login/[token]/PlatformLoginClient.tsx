'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';


export interface PlatformLoginClientProps {
  token: string;
  schoolSlug: string | null;
}

interface RedeemData {
  schoolSlug: string;
}

interface Envelope<T> {
  ok: boolean;
  data?: T;
  error?: { code?: string; message: string };
}

interface RedeemFailure {
  code: string;
  message: string;
}

/**
 * Only an expired or wrong-school token is worth suggesting a retry for.
 * Telling an operator to "get a fresh link" when the real fault is a malformed
 * Firebase key sends them round the same loop indefinitely — which is exactly
 * what the first version of this screen did.
 */
function isRetryable(code: string): boolean {
  return code === 'invalid_token';
}

/**
 * Redeems a Super Admin hand-off on load and opens the school's admin portal.
 *
 * The token is short-lived, so this fires once and immediately — React's
 * strict-mode double-invoke would otherwise spend a second of the two-minute
 * window on a duplicate request. The ref guards against that.
 *
 * The session cookie is minted here, on the school's own address, which is the
 * whole reason this page exists: a cookie written back in the panel would not
 * be sent to a school on its own subdomain.
 */
export function PlatformLoginClient({ token, schoolSlug }: PlatformLoginClientProps) {
  const router = useRouter();
  const hasRun = useRef(false);
  const [failure, setFailure] = useState<RedeemFailure | null>(null);

  useEffect(() => {
    if (hasRun.current) return;
    hasRun.current = true;

    let cancelled = false;

    const redeem = async (): Promise<void> => {
      try {
        const query =
          schoolSlug === null || schoolSlug === ''
            ? ''
            : `?school=${encodeURIComponent(schoolSlug)}`;

        const response = await fetch(
          `/api/school/auth/platform-session/${token}${query}`,
          { method: 'POST' },
        );

        const payload = (await response.json()) as Envelope<RedeemData>;

        if (!response.ok || payload.ok !== true || payload.data === undefined) {
          if (!cancelled) {
            setFailure({
              code: payload.error?.code ?? 'unknown',
              message: payload.error?.message ?? 'This sign-in link cannot be used.',
            });
          }
          return;
        }

        // The cookie is already set on the response above.
        const slug = payload.data.schoolSlug;

        // Always the admin dashboard: this flow only ever mints school_admin.
        router.replace(
          slug === '' ? '/dashboard' : `/dashboard?school=${encodeURIComponent(slug)}`,
        );
        router.refresh();
      } catch (caught) {
        // Reached only when something outside the guarded paths throws. It is
        // reported verbatim rather than as "could not reach the server":
        // labelling every unexpected throw a network fault is what sent the
        // last round of debugging looking at connectivity.
        if (!cancelled) {
          setFailure({
            code: 'client_error',
            message:
              caught instanceof Error
                ? caught.message.slice(0, 300)
                : 'Something failed in the browser before the session could start.',
          });
        }
      }
    };

    void redeem();

    return () => {
      cancelled = true;
    };
  }, [token, schoolSlug, router]);

  if (failure !== null) {
    return (
      <div className="rounded-card border border-line bg-surface-raised p-6 text-center shadow-card">
        <h2 className="text-base font-semibold text-ink">
          This sign-in link cannot be used
        </h2>
        <p className="mt-2 text-sm text-ink-muted">{failure.message}</p>

        {isRetryable(failure.code) ? (
          <p className="mt-4 text-sm text-ink-muted">
            Links expire two minutes after they are issued. Open the school
            again from the Super Admin panel to get a fresh one.
          </p>
        ) : (
          <p className="mt-4 text-sm text-ink-muted">
            This is not an expired link — a fresh one will fail the same way.
            The message above names the step that failed. For the full picture,
            open{' '}
            <span className="font-mono text-xs">
              /api/super-admin/diagnostics/platform-login
            </span>{' '}
            in a tab where you are still signed in to the Super Admin panel.
          </p>
        )}

        <p className="mt-3 text-xs text-ink-muted">
          Reference: <span className="font-mono">{failure.code}</span>
        </p>
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
        Signing you in as platform administrator…
      </p>
    </div>
  );
}
