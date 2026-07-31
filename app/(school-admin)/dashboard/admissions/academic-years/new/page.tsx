import type { Metadata } from 'next';

import { AcademicYearForm } from '@/components/admissions/AcademicYearForm';
import { getActiveAcademicYear } from '@/lib/admissions-queries';
import { requireSchoolRole } from '@/lib/school-guard';

export const metadata: Metadata = {
  title: 'New academic year',
};

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export default async function NewAcademicYearPage() {
  const { locationId } = await requireSchoolRole(['school_admin']);
  const activeYear = await getActiveAcademicYear(locationId);

  return (
    <div className="max-w-3xl space-y-6">
      <div>
        <h2 className="text-xl font-semibold text-slate-900">New academic year</h2>
        <p className="mt-1 text-sm text-slate-500">
          Pakistani schools do not share a calendar, so set the months your own
          session actually runs between. The name is derived from the years.
        </p>
      </div>

      <AcademicYearForm hasActiveYear={activeYear !== null} />
    </div>
  );
}
