import type { Metadata } from 'next';
import Link from 'next/link';

import { ChallanGenerator } from '@/components/fees/ChallanGenerator';
import { Card } from '@/components/ui/Card';
import { listAcademicYears, listAdmissionsBranches } from '@/lib/admissions-queries';
import { DEFAULT_DUE_DAY } from '@/db/schema/late-fee-rules';
import { getLateFeeRule, listFeeTypes } from '@/lib/fee-queries';
import { requireSchoolRole } from '@/lib/school-guard';

export const metadata: Metadata = {
  title: 'Generate challans',
};

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export default async function GenerateChallansPage() {
  const { claims, locationId } = await requireSchoolRole(['school_admin', 'accountant']);

  const [branches, academicYears, rule, feeTypes] = await Promise.all([
    listAdmissionsBranches(locationId),
    listAcademicYears(locationId),
    getLateFeeRule(locationId),
    listFeeTypes(locationId, { activeOnly: true }),
  ]);

  const visibleBranches =
    claims.branchId === null
      ? branches
      : branches.filter((branch) => branch.id === claims.branchId);

  const hasMonthlyHead = feeTypes.some((feeType) => feeType.feeCategory === 'monthly');

  if (academicYears.length === 0 || !hasMonthlyHead) {
    return (
      <Card>
        <h2 className="text-lg font-semibold text-slate-900">Not ready to bill yet</h2>
        <p className="mt-2 text-sm text-slate-600">
          {academicYears.length === 0
            ? 'There is no academic year to bill against.'
            : 'No monthly fee head exists, so a monthly challan would have no lines on it.'}
        </p>
        <Link
          href={academicYears.length === 0 ? '/dashboard/admissions/academic-years/new' : '/dashboard/fees/types'}
          className="mt-4 inline-block text-sm font-medium text-brand-primary hover:underline"
        >
          {academicYears.length === 0 ? 'Set up an academic year' : 'Set up fee heads'}
        </Link>
      </Card>
    );
  }

  return (
    <div className="max-w-4xl space-y-6">
      <div>
        <h2 className="text-xl font-semibold text-slate-900">Generate challans</h2>
        <p className="mt-1 text-sm text-slate-500">
          Amounts come from each grade&rsquo;s fee structure with the student&rsquo;s
          concessions applied. Students who already have a challan for the period
          are skipped, so a run is safe to repeat.
        </p>
      </div>

      <ChallanGenerator
        branches={visibleBranches}
        academicYears={academicYears}
        dueDay={rule?.dueDayOfMonth ?? DEFAULT_DUE_DAY}
      />
    </div>
  );
}
