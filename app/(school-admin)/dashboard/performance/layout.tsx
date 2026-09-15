import Link from 'next/link';
import type { ReactNode } from 'react';

import { Card } from '@/components/ui/Card';
import { getModuleFlags } from '@/lib/school-queries';
import { requireSchoolRole } from '@/lib/school-guard';
import { ADMIN_PORTAL_ROLES } from '@/types/school-auth';

/**
 * Module gate for every Staff performance screen — Sprint 32.
 *
 * `staff_kpis` is a paid module. A school without it sees no navigation for
 * it, every route behind it refuses (`module: 'staff_kpis'` on each), and a
 * typed URL lands here rather than on a working screen.
 */
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export default async function PerformanceLayout({ children }: { children: ReactNode }) {
  const { locationId } = await requireSchoolRole(ADMIN_PORTAL_ROLES);
  const moduleFlags = await getModuleFlags(locationId);

  if (!moduleFlags.staff_kpis) {
    return (
      <Card>
        <h2 className="text-lg font-semibold text-ink">Staff KPIs &amp; Performance is not enabled</h2>
        <p className="mt-2 text-sm text-ink-muted">
          This school does not currently have the Staff KPIs &amp; Performance module switched on.
          Contact the platform administrator to enable it.
        </p>
        <Link
          href="/dashboard"
          className="mt-4 inline-block text-sm font-medium text-brand-primary hover:underline"
        >
          Back to dashboard
        </Link>
      </Card>
    );
  }

  return <>{children}</>;
}
