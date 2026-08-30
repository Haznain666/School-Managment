import type { Metadata } from 'next';
import Link from 'next/link';

import { ChallanGenerator } from '@/components/fees/ChallanGenerator';
import { Card } from '@/components/ui/Card';
import { PageHeader } from '@/components/ui/PageHeader';
import { listAcademicYears, listGrades } from '@/lib/admissions-queries';
import { getDueDay, listFeeTypes } from '@/lib/fee-queries';
import { requireSchoolPermission } from '@/lib/school-guard';

export const metadata: Metadata = {
  title: 'Generate vouchers',
};

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export default async function GenerateChallansPage() {
  const { claims, locationId } = await requireSchoolPermission('fees.write');

  const [academicYears, grades, feeTypes, dueDay] = await Promise.all([
    listAcademicYears(locationId),
    listGrades(locationId, claims.branchId ?? undefined),
    listFeeTypes(locationId, { activeOnly: true }),
    getDueDay(locationId),
  ]);

  const hasMonthlyType = feeTypes.some((feeType) => feeType.feeCategory === 'monthly');

  return (
    <div className="space-y-6">
      <PageHeader
        title="Generate vouchers"
        description="Raise this month&rsquo;s bills. A student who already holds a voucher for the period is skipped, so a run can safely be repeated."
      />

      {academicYears.length === 0 ? (
        <Card>
          <p className="text-sm text-ink-muted">
            No academic years exist yet, so nothing can be billed.
          </p>
          <Link
            href="/dashboard/admissions/academic-years/new"
            className="mt-3 inline-block text-sm font-medium text-brand-primary hover:underline"
          >
            Set up an academic year
          </Link>
        </Card>
      ) : !hasMonthlyType ? (
        <Card>
          <p className="text-sm text-ink-muted">
            No active monthly fee head exists, so a monthly voucher would be empty.
            Set up your fee types first.
          </p>
          <Link
            href="/dashboard/fees/types"
            className="mt-3 inline-block text-sm font-medium text-brand-primary hover:underline"
          >
            Set up fee types
          </Link>
        </Card>
      ) : (
        <ChallanGenerator
          academicYears={academicYears}
          grades={grades.map((grade) => ({ id: grade.id, label: grade.label }))}
          defaultDueDay={dueDay}
        />
      )}
    </div>
  );
}
