import type { Metadata } from 'next';
import Link from 'next/link';

import { FeeSetupNav } from '@/components/fees/FeeSetupNav';
import { FeeStructureMatrix } from '@/components/fees/FeeStructureMatrix';
import { Card } from '@/components/ui/Card';
import { PageHeader } from '@/components/ui/PageHeader';
import { listAcademicYears, listAdmissionsBranches } from '@/lib/admissions-queries';
import { requireSchoolPermission } from '@/lib/school-guard';

export const metadata: Metadata = {
  title: 'Fee structure',
};

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export default async function FeeStructuresPage() {
  const { claims, locationId, permissions } = await requireSchoolPermission('fees.read');

  const [branches, academicYears] = await Promise.all([
    listAdmissionsBranches(locationId),
    listAcademicYears(locationId),
  ]);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Fee structure"
        description="What each grade pays under each head, for one academic year. Last year&rsquo;s prices stay as they were — vouchers already issued have to remain explainable."
      />

      <FeeSetupNav />

      {academicYears.length === 0 ? (
        <Card>
          <p className="text-sm text-ink-muted">
            No academic years exist yet, and fees are priced per year, so there is
            nothing to set up.
          </p>
          <Link
            href="/dashboard/admissions/academic-years/new"
            className="mt-3 inline-block text-sm font-medium text-brand-primary hover:underline"
          >
            Set up an academic year
          </Link>
        </Card>
      ) : (
        <FeeStructureMatrix
          branches={branches}
          academicYears={academicYears}
          lockedBranchId={claims.branchId}
          canEdit={permissions.includes('fees.write')}
        />
      )}
    </div>
  );
}
