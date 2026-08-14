import Link from 'next/link';
import type { ReactNode } from 'react';

import { Card } from '@/components/ui/Card';
import { getModuleFlags } from '@/lib/school-queries';
import { requireSchoolPermission } from '@/lib/school-guard';

/**
 * Module gate for every HR screen.
 *
 * The sidebar hides these links when the module is off, but a link is not a
 * permission — a bookmark or a typed URL would otherwise walk straight in. The
 * check lives in a layout so that adding a page later cannot forget it.
 *
 * The role list is narrower than the rest of the dashboard: an accountant has
 * no business in a teacher's personnel file, so `HR_READ_ROLES` is what gets
 * through here. Payroll has its own layout with its own, different list.
 */
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export default async function HrLayout({ children }: { children: ReactNode }) {
  const { locationId } = await requireSchoolPermission('hr.read');
  const moduleFlags = await getModuleFlags(locationId);

  if (!moduleFlags.hr_payroll) {
    return (
      <Card>
        <h2 className="text-lg font-semibold text-ink">
          HR &amp; Payroll is not enabled
        </h2>
        <p className="mt-2 text-sm text-ink-muted">
          This school does not currently have the HR &amp; Payroll module switched
          on. Contact the platform administrator to enable it.
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
