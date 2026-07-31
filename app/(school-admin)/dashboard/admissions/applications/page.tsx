import type { Metadata } from 'next';

import { ApplicationTable } from '@/components/admissions/ApplicationTable';
import { requireSchoolRole } from '@/lib/school-guard';
import { ADMIN_PORTAL_ROLES } from '@/types/school-auth';

export const metadata: Metadata = {
  title: 'Applications',
};

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export default async function ApplicationsPage() {
  const { claims } = await requireSchoolRole(ADMIN_PORTAL_ROLES);

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold text-slate-900">Applications</h2>
        <p className="mt-1 text-sm text-slate-500">
          Submissions from your public application form at{' '}
          <span className="font-mono">
            {claims.schoolSlug === '' ? '/apply' : `${claims.schoolSlug}…/apply`}
          </span>
          . Accepted applications can be converted into a full enrolment.
        </p>
      </div>

      <ApplicationTable />
    </div>
  );
}
