import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import { RecordPaymentForm } from '@/components/fees/RecordPaymentForm';
import { Card } from '@/components/ui/Card';
import { CHALLAN_STATUS_LABELS } from '@/db/schema/fee-challans';
import { remainingBalance } from '@/lib/fee-calculator';
import { getChallanDetail } from '@/lib/fee-queries';
import { requireSchoolRole } from '@/lib/school-guard';
import { isUuid } from '@/lib/validation';
import { FEE_WRITE_ROLES } from '@/types/school-auth';

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
  const { locationId } = await requireSchoolRole(FEE_WRITE_ROLES);
  const { challanId } = await params;

  if (!isUuid(challanId)) notFound();

  const challan = await getChallanDetail(locationId, challanId);
  if (challan === null) notFound();

  const balance = remainingBalance(challan.totalAmount, challan.paidAmount);

  return (
    <div className="space-y-6">
      <div>
        <Link
          href={`/dashboard/fees/challans/${challanId}`}
          className="text-sm font-medium text-brand-primary hover:underline"
        >
          ← Back to challan
        </Link>
        <h2 className="mt-1 text-xl font-semibold text-slate-900">Record payment</h2>
        <p className="mt-1 text-sm text-slate-500">
          For <span className="font-mono">{challan.challanNumber}</span> ·{' '}
          {challan.studentName}
        </p>
      </div>

      {challan.status === 'cancelled' || challan.status === 'waived' ? (
        <Card>
          <p className="text-sm text-slate-600">
            This challan is {CHALLAN_STATUS_LABELS[challan.status].toLowerCase()}, so
            no payment can be recorded against it.
          </p>
        </Card>
      ) : balance <= 0 ? (
        <Card>
          <p className="text-sm text-slate-600">
            This challan is fully paid. There is nothing left to record.
          </p>
        </Card>
      ) : (
        <RecordPaymentForm
          challanId={challan.id}
          challanNumber={challan.challanNumber}
          studentName={challan.studentName}
          balance={balance.toFixed(2)}
          totalAmount={challan.totalAmount}
          paidAmount={challan.paidAmount}
        />
      )}
    </div>
  );
}
