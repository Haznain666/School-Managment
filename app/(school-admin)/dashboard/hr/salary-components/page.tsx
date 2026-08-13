import type { Metadata } from 'next';

import { HrNav } from '@/components/hr/HrNav';
import { SalaryComponentManager } from '@/components/hr/SalaryComponentManager';
import { PageHeader } from '@/components/ui/PageHeader';
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
      <PageHeader
        title="Salary components"
        description="The heads your school pays and deducts under. One of them must be marked as the basic salary — every percentage head is measured against it."
      />

      <HrNav />

      <SalaryComponentManager canEdit={permissions.includes('hr.write')} />
    </div>
  );
}
