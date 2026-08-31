import type { Metadata } from 'next';

import { HrNav } from '@/components/hr/HrNav';
import { StaffManager } from '@/components/hr/StaffManager';
import { PageHeader } from '@/components/ui/PageHeader';
import { requireSchoolPermission } from '@/lib/school-guard';
import { listBranchOptions } from '@/lib/school-queries';

export const metadata: Metadata = {
  title: 'Staff',
};

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export default async function StaffPage() {
  const { locationId, permissions } = await requireSchoolPermission('hr.read');

  /*
   * The branches are needed only by the "Create a login" half of the form, and
   * they are read here rather than fetched by the component: the page is
   * already `force-dynamic` with a loader beside it, so one more read costs
   * nothing a reader can see, and a second round trip after mount would leave
   * the Branch select empty for the moment somebody is choosing a role.
   */
  const branches = await listBranchOptions(locationId);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Staff"
        description="The employment records payroll pays. A staff member does not need a portal login to be on this list."
      />

      <HrNav />

      <StaffManager
        canEdit={permissions.includes('hr.write')}
        // One screen, two permission keys. Somebody holding only `hr.write`
        // sees the Portal access section without the options they may not use,
        // rather than a control that is there and permanently disabled.
        canCreateLogin={permissions.includes('users.write')}
        canSeeAccounts={permissions.includes('users.read')}
        branches={branches}
      />
    </div>
  );
}
