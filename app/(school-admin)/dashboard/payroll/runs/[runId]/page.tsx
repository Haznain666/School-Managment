import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import { PayrollRunDetail } from '@/components/hr/PayrollRunDetail';
import { formatPayrollPeriod } from '@/db/schema/payroll-runs';
import { getPayrollRun } from '@/lib/hr-queries';
import { requireSchoolRole } from '@/lib/school-guard';
import { isUuid } from '@/lib/validation';
import { PAYROLL_READ_ROLES, PAYROLL_WRITE_ROLES } from '@/types/school-auth';

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
  const { claims, locationId } = await requireSchoolRole(PAYROLL_READ_ROLES);

  if (!isUuid(runId)) notFound();

  const run = await getPayrollRun(locationId, runId);
  if (run === null) notFound();

  return (
    <div className="space-y-6">
      <div>
        <Link
          href="/dashboard/payroll"
          className="text-sm font-medium text-brand-primary hover:underline"
        >
          ← All runs
        </Link>
        <h2 className="mt-2 text-xl font-semibold text-slate-900">
          {formatPayrollPeriod(run.payrollMonth, run.payrollYear)}
        </h2>
      </div>

      <PayrollRunDetail
        runId={runId}
        canEdit={PAYROLL_WRITE_ROLES.includes(claims.role)}
      />
    </div>
  );
}
