import type { CSSProperties, ReactNode } from 'react';

import { paletteToCSSVars } from '@/lib/branding';
import { getCurrentSchoolBranding } from '@/lib/school-tenant';

export interface BrandedLoginLayoutProps {
  subtitle?: string;
  children: ReactNode;
}

/**
 * Centred, school-branded frame for the public pages.
 *
 * Branding is read from the school middleware resolved for this hostname, so
 * the logo and palette on the page always belong to the same school the
 * credentials will be checked against.
 */
export async function BrandedLoginLayout({
  subtitle,
  children,
}: BrandedLoginLayoutProps) {
  const school = await getCurrentSchoolBranding();
  const brandStyle = paletteToCSSVars(school?.palette ?? null) as unknown as CSSProperties;

  return (
    <main
      style={brandStyle}
      className="flex min-h-screen items-center justify-center bg-surface-sunken px-4 py-12"
    >
      <div className="w-full max-w-sm">
        <div className="mb-8 flex flex-col items-center text-center">
          {school?.logoUrl != null && school.logoUrl !== '' ? (
            // Logo dimensions vary per school; a plain <img> avoids forcing one.
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={school.logoUrl}
              alt={`${school.name} logo`}
              className="mb-4 h-16 w-16 rounded-xl object-contain"
            />
          ) : (
            <span
              aria-hidden="true"
              className="mb-4 flex h-16 w-16 items-center justify-center rounded-xl bg-brand-primary text-xl font-bold text-brand-onPrimary"
            >
              {(school?.name ?? 'SMS').slice(0, 2).toUpperCase()}
            </span>
          )}

          <h1 className="text-2xl font-bold text-ink">
            {school?.name ?? 'SMS Platform'}
          </h1>
          {subtitle !== undefined ? (
            <p className="mt-1 text-sm text-ink-muted">{subtitle}</p>
          ) : null}
        </div>

        {children}
      </div>
    </main>
  );
}
