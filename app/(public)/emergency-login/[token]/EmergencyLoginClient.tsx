'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';

import { ROLE_HOME_ROUTES, isUserRole } from '@/types/school-auth';

export interface EmergencyLoginClientProps {
  token: string;
  schoolSlug: string | null;
}

interface RedeemData {
  role: string;
}

interface Envelope<T> {
  ok: boolean;
  data?: T;
  error?: { message: string };
}

/**
 * Redeems an emergency link on load and signs the user in.
 *
 * The link is single-use, so this must fire exactly once — React's strict-mode
 * double-invoke would otherwise spend the token on the first pass and show a
 * failure on the second. The ref guards against that.
 */
export function EmergencyLoginClient({ token, schoolSlug }: EmergencyLoginClientProps) {
  const router = useRouter();
  const hasRun = useRef(false);
  const [error, setError] = useState<string | null>(null);

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
          `/api/school/emergency-login/${token}${query}`,
        );

        const payload = (await response.json()) as Envelope<RedeemData>;

        if (!response.ok || payload.ok !== true || payload.data === undefined) {
          if (!cancelled) setError(payload.error?.message ?? 'invalid');
          return;
        }

        // The cookie is already set on the response above.
        const home = isUserRole(payload.data.role)
          ? ROLE_HOME_ROUTES[payload.data.role]
          : '/dashboard';

        router.replace(
          schoolSlug === null || schoolSlug === ''
            ? home
            : `${home}?school=${encodeURIComponent(schoolSlug)}`,
        );
        router.refresh();
      } catch {
        if (!cancelled) setError('network');
      }
    };

    void redeem();

    return () => {
      cancelled = true;
    };
  }, [token, schoolSlug, router]);

  if (error !== null) {
    return (
      <div className="rounded-card border border-slate-200 bg-white p-6 text-center shadow-card">
        <h2 className="text-base font-semibold text-slate-900">
          This emergency link cannot be used
        </h2>
        <p className="mt-2 text-sm text-slate-600">
          It is invalid, expired, or has already been used.
        </p>
        <p className="mt-4 text-sm text-slate-500">
          Contact your platform administrator to generate a new one.
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
        Verifying emergency access…
      </p>
    </div>
  );
}
