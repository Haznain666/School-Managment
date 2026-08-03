import type { Metadata } from 'next';

import { HrNav } from '@/components/hr/HrNav';
import { StaffManager } from '@/components/hr/StaffManager';
import { requireSchoolPermission } from '@/lib/school-guard';

export const metadata: Metadata = {
  title: 'Staff',
};

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export default async function StaffPage() {
  const { permissions } = await requireSchoolPermission('hr.read');

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold text-slate-900">Staff</h2>
        <p className="mt-1 text-sm text-slate-500">
          The employment records payroll pays. A staff member does not need a
          portal login to be on this list.
        </p>
      </div>

      <HrNav />

      <StaffManager canEdit={permissions.includes('hr.write')} />
    </div>
  );
}
