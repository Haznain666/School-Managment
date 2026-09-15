import type { Metadata } from 'next';
import { redirect } from 'next/navigation';

import { PerformanceBoard } from '@/components/performance/PerformanceBoard';
import { PerformanceTabs } from '@/components/performance/PerformanceTabs';
import { PageHeader } from '@/components/ui/PageHeader';
import { loadKpiContext } from '@/lib/kpi-access';
import { buildBoard } from '@/lib/kpi-board';
import { requireSchoolRole } from '@/lib/school-guard';
import { ADMIN_PORTAL_ROLES } from '@/types/school-auth';

export const metadata: Metadata = {
  title: 'Staff performance',
};

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * Staff performance — Sprint 32.
 *
 * In an `(overview)` route group so its loader does not wrap the KPI, Setup and
 * person screens beside it — §5bz's trap, where a root `loading.tsx` streams its
 * skeleton in front of every sibling route on a hard load.
 *
 * Open to `kpis.read` (the whole board) and `kpis.overall` (the yearly column
 * only). Anybody else is sent to their own scores.
 */
export default async function PerformancePage() {
  const { claims, locationId } = await requireSchoolRole(ADMIN_PORTAL_ROLES);
  const ctx = await loadKpiContext(locationId, claims);

  if (!ctx.permissions.has('kpis.read') && !ctx.permissions.has('kpis.overall')) {
    redirect(claims.role === 'school_admin' ? '/dashboard' : '/dashboard/performance/me');
  }

  const board = await buildBoard(ctx, null);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Staff performance"
        description={
          board.overallOnly
            ? 'Each member of staff’s yearly overall score — the plain average of every KPI rating this academic year.'
            : 'Every member of staff in your reach, with this month’s overall and the year’s. Each figure is the plain average of their KPI scores out of 10.'
        }
        below={
          <PerformanceTabs
            role={claims.role}
            permissions={[...ctx.permissions]}
            current="/dashboard/performance"
          />
        }
      />
      <PerformanceBoard initial={board} />
    </div>
  );
}
