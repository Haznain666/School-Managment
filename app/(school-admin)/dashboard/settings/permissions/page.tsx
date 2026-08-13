import type { Metadata } from 'next';

import { PermissionMatrix } from '@/components/school/PermissionMatrix';
import { requireSchoolPermission } from '@/lib/school-guard';
import { PageHeader } from '@/components/ui/PageHeader';

export const metadata: Metadata = {
  title: 'Permissions',
};

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export default async function PermissionsPage() {
  const { permissions } = await requireSchoolPermission('permissions.manage');

  return (
    <div className="space-y-6">
      <PageHeader
        breadcrumbs={[{ label: 'Settings', href: '/dashboard/settings' }, { label: 'Roles and permissions' }]}
        title="Roles and permissions"
        description="What each role at your school may do. Everything starts at the platform default; anything you change here applies to your school only."
      />

      <PermissionMatrix canEdit={permissions.includes('permissions.manage')} />
    </div>
  );
}
