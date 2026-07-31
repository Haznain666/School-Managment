import Link from 'next/link';
import type { ReactNode } from 'react';

import { Card } from '@/components/ui/Card';
import { getModuleFlags } from '@/lib/school-queries';
import { requireSchoolRole } from '@/lib/school-guard';
import { ADMIN_PORTAL_ROLES } from '@/types/school-auth';

/**
 * Module gate for every Fee Management screen.
 *
 * The sidebar hides these links when the module is off, but a link is not a
 * permission — a bookmark or a typed URL would otherwise walk straight in. The
 * check lives in a layout so a page added later cannot forget it.
 *
 * Mirrors the Admissions gate exactly, deliberately: two module gates that
 * behave differently would be a bug waiting to happen.
 */
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export default async function FeesLayout({ children }: { children: ReactNode }) {
  const { locationId } = await requireSchoolRole(ADMIN_PORTAL_ROLES);
  const moduleFlags = await getModuleFlags(locationId);

  if (!moduleFlags.fee_management) {
    return (
      <Card>
        <h2 className="text-lg font-semibold text-slate-900">
          Fee Management is not enabled
        </h2>
        <p className="mt-2 text-sm text-slate-600">
          This school does not currently have the Fee Management module switched
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
