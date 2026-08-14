import type { Metadata } from 'next';
import Link from 'next/link';

import { HrNav } from '@/components/hr/HrNav';
import { Card, CardTitle } from '@/components/ui/Card';
import { PageHeader } from '@/components/ui/PageHeader';
import { getHrSummary } from '@/lib/hr-queries';
import { requireSchoolPermission } from '@/lib/school-guard';

export const metadata: Metadata = {
  title: 'HR',
};

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * HR overview.
 *
 * The two numbers that block payroll — components configured, and active staff
 * with no salary structure — are given their own cards rather than buried in a
 * list, because a run refuses to start without the first and quietly skips
 * people for the second. Both are the questions an HR manager should be able to
 * answer before they click "Run payroll", not after.
 */
export default async function HrOverviewPage() {
  const { locationId } = await requireSchoolPermission('hr.read');
  const summary = await getHrSummary(locationId);

  const tiles: ReadonlyArray<{
    label: string;
    value: number;
    href: string;
    hint?: string;
  }> = [
    {
      label: 'Staff on the books',
      value: summary.totalStaff,
      href: '/dashboard/hr/staff',
    },
    {
      label: 'Active',
      value: summary.activeStaff,
      href: '/dashboard/hr/staff',
      hint: 'Paid by the next run.',
    },
    {
      label: 'Pending leave requests',
      value: summary.pendingLeaveRequests,
      href: '/dashboard/hr/leave',
      hint: 'Awaiting a decision.',
    },
    {
      label: 'Salary components',
      value: summary.componentsConfigured,
      href: '/dashboard/hr/salary-components',
      hint: 'Payroll cannot run with none.',
    },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title="HR &amp; Payroll"
        description="Your staff, what they are paid, and the leave they take."
      />

      <HrNav />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {tiles.map((tile) => (
          <Link key={tile.label} href={tile.href} className="block">
            <Card className="h-full transition hover:border-brand-primary">
              <p className="text-xs uppercase tracking-wide text-ink-muted">
                {tile.label}
              </p>
              <p className="mt-1 text-2xl font-semibold text-ink">{tile.value}</p>
              {tile.hint === undefined ? null : (
                <p className="mt-1 text-xs text-ink-muted">{tile.hint}</p>
              )}
            </Card>
          </Link>
        ))}
      </div>

      {summary.componentsConfigured === 0 ? (
        <Card header={<CardTitle title="Start here" />}>
          <p className="text-sm text-ink-muted">
            No salary components are set up, so no payslip can be computed. Seed
            the usual heads — basic, house rent, medical, and the statutory
            deductions — and then assign each staff member their figures.
          </p>
          <Link
            href="/dashboard/hr/salary-components"
            className="mt-3 inline-block text-sm font-medium text-brand-primary hover:underline"
          >
            Set up salary components
          </Link>
        </Card>
      ) : summary.staffWithoutSalary > 0 ? (
        <Card header={<CardTitle title="Before the next run" />}>
          <p className="text-sm text-ink-muted">
            {summary.staffWithoutSalary} active staff member
            {summary.staffWithoutSalary === 1 ? ' has' : 's have'} no salary
            structure assigned. Payroll skips them rather than paying them zero —
            they are named on screen when a run finishes.
          </p>
          <Link
            href="/dashboard/hr/staff"
            className="mt-3 inline-block text-sm font-medium text-brand-primary hover:underline"
          >
            Review staff
          </Link>
        </Card>
      ) : null}
    </div>
  );
}
