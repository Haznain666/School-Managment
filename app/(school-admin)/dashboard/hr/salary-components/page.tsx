import type { Metadata } from 'next';

import { HrNav } from '@/components/hr/HrNav';
import { SalaryComponentManager } from '@/components/hr/SalaryComponentManager';
import { requireSchoolPermission } from '@/lib/school-guard';

export const metadata: Metadata = {
  title: 'Salary components',
};

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export default async function SalaryComponentsPage() {
  const { permissions } = await requireSchoolPermission('hr.read');

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold text-slate-900">Salary components</h2>
        <p className="mt-1 text-sm text-slate-500">
          The heads your school pays and deducts under. One of them must be
          marked as the basic salary — every percentage head is measured against
          it.
        </p>
      </div>

      <HrNav />

      <SalaryComponentManager canEdit={permissions.includes('hr.write')} />
    </div>
  );
}
