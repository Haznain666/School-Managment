import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';

import { RecordPaymentForm } from '@/components/fees/RecordPaymentForm';
import { Card } from '@/components/ui/Card';
import { PAYABLE_CHALLAN_STATUSES } from '@/db/schema/fee-challans';
import { getChallanDetail } from '@/lib/fee-queries';
import { requireSchoolRole } from '@/lib/school-guard';
import { isUuid } from '@/lib/validation';

export const metadata: Metadata = {
  title: 'Record payment',
};

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export default async function RecordPaymentPage({
  params,
}: {
  params: Promise<{ challanId: string }>;
}) {
  const { locationId } = await requireSchoolRole(['school_admin', 'accountant']);

  const { challanId } = await params;
  if (!isUuid(challanId)) notFound();

  const challan = await getChallanDetail(locationId, challanId);
  if (challan === null) notFound();

  // A fully paid challan has nothing to record; send the clerk back to it
  // rather than showing a form that would only be rejected.
  if (!(PAYABLE_CHALLAN_STATUSES as readonly string[]).includes(challan.status)) {
    redirect(`/dashboard/fees/challans/${challanId}`);
  }

  return (
    <div className="max-w-3xl space-y-6">
      <Link
        href={`/dashboard/fees/challans/${challanId}`}
        className="text-sm font-medium text-brand-primary hover:underline"
      >
        ← Back to challan
      </Link>

      <div>
        <h2 className="text-xl font-semibold text-slate-900">Record payment</h2>
        <p className="mt-1 text-sm text-slate-500">
          Cash, bank transfer or cheque. There is no payment gateway — this
          records money the school has already received.
        </p>
      </div>

      {challan.items.length === 0 ? (
        <Card>
          <p className="text-sm text-slate-600">This challan has no line items.</p>
        </Card>
      ) : (
        <RecordPaymentForm
          challanId={challan.id}
          challanNumber={challan.challanNumber}
          studentName={challan.studentName}
          totalPaise={challan.totalPaise}
          paidPaise={challan.paidPaise}
          balancePaise={challan.balancePaise}
        />
      )}
    </div>
  );
}
