import type { Metadata } from 'next';

import { HrNav } from '@/components/hr/HrNav';
import { PayrollRunManager } from '@/components/hr/PayrollRunManager';
import { requireSchoolPermission } from '@/lib/school-guard';

export const metadata: Metadata = {
  title: 'Payroll',
};

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export default async function PayrollPage() {
  const { permissions } = await requireSchoolPermission('payroll.read');

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold text-slate-900">Payroll</h2>
        <p className="mt-1 text-sm text-slate-500">
          One run a month. A draft can be recomputed after fixing a structure or
          correcting the register; once approved, the figures are fixed.
        </p>
      </div>

      <HrNav />

      <PayrollRunManager canEdit={permissions.includes('payroll.write')} />
    </div>
  );
}
