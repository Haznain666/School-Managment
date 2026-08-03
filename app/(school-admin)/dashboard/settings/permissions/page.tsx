import type { Metadata } from 'next';
import Link from 'next/link';

import { PermissionMatrix } from '@/components/school/PermissionMatrix';
import { requireSchoolPermission } from '@/lib/school-guard';

export const metadata: Metadata = {
  title: 'Permissions',
};

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export default async function PermissionsPage() {
  const { permissions } = await requireSchoolPermission('permissions.manage');

  return (
    <div className="space-y-6">
      <div>
        <Link
          href="/dashboard/settings"
          className="text-sm font-medium text-brand-primary hover:underline"
        >
          ← Settings
        </Link>
        <h2 className="mt-2 text-xl font-semibold text-slate-900">
          Roles and permissions
        </h2>
        <p className="mt-1 text-sm text-slate-500">
          What each role at your school may do. Everything starts at the
          platform default; anything you change here applies to your school
          only.
        </p>
      </div>

      <PermissionMatrix canEdit={permissions.includes('permissions.manage')} />
    </div>
  );
}
