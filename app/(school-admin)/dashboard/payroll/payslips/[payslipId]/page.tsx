import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import { PayslipView } from '@/components/hr/PayslipView';
import { getPayslipDetail } from '@/lib/hr-queries';
import { requireSchoolPermission } from '@/lib/school-guard';
import { isUuid } from '@/lib/validation';

export const metadata: Metadata = {
  title: 'Payslip',
};

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export default async function PayslipPage({
  params,
}: {
  params: Promise<{ payslipId: string }>;
}) {
  const { payslipId } = await params;
  const { locationId, permissions } = await requireSchoolPermission('payroll.read');

  if (!isUuid(payslipId)) notFound();

  const payslip = await getPayslipDetail(locationId, payslipId);
  if (payslip === null) notFound();

  return (
    <div className="space-y-6">
      <div className="print:hidden">
        <Link
          href={`/dashboard/payroll/runs/${payslip.payrollRunId}`}
          className="text-sm font-medium text-brand-primary hover:underline"
        >
          ← Back to the run
        </Link>
      </div>

      <PayslipView
        payslipId={payslipId}
        canEdit={permissions.includes('payroll.write')}
      />
    </div>
  );
}
