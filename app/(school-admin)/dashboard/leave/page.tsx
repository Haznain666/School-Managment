import type { Metadata } from 'next';

import { LeaveApprovals } from '@/components/leave/LeaveApprovals';
import { PageHeader } from '@/components/ui/PageHeader';
import { requireSchoolPermission } from '@/lib/school-guard';

export const metadata: Metadata = {
  title: 'Leave approvals',
};

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * The approvals queue, for everybody who approves anybody.
 *
 * ── Why this is not HR's leave screen ────────────────────────────────────
 * `/dashboard/hr/leave` is HR's: it is gated on `hr.read`, it shows the whole
 * school, and it is where leave types are kept. This one is gated on
 * `leave.read` and shows **the people who report to the caller**, resolved by
 * `lib/approval-chain.ts`. A coordinator holds the first key and not the
 * second, which is exactly the gap Part A's QA found: the campus guard shipped
 * in `0046` could not be reached by the role its own acceptance criterion
 * named, because that role held no HR key at all.
 */
export default async function LeaveApprovalsPage() {
  await requireSchoolPermission('leave.read');

  return (
    <div className="space-y-6">
      <PageHeader
        title="Leave approvals"
        description="Requests from the people who report to you. Approving an unpaid day docks that month's payslip; a paid one does not, and every row says which it is."
      />

      <LeaveApprovals />
    </div>
  );
}
