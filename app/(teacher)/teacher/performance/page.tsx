import type { Metadata } from 'next';

import { PersonSheetView } from '@/components/performance/PersonSheetView';
import { EmptyState } from '@/components/ui/EmptyState';
import { PageHeader } from '@/components/ui/PageHeader';
import { loadKpiContext } from '@/lib/kpi-access';
import { buildPersonSheet } from '@/lib/kpi-board';
import { requireSchoolRole } from '@/lib/school-guard';
import { getModuleFlags } from '@/lib/school-queries';

export const metadata: Metadata = {
  title: 'My performance',
};

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * A teacher's own KPI scores — Sprint 32, rule 10.
 *
 * No id anywhere: the person is the signed-in account. The page is fenced by
 * the `staff_kpis` module as well as the sidebar link, because a link is not a
 * permission and a typed URL would otherwise walk in.
 */
export default async function TeacherPerformancePage() {
  const { claims, locationId } = await requireSchoolRole(['teacher']);
  const flags = await getModuleFlags(locationId);

  if (!flags.staff_kpis) {
    return (
      <div className="space-y-6">
        <PageHeader title="My performance" />
        <EmptyState
          title="Staff KPIs are not switched on"
          description="Your school does not use KPI ratings on this portal."
        />
      </div>
    );
  }

  const ctx = await loadKpiContext(locationId, claims);
  const me = ctx.caller.userId === null ? undefined : ctx.byId.get(ctx.caller.userId);
  const sheet = me === undefined ? null : await buildPersonSheet(ctx, me, null);

  return (
    <div className="space-y-6">
      <PageHeader
        title="My performance"
        description="Your KPIs, the score that counts for each, and your overall for the month and the year."
      />
      {sheet === null ? (
        <EmptyState
          title="Nothing to show yet"
          description="Your account is not active as a teacher at this school."
        />
      ) : (
        <PersonSheetView initial={sheet} apiPath="/api/school/kpis/people/me" />
      )}
    </div>
  );
}
