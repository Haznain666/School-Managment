import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

import { RecordPaymentForm } from '@/components/fees/RecordPaymentForm';
import { Card } from '@/components/ui/Card';
import { PageHeader } from '@/components/ui/PageHeader';
import { CHALLAN_STATUS_LABELS } from '@/db/schema/fee-challans';
import { remainingBalance } from '@/lib/fee-calculator';
import { getChallanDetail } from '@/lib/fee-queries';
import { requireSchoolPermission } from '@/lib/school-guard';
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
  const { locationId } = await requireSchoolPermission('fees.write');
  const { challanId } = await params;

  if (!isUuid(challanId)) notFound();

  const challan = await getChallanDetail(locationId, challanId);
  if (challan === null) notFound();

  const balance = remainingBalance(challan.totalAmount, challan.paidAmount);

  return (
    <div className="space-y-6">
      <PageHeader
        breadcrumbs={[
          { label: 'Challans', href: '/dashboard/fees/challans' },
          { label: challan.challanNumber, href: `/dashboard/fees/challans/${challanId}` },
          { label: 'Record payment' },
        ]}
        title="Record payment"
        description={
          <>
            {/*
              Mono, as the challan number is everywhere else it appears: the
              clerk on this screen is reading it off a paper voucher, and the
              two should be comparable glyph for glyph.
            */}
            For <span className="font-mono">{challan.challanNumber}</span> ·{' '}
            {challan.studentName}
          </>
        }
      />

      {challan.status === 'cancelled' || challan.status === 'waived' ? (
        <Card>
          <p className="text-sm text-ink-muted">
            This challan is {CHALLAN_STATUS_LABELS[challan.status].toLowerCase()}, so
            no payment can be recorded against it.
          </p>
        </Card>
      ) : balance <= 0 ? (
        <Card>
          <p className="text-sm text-ink-muted">
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
