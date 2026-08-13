import type { Metadata } from 'next';
import Link from 'next/link';

import { AcademicYearTable } from '@/components/admissions/AcademicYearTable';
import { Button } from '@/components/ui/Button';
import { PageHeader } from '@/components/ui/PageHeader';
import { listAcademicYears } from '@/lib/admissions-queries';
import { requireSchoolPermission } from '@/lib/school-guard';

export const metadata: Metadata = {
  title: 'Academic years',
};

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export default async function AcademicYearsPage() {
  const { claims, locationId } = await requireSchoolPermission('admissions.read');
  const years = await listAcademicYears(locationId);

  const canEdit = claims.role === 'school_admin';

  return (
    <div className="space-y-6">
      <PageHeader
        title="Academic years"
        description="Every enrolment, section and student ID belongs to a year. Exactly one is active at a time, and that is the one new admissions go into."
        actions={
          canEdit ? (
            <Link href="/dashboard/admissions/academic-years/new">
              <Button>Create academic year</Button>
            </Link>
          ) : null
        }
      />

      <AcademicYearTable years={years} canEdit={canEdit} />
    </div>
  );
}
