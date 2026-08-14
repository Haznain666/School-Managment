import Link from 'next/link';
import type { ReactNode } from 'react';

import { Card } from '@/components/ui/Card';
import { getModuleFlags } from '@/lib/school-queries';
import { requireSchoolPermission } from '@/lib/school-guard';

/**
 * Module gate for every Payroll screen.
 *
 * Separate from the HR layout because the two have different audiences: an
 * accountant reconciles the salary bill against the bank and belongs here, but
 * has no business reading a teacher's personnel file. A branch admin is the
 * mirror image — HR yes, the school's payroll no.
 */
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export default async function PayrollLayout({ children }: { children: ReactNode }) {
  const { locationId } = await requireSchoolPermission('payroll.read');
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
