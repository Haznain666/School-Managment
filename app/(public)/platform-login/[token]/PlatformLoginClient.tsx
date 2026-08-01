'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';

import { establishSession } from '@/components/school/useOtpCountdown';

export interface PlatformLoginClientProps {
  token: string;
  schoolSlug: string | null;
}

interface RedeemData {
  customToken: string;
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

        const slug = payload.data.schoolSlug;
        const session = await establishSession(payload.data.customToken, slug);

        if ('error' in session) {
          if (!cancelled) setFailure({ code: 'session_failed', message: session.error });
          return;
        }

        // Always the admin dashboard: this flow only ever mints school_admin.
        router.replace(
          slug === '' ? '/dashboard' : `/dashboard?school=${encodeURIComponent(slug)}`,
        );
        router.refresh();
      } catch {
        if (!cancelled) {
          setFailure({
            code: 'network',
            message: 'Could not reach the server. Try again.',
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
      <div className="rounded-card border border-slate-200 bg-white p-6 text-center shadow-card">
        <h2 className="text-base font-semibold text-slate-900">
          This sign-in link cannot be used
        </h2>
        <p className="mt-2 text-sm text-slate-600">{failure.message}</p>

        {isRetryable(failure.code) ? (
          <p className="mt-4 text-sm text-slate-500">
            Links expire two minutes after they are issued. Open the school
            again from the Super Admin panel to get a fresh one.
          </p>
        ) : (
          <p className="mt-4 text-sm text-slate-500">
            This is not an expired link — a fresh one will fail the same way.
            Open{' '}
            <span className="font-mono text-xs">
              /api/super-admin/diagnostics/platform-login
            </span>{' '}
            while signed in to the panel to see which step is failing.
          </p>
        )}

        <p className="mt-3 text-xs text-slate-400">
          Reference: <span className="font-mono">{failure.code}</span>
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-card border border-slate-200 bg-white p-6 text-center shadow-card">
      <span
        aria-hidden="true"
        className="mx-auto mb-4 block h-8 w-8 animate-spin rounded-full border-2 border-brand-primary border-t-transparent"
      />
      <p role="status" className="text-sm text-slate-600">
        Signing you in as platform administrator…
      </p>
    </div>
  );
}
