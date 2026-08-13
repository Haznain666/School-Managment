import type { Metadata } from 'next';

import { AcademicYearForm } from '@/components/admissions/AcademicYearForm';
import { PageHeader } from '@/components/ui/PageHeader';
import { getActiveAcademicYear } from '@/lib/admissions-queries';
import { requireSchoolPermission } from '@/lib/school-guard';

export const metadata: Metadata = {
  title: 'New academic year',
};

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export default async function NewAcademicYearPage() {
  const { locationId } = await requireSchoolPermission('admissions.write');
  const activeYear = await getActiveAcademicYear(locationId);

  return (
    <div className="max-w-3xl space-y-6">
      <PageHeader
        title="New academic year"
        description="Pakistani schools do not share a calendar, so set the months your own session actually runs between. The name is derived from the years."
      />

      <AcademicYearForm hasActiveYear={activeYear !== null} />
    </div>
  );
}
