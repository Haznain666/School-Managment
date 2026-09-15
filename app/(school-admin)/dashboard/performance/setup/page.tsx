import type { Metadata } from 'next';
import { redirect } from 'next/navigation';

import { PerformanceSetup } from '@/components/performance/PerformanceSetup';
import { PerformanceTabs, canOpenSetup } from '@/components/performance/PerformanceTabs';
import { PageHeader } from '@/components/ui/PageHeader';
import { loadKpiContext } from '@/lib/kpi-access';
import { buildSetup } from '@/lib/kpi-board';
import { requireSchoolRole } from '@/lib/school-guard';
import { ADMIN_PORTAL_ROLES } from '@/types/school-auth';

export const metadata: Metadata = {
  title: 'Staff performance setup',
};

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * Staff performance → Setup — Sprint 32.
 *
 * The School Administrator's two rating settings and vice-principal links, a
 * principal's coordinator assignments, and — at a school with several
 * principals — every teacher's one principal and the transfers between them.
 */
export default async function PerformanceSetupPage() {
  const { claims, locationId } = await requireSchoolRole(ADMIN_PORTAL_ROLES);
  const ctx = await loadKpiContext(locationId, claims);
  const permissions = [...ctx.permissions];

  if (!canOpenSetup(claims.role, permissions)) redirect('/dashboard/performance');

  const setup = await buildSetup(ctx);

  return (
    <div className="space-y-6">
      <PageHeader
        breadcrumbs={[
          { label: 'Staff performance', href: '/dashboard/performance' },
          { label: 'Setup' },
        ]}
        title="Setup"
        description="Who rates principals and branch admins, which teachers each coordinator supervises, and which principal each teacher answers to."
        below={
          <PerformanceTabs
            role={claims.role}
            permissions={permissions}
            current="/dashboard/performance/setup"
          />
        }
      />
      <PerformanceSetup initial={setup} canRequestTransfer={claims.role === 'principal'} />
    </div>
  );
}
