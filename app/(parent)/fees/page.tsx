import type { Metadata } from 'next';
import Link from 'next/link';

import { Badge } from '@/components/ui/Badge';
import { Card, CardTitle } from '@/components/ui/Card';
import { MONTH_NAMES } from '@/db/schema/academic-years';
import { CHALLAN_STATUS_LABELS } from '@/db/schema/fee-challans';
import { getActiveAcademicYear, listChildrenForGuardian } from '@/lib/admissions-queries';
import { getStudentFeeSummary } from '@/lib/fee-queries';
import { formatPkr } from '@/lib/money';
import { requireSchoolRole } from '@/lib/school-guard';
import { getModuleFlags, getSchoolUserByUid } from '@/lib/school-queries';

export const metadata: Metadata = {
  title: 'Fees',
};

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * A parent's fee history, per child.
 *
 * Children are found through `student_guardians.school_user_id` — the same link
 * the parent dashboard uses — so a parent can only ever see the fees of a child
 * they are recorded against. The `?child=` parameter selects among the children
 * that query already returned; it cannot widen the set.
 */
export default async function ParentFeesPage({
  searchParams,
}: {
  searchParams: Promise<{ child?: string }>;
}) {
  const { claims, locationId } = await requireSchoolRole(['parent']);

  const [profile, moduleFlags, activeYear] = await Promise.all([
    getSchoolUserByUid(locationId, claims.uid),
    getModuleFlags(locationId),
    getActiveAcademicYear(locationId),
  ]);

  if (!moduleFlags.fee_management) {
    return (
      <Card>
        <h2 className="text-lg font-semibold text-slate-900">Fees are not online yet</h2>
        <p className="mt-2 text-sm text-slate-600">
          Your school does not currently publish fee information through the
          portal. Please contact the school office.
        </p>
      </Card>
    );
  }

  const children =
    profile === null
      ? []
      : await listChildrenForGuardian(locationId, profile.id, activeYear?.id ?? null);

  const { child: requested } = await searchParams;
  const selected =
    children.find((entry) => entry.studentProfileId === requested) ??
    children[0] ??
    null;

  const summary =
    selected === null
      ? null
      : await getStudentFeeSummary(
          locationId,
          selected.studentProfileId,
          activeYear?.id ?? null,
        );

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold text-slate-900">Fees</h2>
        <p className="mt-1 text-sm text-slate-500">
          Challans for {activeYear?.name ?? 'the current academic year'}. Payments
          are recorded by the school office once received.
        </p>
      </div>

      {children.length === 0 ? (
        <Card>
          <p className="text-sm text-slate-600">
            No children are linked to your account yet. They will appear here once
            your school completes their enrolment.
          </p>
        </Card>
      ) : (
        <>
          {children.length > 1 ? (
            <nav aria-label="Children" className="flex flex-wrap gap-2">
              {children.map((child) => (
                <Link
                  key={child.studentProfileId}
                  href={`/parent/fees?child=${child.studentProfileId}`}
                  aria-current={
                    child.studentProfileId === selected?.studentProfileId
                      ? 'page'
                      : undefined
                  }
                  className={
                    child.studentProfileId === selected?.studentProfileId
                      ? 'rounded-full bg-brand-primary px-3 py-1.5 text-sm font-medium text-white'
                      : 'rounded-full bg-slate-100 px-3 py-1.5 text-sm font-medium text-slate-600 hover:bg-slate-200'
                  }
                >
                  {child.name}
                </Link>
              ))}
            </nav>
          ) : null}

          {summary === null || selected === null ? null : (
            <>
              <div className="grid gap-4 sm:grid-cols-3">
                <SummaryCard
                  label="Billed this year"
                  value={`PKR ${formatPkr(summary.totalBilledPaise)}`}
                />
                <SummaryCard
                  label="Paid"
                  value={`PKR ${formatPkr(summary.totalPaidPaise)}`}
                />
                <SummaryCard
                  label="Outstanding"
                  value={`PKR ${formatPkr(summary.outstandingPaise)}`}
                  emphasis={summary.outstandingPaise > 0}
                />
              </div>

              <Card
                className="p-0"
                header={
                  <CardTitle
                    title={selected.name}
                    description={`${selected.studentId}${
                      selected.enrollment === null
                        ? ''
                        : ` · ${selected.enrollment.gradeName} ${selected.enrollment.sectionName}`
                    }`}
                  />
                }
              >
                {summary.challans.length === 0 ? (
                  <p className="px-5 py-4 text-sm text-slate-600">
                    No challans have been issued yet.
                  </p>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-sm">
                      <thead className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-500">
                        <tr>
                          <th scope="col" className="px-5 py-3 font-medium">Month</th>
                          <th scope="col" className="px-5 py-3 font-medium">Challan #</th>
                          <th scope="col" className="px-5 py-3 font-medium">Amount</th>
                          <th scope="col" className="px-5 py-3 font-medium">Paid</th>
                          <th scope="col" className="px-5 py-3 font-medium">Due</th>
                          <th scope="col" className="px-5 py-3 font-medium">Status</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {summary.challans.map((challan) => (
                          <tr key={challan.id}>
                            <td className="px-5 py-3 font-medium text-slate-900">
                              {challan.billingMonth === null
                                ? '—'
                                : `${MONTH_NAMES[challan.billingMonth - 1] ?? ''} ${challan.billingYear ?? ''}`}
                            </td>
                            <td className="px-5 py-3 font-mono text-xs text-slate-600">
                              {challan.challanNumber}
                            </td>
                            <td className="px-5 py-3 text-slate-900">
                              {formatPkr(challan.totalPaise)}
                            </td>
                            <td className="px-5 py-3 text-slate-600">
                              {formatPkr(challan.paidPaise)}
                            </td>
                            <td className="px-5 py-3 text-slate-600">
                              {challan.dueDate}
                              {challan.daysOverdue > 0 ? (
                                <span className="block text-xs font-medium text-red-600">
                                  {challan.daysOverdue} days overdue
                                </span>
                              ) : null}
                            </td>
                            <td className="px-5 py-3">
                              <Badge
                                variant={
                                  challan.status === 'paid'
                                    ? 'success'
                                    : challan.status === 'partial'
                                      ? 'warning'
                                      : challan.status === 'unpaid'
                                        ? 'neutral'
                                        : 'danger'
                                }
                              >
                                {CHALLAN_STATUS_LABELS[challan.status]}
                              </Badge>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </Card>

              <p className="text-sm text-slate-500">
                To pay, deposit the challan amount at the school office or the
                school&rsquo;s designated bank branch. Ask the office for a printed
                challan if you need one.
              </p>
            </>
          )}
        </>
      )}
    </div>
  );
}

function SummaryCard({
  label,
  value,
  emphasis = false,
}: {
  label: string;
  value: string;
  emphasis?: boolean;
}) {
  return (
    <Card>
      <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
        {label}
      </p>
      <p
        className={`mt-2 text-2xl font-bold ${emphasis ? 'text-red-700' : 'text-slate-900'}`}
      >
        {value}
      </p>
    </Card>
  );
}
