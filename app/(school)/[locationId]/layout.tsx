import { notFound, redirect } from 'next/navigation';
import type { ReactNode } from 'react';

import { SchoolPortalFrame } from '@/components/layout/SchoolPortalFrame';
import { getSchoolByLocationId } from '@/lib/schools';
import { getTenantFromHeaders } from '@/lib/tenant';

/**
 * School portal layout.
 *
 * The `[locationId]` in the URL is a convenience for routing and deep links —
 * it is NOT trusted. It is checked against the location_id that middleware
 * resolved from the subdomain, so `beaconhouse.platform.com/<other-school>/…`
 * cannot render another tenant's portal. Data access is separately gated by
 * `withAuth()` on every API call.
 */

export const dynamic = 'force-dynamic';

export default async function SchoolLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ locationId: string }>;
}) {
  const { locationId } = await params;
  const tenant = await getTenantFromHeaders();

  // No school resolved from the hostname — nothing to render here.
  if (tenant.locationId === null || tenant.locationId === '') {
    redirect('/');
  }

  // URL tenant must match subdomain tenant.
  if (tenant.locationId !== locationId) {
    redirect(`/${tenant.locationId}/dashboard`);
  }

  const school = await getSchoolByLocationId(locationId);
  if (school === null) {
    notFound();
  }

  return (
    <SchoolPortalFrame
      locationId={school.locationId}
      schoolName={school.schoolName}
      logoUrl={school.logoUrl}
      colorPalette={school.colorPalette}
      moduleFlags={school.moduleFlags}
      title={school.schoolName}
    >
      {children}
    </SchoolPortalFrame>
  );
}
