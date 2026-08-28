import type { Metadata } from 'next';
import Link from 'next/link';

import { VoucherRegisterTabs } from '@/components/fees/VoucherRegisterTabs';
import { Button } from '@/components/ui/Button';
import { PageHeader } from '@/components/ui/PageHeader';
import { listAcademicYears, listGrades } from '@/lib/admissions-queries';
import { requireSchoolPermission } from '@/lib/school-guard';

export const metadata: Metadata = {
  title: 'Vouchers',
};

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export default async function ChallansPage() {
  const { claims, locationId, permissions } = await requireSchoolPermission('fees.read');

  const [academicYears, grades] = await Promise.all([
    listAcademicYears(locationId),
    // A branch-scoped admin only ever sees their own branch's grades.
    listGrades(locationId, claims.branchId ?? undefined),
  ]);

  const canGenerate = permissions.includes('fees.write');

  return (
    <div className="space-y-6">
      <PageHeader
        title="Vouchers"
        description="Every bill your school has raised, with what has been paid against it."
        actions={
          canGenerate ? (
            <Link href="/dashboard/fees/challans/generate">
              <Button>Generate vouchers</Button>
            </Link>
          ) : null
        }
      />

      <VoucherRegisterTabs
        academicYears={academicYears}
        grades={grades.map((grade) => ({ id: grade.id, label: grade.label }))}
        canGenerate={canGenerate}
      />
    </div>
  );
}
