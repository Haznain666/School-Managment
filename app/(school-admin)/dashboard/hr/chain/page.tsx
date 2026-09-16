import type { Metadata } from 'next';

import { ChainOfCommand } from '@/components/hr/ChainOfCommand';
import { HrNav } from '@/components/hr/HrNav';
import { PageHeader } from '@/components/ui/PageHeader';
import { requireSchoolPermission } from '@/lib/school-guard';

export const metadata: Metadata = {
  title: 'Reporting line',
};

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * The chain of command, per campus.
 *
 * Read by anybody with `leave.read`, because knowing who your requests go to
 * is not privileged information — it is the answer to the first question every
 * applicant asks. Changing it needs `leave.manage`: the chain decides who
 * approves whose leave, so it is kept by the people who keep the leave rules
 * rather than by everybody who holds an approval.
 */
export default async function ChainOfCommandPage() {
  const { permissions } = await requireSchoolPermission('leave.read');

  return (
    <div className="space-y-6">
      <PageHeader
        title="Reporting line"
        description="Principal → Vice Principal → Section Heads → Coordinators → Teachers, per campus. A missing rung is skipped, not waited for."
      />

      <HrNav />

      <ChainOfCommand canEdit={permissions.includes('leave.manage')} />
    </div>
  );
}
