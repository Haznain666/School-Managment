import Link from 'next/link';
import type { ReactNode } from 'react';

import { Card } from '@/components/ui/Card';
import { getModuleFlags } from '@/lib/school-queries';
import { requireSchoolRole } from '@/lib/school-guard';
import { ADMIN_PORTAL_ROLES } from '@/types/school-auth';

/**
 * Module gate for every Academics screen.
 *
 * The sidebar hides these links when the module is off, but a link is not a
 * permission — a bookmark or a typed URL would otherwise walk straight in. The
 * check lives in a layout so that adding a page later cannot forget it.
 */
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export default async function AcademicsLayout({ children }: { children: ReactNode }) {
  const { locationId } = await requireSchoolRole(ADMIN_PORTAL_ROLES);
  const moduleFlags = await getModuleFlags(locationId);

  if (!moduleFlags.academics) {
    return (
      <Card>
        <h2 className="text-lg font-semibold text-slate-900">
          Academics is not enabled
        </h2>
        <p className="mt-2 text-sm text-slate-600">
          This school does not currently have the Academics &amp; Timetable
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
