import type { Metadata } from 'next';

import { KpiManager } from '@/components/performance/KpiManager';
import { PerformanceTabs } from '@/components/performance/PerformanceTabs';
import { PageHeader } from '@/components/ui/PageHeader';
import { resolveBranchScope } from '@/lib/branch-scope';
import { listKpis } from '@/lib/kpi-access';
import { definableTargets } from '@/lib/kpis';
import { requireSchoolPermission } from '@/lib/school-guard';

export const metadata: Metadata = {
  title: 'KPIs',
};

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * KPIs — Sprint 32. Read with `kpis.read`; the buttons are `kpis.create` and
 * `kpis.delete`, and the roles on offer are rule 3's for the caller's own role.
 */
export default async function KpisPage() {
  const { claims, locationId, permissions } = await requireSchoolPermission('kpis.read');
  const scope = await resolveBranchScope(locationId, claims);
  const kpis = await listKpis(locationId, scope.branchIds);

  return (
    <div className="space-y-6">
      <PageHeader
        breadcrumbs={[
          { label: 'Staff performance', href: '/dashboard/performance' },
          { label: 'KPIs' },
        ]}
        title="KPIs"
        description="A KPI belongs to a role, not a person. Everybody in that role is rated on it."
        below={
          <PerformanceTabs
            role={claims.role}
            permissions={permissions}
            current="/dashboard/performance/kpis"
          />
        }
      />
      <KpiManager
        initial={kpis}
        definableRoles={definableTargets(claims.role)}
        canCreate={permissions.includes('kpis.create')}
        canDelete={permissions.includes('kpis.delete')}
        branchOptions={scope.options}
        allowShared={!scope.bound}
      />
    </div>
  );
}
