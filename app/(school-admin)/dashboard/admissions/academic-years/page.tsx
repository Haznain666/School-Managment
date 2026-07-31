import type { Metadata } from 'next';
import Link from 'next/link';

import { AcademicYearTable } from '@/components/admissions/AcademicYearTable';
import { Button } from '@/components/ui/Button';
import { listAcademicYears } from '@/lib/admissions-queries';
import { requireSchoolRole } from '@/lib/school-guard';
import { ADMIN_PORTAL_ROLES } from '@/types/school-auth';

export const metadata: Metadata = {
  title: 'Academic years',
};

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export default async function AcademicYearsPage() {
  const { claims, locationId } = await requireSchoolRole(ADMIN_PORTAL_ROLES);
  const years = await listAcademicYears(locationId);

  const canEdit = claims.role === 'school_admin';

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="text-xl font-semibold text-slate-900">Academic years</h2>
          <p className="mt-1 text-sm text-slate-500">
            Every enrolment, section and student ID belongs to a year. Exactly
            one is active at a time, and that is the one new admissions go into.
          </p>
        </div>

        {canEdit ? (
          <Link href="/dashboard/admissions/academic-years/new">
            <Button>Create academic year</Button>
          </Link>
        ) : null}
      </div>

      <AcademicYearTable years={years} canEdit={canEdit} />
    </div>
  );
}
