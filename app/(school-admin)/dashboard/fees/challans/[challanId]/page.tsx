import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import { ChallanActions } from '@/components/fees/ChallanActions';
import { ChallanPrintView } from '@/components/fees/ChallanPrintView';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card, CardTitle } from '@/components/ui/Card';
import { MONTH_NAMES } from '@/db/schema/academic-years';
import {
  CHALLAN_STATUS_LABELS,
  PAYABLE_CHALLAN_STATUSES,
} from '@/db/schema/fee-challans';
import { PAYMENT_METHOD_LABELS } from '@/db/schema/fee-payments';
import { getChallanDetail, getLateFeeRule } from '@/lib/fee-queries';
import { canManageFees } from '@/lib/fee-roles';
import { formatPkr } from '@/lib/money';
import { requireSchoolRole } from '@/lib/school-guard';
import { getSchoolBranding } from '@/lib/school-tenant';
import { isUuid } from '@/lib/validation';
import { ADMIN_PORTAL_ROLES } from '@/types/school-auth';

export const metadata: Metadata = {
  title: 'Challan',
};

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * One challan, on screen and on paper.
 *
 * The print layout lives in the same page rather than a separate route: it is
 * the same data, and a second route would be a second place for the two to
 * drift apart. `@media print` decides which of the two is visible.
 */
export default async function ChallanDetailPage({
  params,
}: {
  params: Promise<{ challanId: string }>;
}) {
  const { claims, locationId } = await requireSchoolRole(ADMIN_PORTAL_ROLES);

  const { challanId } = await params;
  if (!isUuid(challanId)) notFound();

  const challan = await getChallanDetail(locationId, challanId);
  if (challan === null) notFound();

  const [branding, rule] = await Promise.all([
    getSchoolBranding(locationId),
    getLateFeeRule(locationId),
  ]);

  const canManage = canManageFees(claims.role);
  const isPayable = (PAYABLE_CHALLAN_STATUSES as readonly string[]).includes(
    challan.status,
  );

  const billingLabel =
    challan.billingMonth === null
      ? challan.academicYearName
      : `${MONTH_NAMES[challan.billingMonth - 1] ?? ''} ${challan.billingYear ?? ''}`;

  return (
    <div className="space-y-6">
      <div className="no-print flex flex-wrap items-center justify-between gap-3">
        <Link
          href="/dashboard/fees/challans"
          className="text-sm font-medium text-brand-primary hover:underline"
        >
          ← All challans
        </Link>
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
      </div>

      <Card
        className="no-print"
        header={
          <CardTitle
            title={challan.challanNumber}
            description={`${challan.studentName} · ${challan.gradeName} ${challan.sectionName} · ${billingLabel}`}
            action={
              canManage && isPayable ? (
                <Link href={`/dashboard/fees/challans/${challan.id}/record-payment`}>
                  <Button size="sm">Record payment</Button>
                </Link>
              ) : undefined
            }
          />
        }
      >
        <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-4">
          <Detail label="Student ID" value={challan.studentId} mono />
          <Detail label="Issued" value={challan.issueDate} />
          <Detail label="Due" value={challan.dueDate} />
          <Detail
            label="Overdue by"
            value={challan.daysOverdue > 0 ? `${challan.daysOverdue} days` : '—'}
          />
        </dl>

        <div className="mt-5 overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th scope="col" className="py-2 font-medium">Particulars</th>
                <th scope="col" className="py-2 text-right font-medium">Amount</th>
                <th scope="col" className="py-2 text-right font-medium">Concession</th>
                <th scope="col" className="py-2 text-right font-medium">Net</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {challan.items.map((item) => (
                <tr key={item.id}>
                  <td className="py-2 text-slate-900">{item.description}</td>
                  <td className="py-2 text-right text-slate-600">
                    {formatPkr(item.amountPaise)}
                  </td>
                  <td className="py-2 text-right text-slate-600">
                    {item.concessionPaise === 0 ? '—' : formatPkr(item.concessionPaise)}
                  </td>
                  <td className="py-2 text-right font-medium text-slate-900">
                    {formatPkr(item.netPaise)}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot className="border-t border-slate-200 text-sm">
              <tr>
                <td colSpan={3} className="py-2 text-right font-medium text-slate-700">
                  Total
                </td>
                <td className="py-2 text-right font-semibold text-slate-900">
                  {formatPkr(challan.totalPaise)}
                </td>
              </tr>
              <tr>
                <td colSpan={3} className="py-2 text-right font-medium text-slate-700">
                  Paid
                </td>
                <td className="py-2 text-right text-slate-900">
                  {formatPkr(challan.paidPaise)}
                </td>
              </tr>
              <tr>
                <td colSpan={3} className="py-2 text-right font-medium text-slate-700">
                  Balance
                </td>
                <td className="py-2 text-right font-semibold text-slate-900">
                  {formatPkr(challan.balancePaise)}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      </Card>

      <Card className="no-print" header={<CardTitle title="Payment history" />}>
        {challan.payments.length === 0 ? (
          <p className="text-sm text-slate-600">Nothing has been paid yet.</p>
        ) : (
          <ul className="divide-y divide-slate-100">
            {challan.payments.map((payment) => (
              <li key={payment.id} className="flex items-start justify-between gap-3 py-3">
                <div>
                  <p className="font-medium text-slate-900">
                    PKR {formatPkr(payment.amountPaise)}
                  </p>
                  <p className="text-xs text-slate-500">
                    {PAYMENT_METHOD_LABELS[payment.paymentMethod]} ·{' '}
                    {payment.paymentDate}
                    {payment.referenceNumber === null
                      ? ''
                      : ` · ref ${payment.referenceNumber}`}
                  </p>
                  {payment.notes === null ? null : (
                    <p className="mt-1 text-xs text-slate-500">{payment.notes}</p>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <div className="no-print">
        <ChallanActions
          challanId={challan.id}
          status={challan.status}
          hasPayments={challan.paidPaise > 0}
          guardianPhone={challan.guardianPhone}
          canManage={canManage}
        />
      </div>

      <ChallanPrintView
        challan={{
          challanNumber: challan.challanNumber,
          issueDate: challan.issueDate,
          dueDate: challan.dueDate,
          studentName: challan.studentName,
          studentId: challan.studentId,
          gradeName: challan.gradeName,
          sectionName: challan.sectionName,
          billingLabel,
          academicYearName: challan.academicYearName,
          items: challan.items,
          subtotalPaise: challan.subtotalPaise,
          concessionPaise: challan.concessionPaise,
          lateFeePaise: challan.lateFeePaise,
          totalPaise: challan.totalPaise,
          paidPaise: challan.paidPaise,
          balancePaise: challan.balancePaise,
          schoolName: branding?.name ?? 'School',
          schoolLogoUrl: branding?.logoUrl ?? null,
          branchName: challan.branchName,
          bankAccountDetails: rule?.bankAccountDetails ?? null,
        }}
      />
    </div>
  );
}

function Detail({
  label,
  value,
  mono = false,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div>
      <dt className="text-xs font-medium uppercase tracking-wide text-slate-500">
        {label}
      </dt>
      <dd className={`mt-0.5 text-sm text-slate-900${mono ? ' font-mono' : ''}`}>
        {value}
      </dd>
    </div>
  );
}
