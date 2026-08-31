import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

import { StaffDetailPanel } from '@/components/hr/StaffDetailPanel';
import { getStaff } from '@/lib/hr-queries';
import { requireSchoolPermission } from '@/lib/school-guard';
import { listBranchOptions } from '@/lib/school-queries';
import { isUuid } from '@/lib/validation';
import { PageHeader } from '@/components/ui/PageHeader';

export const metadata: Metadata = {
  title: 'Staff member',
};

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export default async function StaffDetailPage({
  params,
}: {
  params: Promise<{ staffId: string }>;
}) {
  const { staffId } = await params;
  const { locationId, permissions } = await requireSchoolPermission('hr.read');

  if (!isUuid(staffId)) notFound();

  // Existence is checked here rather than left to the client fetch, so a bad id
  // renders a 404 instead of a page frame with an error inside it.
  const member = await getStaff(locationId, staffId);
  if (member === null) notFound();

  return (
    <div className="space-y-6">
      <PageHeader
        breadcrumbs={[{ label: 'Staff', href: '/dashboard/hr/staff' }, { label: member.fullName }]}
        title={member.fullName}
        description="Their file, and the salary structure every payslip is computed from."
      />

      <StaffDetailPanel
        staffId={staffId}
        canEdit={permissions.includes('hr.write')}
        // Two keys, one screen — see `app/api/school/hr/staff/route.ts`. The
        // options a viewer may not use are absent rather than disabled.
        canCreateLogin={permissions.includes('users.write')}
        canSeeAccounts={permissions.includes('users.read')}
        branches={await listBranchOptions(locationId)}
      />
    </div>
  );
}
