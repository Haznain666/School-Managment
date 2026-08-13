import type { Metadata } from 'next';

import { HrNav } from '@/components/hr/HrNav';
import { LeaveManager } from '@/components/hr/LeaveManager';
import { PageHeader } from '@/components/ui/PageHeader';
import { requireSchoolPermission } from '@/lib/school-guard';

export const metadata: Metadata = {
  title: 'Leave',
};

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export default async function LeavePage() {
  const { permissions } = await requireSchoolPermission('hr.read');

  return (
    <div className="space-y-6">
      <PageHeader
        title="Leave"
        description="Approving an unpaid day docks that month&rsquo;s payslip. Approving a paid one does not — which is why every request shows which it is."
      />

      <HrNav />

      <LeaveManager canEdit={permissions.includes('hr.write')} />
    </div>
  );
}
