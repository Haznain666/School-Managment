import type { Metadata } from 'next';

import { LoginForm } from '@/app/(auth)/login/LoginForm';
import { paletteToCssVariables } from '@/lib/branding';
import { getSchoolByLocationId } from '@/lib/schools';
import { getTenantFromHeaders } from '@/lib/tenant';
import type { CSSProperties } from 'react';

export const metadata: Metadata = {
  title: 'Sign in',
};

// School branding is read per-request from the resolved subdomain.
export const dynamic = 'force-dynamic';

/**
 * Login page. The school it belongs to is decided by the subdomain the browser
 * is on — never by anything the user types — so the branding shown here and
 * the tenant the credentials are checked against are always the same school.
 */
export default async function LoginPage() {
  const tenant = await getTenantFromHeaders();

  const school =
    tenant.locationId === null ? null : await getSchoolByLocationId(tenant.locationId);

  const brandStyle = paletteToCssVariables(
    school?.colorPalette ?? null,
  ) as unknown as CSSProperties;

  return (
    <main
      style={brandStyle}
      className="flex min-h-screen items-center justify-center bg-slate-50 px-4 py-12"
    >
      <div className="w-full max-w-sm">
        <div className="mb-8 flex flex-col items-center text-center">
          {school?.logoUrl != null && school.logoUrl !== '' ? (
            // Logo dimensions vary per school; a plain <img> avoids forcing a size.
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={school.logoUrl}
              alt={`${school.schoolName} logo`}
              className="mb-4 h-16 w-16 rounded-xl object-contain"
            />
          ) : (
            <span
              aria-hidden="true"
              className="mb-4 flex h-16 w-16 items-center justify-center rounded-xl bg-brand-primary text-xl font-bold text-white"
            >
              {(school?.schoolName ?? 'SMS').slice(0, 2).toUpperCase()}
            </span>
          )}

          <h1 className="text-2xl font-bold text-slate-900">
            {school?.schoolName ?? 'SMS Platform'}
          </h1>
          <p className="mt-1 text-sm text-slate-500">Sign in to your portal</p>
        </div>

        <LoginForm
          expectedLocationId={school?.locationId ?? null}
          schoolName={school?.schoolName ?? null}
        />

        <p className="mt-6 text-center text-xs text-slate-400">
          Trouble signing in? Contact your school administrator.
        </p>
      </div>
    </main>
  );
}
