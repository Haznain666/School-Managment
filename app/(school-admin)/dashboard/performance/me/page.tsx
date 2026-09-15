import type { Metadata } from 'next';

import { PerformanceTabs } from '@/components/performance/PerformanceTabs';
import { PersonSheetView } from '@/components/performance/PersonSheetView';
import { EmptyState } from '@/components/ui/EmptyState';
import { PageHeader } from '@/components/ui/PageHeader';
import { loadKpiContext } from '@/lib/kpi-access';
import { buildPersonSheet } from '@/lib/kpi-board';
import { requireSchoolRole } from '@/lib/school-guard';
import { ADMIN_PORTAL_ROLES } from '@/types/school-auth';

export const metadata: Metadata = {
  title: 'My performance',
};

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * A member of staff's own scores — Sprint 32, rule 10.
 *
 * There is no id in this page. The person is the signed-in account, the way a
 * teacher's payslips are, so "whose scores" cannot be asked.
 */
export default async function MyPerformancePage() {
  const { claims, locationId } = await requireSchoolRole(ADMIN_PORTAL_ROLES);
  const ctx = await loadKpiContext(locationId, claims);
  const me = ctx.caller.userId === null ? undefined : ctx.byId.get(ctx.caller.userId);
  const sheet = me === undefined ? null : await buildPersonSheet(ctx, me, null);

  return (
    <div className="space-y-6">
      <PageHeader
        title="My performance"
        description="Your KPIs, the score that counts for each, and your overall for the month and the year."
        below={
          <PerformanceTabs
            role={claims.role}
            permissions={[...ctx.permissions]}
            current="/dashboard/performance/me"
          />
        }
      />
      {sheet === null ? (
        <EmptyState
          title="Your role is not rated with KPIs"
          description="KPIs are written for roles below the School Administrator. Nothing here applies to you."
        />
      ) : (
        <PersonSheetView initial={sheet} apiPath="/api/school/kpis/people/me" />
      )}
    </div>
  );
}
