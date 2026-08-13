import Link from 'next/link';
import type { ReactNode } from 'react';

import { Card } from '@/components/ui/Card';
import { getModuleFlags } from '@/lib/school-queries';
import { requireSchoolPermission } from '@/lib/school-guard';

/**
 * Module gate for every Admissions screen.
 *
 * The sidebar already hides these links when the module is off, but a link is
 * not a permission — a bookmark or a typed URL would otherwise walk straight
 * in. The check lives in a layout so that adding a page later cannot forget it.
 *
 * A school that has not bought the module is told so plainly rather than shown
 * a 404: they have not made a mistake, and their administrator can enable it.
 */
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export default async function AdmissionsLayout({ children }: { children: ReactNode }) {
  const { locationId } = await requireSchoolPermission('admissions.read');
  const moduleFlags = await getModuleFlags(locationId);

  if (!moduleFlags.admissions) {
    return (
      <Card>
        <h2 className="text-lg font-semibold text-ink">
          Admissions is not enabled
        </h2>
        <p className="mt-2 text-sm text-ink-muted">
          This school does not currently have the Admissions &amp; Enrollment
          module switched on. Contact the platform administrator to enable it.
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
