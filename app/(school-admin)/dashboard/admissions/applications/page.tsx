import type { Metadata } from 'next';

import { ApplicationTable } from '@/components/admissions/ApplicationTable';
import { requireSchoolPermission } from '@/lib/school-guard';

export const metadata: Metadata = {
  title: 'Applications',
};

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export default async function ApplicationsPage() {
  const { claims } = await requireSchoolPermission('admissions.read');

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold text-ink">Applications</h2>
        <p className="mt-1 text-sm text-ink-muted">
          Submissions from your public application form at{' '}
          <span className="font-mono">
            {claims.schoolSlug === '' ? '/apply' : `${claims.schoolSlug}…/apply`}
          </span>
          . Accepted applications can be converted into a full enrollment.
        </p>
      </div>

      <ApplicationTable />
    </div>
  );
}
