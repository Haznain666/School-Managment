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

/**
 * HR's leave screen.
 *
 * Sprint 33b, QA round 1: what it may *do* is decided by the leave keys, not by
 * `hr.write`. `leave.manage` keeps the heads, sees the whole school's requests
 * and files for somebody who cannot; `leave.approve` shows the decide buttons,
 * which go to the decision endpoint and the approval chain. HR holds the first
 * and not the second, so HR files and does not decide.
 */
export default async function LeavePage() {
  const { permissions } = await requireSchoolPermission('hr.read');

  return (
    <div className="space-y-6">
      <PageHeader
        title="Leave"
        description="Approving an unpaid day docks that month&rsquo;s payslip. Approving a paid one does not — which is why every request shows which it is."
      />

      <HrNav />

      <LeaveManager
        canManage={permissions.includes('leave.manage')}
        canApprove={permissions.includes('leave.approve')}
      />
    </div>
  );
}
