import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

import { PersonSheetView } from '@/components/performance/PersonSheetView';
import { PageHeader } from '@/components/ui/PageHeader';
import { loadKpiContext } from '@/lib/kpi-access';
import { buildPersonSheet } from '@/lib/kpi-board';
import { requireSchoolRole } from '@/lib/school-guard';
import { isUuid } from '@/lib/validation';
import { ADMIN_PORTAL_ROLES, ROLE_LABELS } from '@/types/school-auth';

export const metadata: Metadata = {
  title: 'Staff performance',
};

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * One member of staff's KPIs, ratings and history — Sprint 32.
 *
 * Somebody outside the caller's reach is a 404, the same answer the API gives:
 * whether a colleague is rated at all is not everybody's business.
 */
export default async function StaffPerformancePage({
  params,
}: {
  params: Promise<{ userId: string }>;
}) {
  const { userId } = await params;
  const { claims, locationId } = await requireSchoolRole(ADMIN_PORTAL_ROLES);
  if (!isUuid(userId)) notFound();

  const ctx = await loadKpiContext(locationId, claims);
  const target = ctx.byId.get(userId);
  if (target === undefined) notFound();

  const sheet = await buildPersonSheet(ctx, target, null);
  if (sheet === null) notFound();

  return (
    <div className="space-y-6">
      <PageHeader
        breadcrumbs={[
          { label: 'Staff performance', href: '/dashboard/performance' },
          { label: target.name },
        ]}
        title={target.name}
        description={`${ROLE_LABELS[target.role]}${target.designation === null ? '' : ` · ${target.designation}`}`}
      />
      <PersonSheetView initial={sheet} apiPath={`/api/school/kpis/people/${target.userId}`} />
    </div>
  );
}
