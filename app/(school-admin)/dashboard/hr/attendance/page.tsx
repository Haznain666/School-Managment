import type { Metadata } from 'next';

import { HrNav } from '@/components/hr/HrNav';
import { StaffAttendanceMarker } from '@/components/hr/StaffAttendanceMarker';
import { requireSchoolRole } from '@/lib/school-guard';
import { HR_READ_ROLES, HR_WRITE_ROLES } from '@/types/school-auth';

export const metadata: Metadata = {
  title: 'Staff register',
};

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export default async function StaffAttendancePage() {
  const { claims } = await requireSchoolRole(HR_READ_ROLES);

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold text-slate-900">Staff register</h2>
        <p className="mt-1 text-sm text-slate-500">
          Payroll counts absences and half days from here. Days marked
          &ldquo;on leave&rdquo; defer to the leave request, which knows whether
          that leave was paid.
        </p>
      </div>

      <HrNav />

      <StaffAttendanceMarker canEdit={HR_WRITE_ROLES.includes(claims.role)} />
    </div>
  );
}
