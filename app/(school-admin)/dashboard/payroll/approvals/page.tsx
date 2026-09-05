import type { Metadata } from 'next';

import { PayrollApprovals } from '@/components/hr/PayrollApprovals';
import { PageHeader } from '@/components/ui/PageHeader';
import { schoolUserIdForUid } from '@/lib/accounting-queries';
import { runsAwaiting } from '@/lib/payroll-approval';
import { requireSchoolPermission } from '@/lib/school-guard';

export const metadata: Metadata = {
  title: 'Payroll approvals',
};

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * The payroll a head signs.
 *
 * ── Gated on `payroll.read`, acted on with `payroll.approve` ─────────────
 * Seeing what the school pays its staff is a head's job and HR's; signing off
 * the teachers and coordinators one head is answerable for is that head's
 * alone. So the page opens for the first and the buttons appear for the second,
 * and the route behind them checks both again — a hidden button is a courtesy,
 * never the control.
 *
 * ── Filtered on the approval row, not on the run's status ────────────────
 * A head who has already signed still sees what they signed while the run waits
 * for somebody else. "It has disappeared" is the wrong answer to "did I approve
 * that?".
 */
export default async function PayrollApprovalsPage() {
  const { claims, locationId, permissions } =
    await requireSchoolPermission('payroll.read');

  const me = await schoolUserIdForUid(locationId, claims.uid);
  const runs = me === null ? [] : await runsAwaiting(locationId, me);

  return (
    <div className="max-w-4xl space-y-6">
      <PageHeader
        title="Payroll approvals"
        description="The teachers and coordinators you are responsible for. A run goes forward when every head has signed their own part of it."
      />

      <PayrollApprovals
        runs={runs}
        canApprove={permissions.includes('payroll.approve')}
      />
    </div>
  );
}
