import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import { StaffDetailPanel } from '@/components/hr/StaffDetailPanel';
import { getStaff } from '@/lib/hr-queries';
import { requireSchoolRole } from '@/lib/school-guard';
import { isUuid } from '@/lib/validation';
import { HR_READ_ROLES, HR_WRITE_ROLES } from '@/types/school-auth';

export const metadata: Metadata = {
  title: 'Staff member',
};

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export default async function StaffDetailPage({
  params,
}: {
  params: Promise<{ staffId: string }>;
}) {
  const { staffId } = await params;
  const { claims, locationId } = await requireSchoolRole(HR_READ_ROLES);

  if (!isUuid(staffId)) notFound();

  // Existence is checked here rather than left to the client fetch, so a bad id
  // renders a 404 instead of a page frame with an error inside it.
  const member = await getStaff(locationId, staffId);
  if (member === null) notFound();

  return (
    <div className="space-y-6">
      <div>
        <Link
          href="/dashboard/hr/staff"
          className="text-sm font-medium text-brand-primary hover:underline"
        >
          ← All staff
        </Link>
        <h2 className="mt-2 text-xl font-semibold text-slate-900">
          {member.fullName}
        </h2>
        <p className="mt-1 text-sm text-slate-500">
          Their file, and the salary structure every payslip is computed from.
        </p>
      </div>

      <StaffDetailPanel
        staffId={staffId}
        canEdit={HR_WRITE_ROLES.includes(claims.role)}
      />
    </div>
  );
}
