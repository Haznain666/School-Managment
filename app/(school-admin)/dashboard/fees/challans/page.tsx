import type { Metadata } from 'next';
import Link from 'next/link';

import { ChallanTable } from '@/components/fees/ChallanTable';
import { Button } from '@/components/ui/Button';
import { listAcademicYears, listGrades } from '@/lib/admissions-queries';
import { requireSchoolRole } from '@/lib/school-guard';
import { FEE_READ_ROLES, FEE_WRITE_ROLES } from '@/types/school-auth';

export const metadata: Metadata = {
  title: 'Challans',
};

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export default async function ChallansPage() {
  const { claims, locationId } = await requireSchoolRole(FEE_READ_ROLES);

  const [academicYears, grades] = await Promise.all([
    listAcademicYears(locationId),
    // A branch-scoped admin only ever sees their own branch's grades.
    listGrades(locationId, claims.branchId ?? undefined),
  ]);

  const canGenerate = FEE_WRITE_ROLES.includes(claims.role);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="text-xl font-semibold text-slate-900">Challans</h2>
          <p className="mt-1 text-sm text-slate-500">
            Every bill your school has raised, with what has been paid against it.
          </p>
        </div>

        {canGenerate ? (
          <Link href="/dashboard/fees/challans/generate">
            <Button>Generate challans</Button>
          </Link>
        ) : null}
      </div>

      <ChallanTable
        academicYears={academicYears}
        grades={grades.map((grade) => ({ id: grade.id, label: grade.label }))}
        canGenerate={canGenerate}
      />
    </div>
  );
}
