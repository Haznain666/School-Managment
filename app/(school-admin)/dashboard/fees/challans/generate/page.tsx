import type { Metadata } from 'next';
import Link from 'next/link';

import { ChallanGenerator } from '@/components/fees/ChallanGenerator';
import { Card } from '@/components/ui/Card';
import { listAcademicYears, listGrades } from '@/lib/admissions-queries';
import { getDueDay, listFeeTypes } from '@/lib/fee-queries';
import { requireSchoolPermission } from '@/lib/school-guard';

export const metadata: Metadata = {
  title: 'Generate challans',
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
      <div>
        <h2 className="text-xl font-semibold text-slate-900">Generate challans</h2>
        <p className="mt-1 text-sm text-slate-500">
          Raise this month&rsquo;s bills. A student who already holds a challan for
          the period is skipped, so a run can safely be repeated.
        </p>
      </div>

      {academicYears.length === 0 ? (
        <Card>
          <p className="text-sm text-slate-600">
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
          <p className="text-sm text-slate-600">
            No active monthly fee head exists, so a monthly challan would be empty.
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
