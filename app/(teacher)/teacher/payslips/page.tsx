import type { Metadata } from 'next';

import { Badge } from '@/components/ui/Badge';
import { Card } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/EmptyState';
import { PageHeader } from '@/components/ui/PageHeader';
import { MONTH_NAMES } from '@/db/schema/academic-years';
import { formatAmount } from '@/lib/money';
import { requireSchoolRole } from '@/lib/school-guard';
import { getSchoolUserByUid } from '@/lib/school-queries';
import { listOwnPayslips, staffIdForSchoolUser } from '@/lib/staff-self-queries';

export const metadata: Metadata = {
  title: 'My payslips',
};

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * A teacher's own payslips.
 *
 * ── There is no id anywhere in this page ─────────────────────────────────
 * The staff record is derived from the signed-in account through
 * `staff.school_user_id`, and `lib/staff-self-queries.ts` takes no id a caller
 * could supply. Salary is the most sensitive number in this schema and the
 * cheapest way to keep it safe is to make "whose payslip" unaskable rather than
 * carefully answered.
 *
 * ── Only paid runs ───────────────────────────────────────────────────────
 * A payslip from a run still being computed is a working figure. Showing one
 * and then paying a different amount is the software telling a teacher
 * something untrue about their salary, so drafts never reach here.
 */
export default async function TeacherPayslipsPage() {
  const { claims, locationId } = await requireSchoolRole(['teacher']);
  const profile = await getSchoolUserByUid(locationId, claims.uid);

  const staffId =
    profile === null ? null : await staffIdForSchoolUser(locationId, profile.id);

  const payslips =
    staffId === null ? [] : await listOwnPayslips(locationId, staffId);

  return (
    <div className="space-y-6">
      <PageHeader
        title="My payslips"
        description="Your own payslips, once a payroll run has been paid. Nobody else’s are reachable from here."
      />

      {staffId === null ? (
        <EmptyState
          title="Your staff record has not been set up yet"
          description="Payslips are attached to an HR staff record. Ask your school office to link your account to it."
        />
      ) : payslips.length === 0 ? (
        <EmptyState
          title="No payslips yet"
          description="A payslip appears here once your school has run and paid a payroll that includes you."
        />
      ) : (
        <Card className="p-0">
          <ul className="divide-y divide-line">
            {payslips.map((payslip) => (
              <li
                key={payslip.id}
                className="flex flex-wrap items-center justify-between gap-3 px-5 py-4"
              >
                <div className="min-w-0">
                  <p className="font-medium text-ink">
                    {MONTH_NAMES[payslip.payrollMonth - 1] ?? payslip.payrollMonth}{' '}
                    {payslip.payrollYear}
                  </p>
                  <p className="font-mono text-xs text-ink-muted">
                    {payslip.payslipNumber}
                    {payslip.paidOn === null ? '' : ` · paid ${payslip.paidOn}`}
                    {payslip.paymentMode === null ? '' : ` · ${payslip.paymentMode}`}
                  </p>
                </div>

                <div className="flex flex-wrap items-center gap-4 text-right">
                  <div>
                    <p className="text-xs uppercase tracking-wide text-ink-muted">
                      Gross
                    </p>
                    <p className="text-sm text-ink">
                      {formatAmount(payslip.grossEarnings)}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs uppercase tracking-wide text-ink-muted">
                      Deductions
                    </p>
                    <p className="text-sm text-ink">
                      {formatAmount(payslip.totalDeductions)}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs uppercase tracking-wide text-ink-muted">
                      Net
                    </p>
                    <p className="text-base font-bold text-ink">
                      {formatAmount(payslip.netPayable)}
                    </p>
                  </div>
                  <Badge variant={payslip.status === 'paid' ? 'success' : 'neutral'}>
                    {payslip.status}
                  </Badge>
                </div>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}
