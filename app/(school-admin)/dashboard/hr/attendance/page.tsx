import type { Metadata } from 'next';

import { HrNav } from '@/components/hr/HrNav';
import { StaffAttendanceMarker } from '@/components/hr/StaffAttendanceMarker';
import { PageHeader } from '@/components/ui/PageHeader';
import { requireSchoolPermission } from '@/lib/school-guard';

export const metadata: Metadata = {
  title: 'Staff register',
};

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export default async function StaffAttendancePage() {
  const { permissions } = await requireSchoolPermission('hr.read');

  return (
    <div className="space-y-6">
      <PageHeader
        title="Staff register"
        description="Payroll counts absences and half days from here. Days marked &ldquo;on leave&rdquo; defer to the leave request, which knows whether that leave was paid."
      />

      <HrNav />

      <StaffAttendanceMarker canEdit={permissions.includes('hr.write')} />
    </div>
  );
}
