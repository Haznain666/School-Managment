import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import { PayslipView } from '@/components/hr/PayslipView';
import { getPayslipDetail } from '@/lib/hr-queries';
import { requireSchoolRole } from '@/lib/school-guard';
import { isUuid } from '@/lib/validation';
import { PAYROLL_READ_ROLES, PAYROLL_WRITE_ROLES } from '@/types/school-auth';

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
  const { claims, locationId } = await requireSchoolRole(PAYROLL_READ_ROLES);

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
        canEdit={PAYROLL_WRITE_ROLES.includes(claims.role)}
      />
    </div>
  );
}
