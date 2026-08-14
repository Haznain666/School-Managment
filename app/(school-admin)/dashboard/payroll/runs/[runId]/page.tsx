import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

import { PayrollRunDetail } from '@/components/hr/PayrollRunDetail';
import { formatPayrollPeriod } from '@/db/schema/payroll-runs';
import { getPayrollRun } from '@/lib/hr-queries';
import { requireSchoolPermission } from '@/lib/school-guard';
import { isUuid } from '@/lib/validation';
import { PageHeader } from '@/components/ui/PageHeader';

export const metadata: Metadata = {
  title: 'Payroll run',
};

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export default async function PayrollRunPage({
  params,
}: {
  params: Promise<{ runId: string }>;
}) {
  const { runId } = await params;
  const { locationId, permissions } = await requireSchoolPermission('payroll.read');

  if (!isUuid(runId)) notFound();

  const run = await getPayrollRun(locationId, runId);
  if (run === null) notFound();

  return (
    <div className="space-y-6">
      <PageHeader
        breadcrumbs={[{ label: 'Runs', href: '/dashboard/payroll' }, { label: formatPayrollPeriod(run.payrollMonth, run.payrollYear) }]}
        title={formatPayrollPeriod(run.payrollMonth, run.payrollYear)}
      />

      <PayrollRunDetail
        runId={runId}
        canEdit={permissions.includes('payroll.write')}
      />
    </div>
  );
}
