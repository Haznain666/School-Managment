import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import { ChallanActions } from '@/components/fees/ChallanActions';
import { ChallanPrintView } from '@/components/fees/ChallanPrintView';
import { Badge, type BadgeVariant } from '@/components/ui/Badge';
import { Card, CardTitle } from '@/components/ui/Card';
import { MONTH_NAMES } from '@/db/schema/academic-years';
import {
  CHALLAN_STATUS_LABELS,
  type ChallanStatus,
} from '@/db/schema/fee-challans';
import { PAYMENT_METHOD_LABELS } from '@/db/schema/fee-payments';
import { daysOverdue } from '@/lib/fee-calculator';
import { getChallanDetail, getLateFeeRule } from '@/lib/fee-queries';
import { amountInWords, formatAmount, formatPkr, toPaise } from '@/lib/money';
import { requireSchoolRole } from '@/lib/school-guard';
import { isUuid } from '@/lib/validation';
import { FEE_READ_ROLES, FEE_WRITE_ROLES } from '@/types/school-auth';

export const metadata: Metadata = {
  title: 'Challan',
};

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const STATUS_VARIANTS: Record<ChallanStatus, BadgeVariant> = {
  unpaid: 'warning',
  partial: 'warning',
  paid: 'success',
  cancelled: 'neutral',
  waived: 'neutral',
};

/**
 * One challan: what was billed, what has been paid, and the printable slip.
 *
 * The print view is rendered into this same page rather than a separate route,
 * so "Print" is one browser call with nothing to fetch — and so what is printed
 * is provably the same read as what is on screen.
 */
export default async function ChallanDetailPage({
  params,
}: {
  params: Promise<{ challanId: string }>;
}) {
  const { claims, locationId } = await requireSchoolRole(FEE_READ_ROLES);
  const { challanId } = await params;

  if (!isUuid(challanId)) notFound();

  const [challan, lateFeeRule] = await Promise.all([
    getChallanDetail(locationId, challanId),
    getLateFeeRule(locationId),
  ]);

  if (challan === null) notFound();

  const balancePaise = toPaise(challan.totalAmount) - toPaise(challan.paidAmount);
  const overdueDays =
    challan.status === 'unpaid' || challan.status === 'partial'
      ? daysOverdue(challan.dueDate)
      : 0;

  const period =
    challan.billingMonth === null || challan.billingYear === null
      ? 'One-off'
      : `${MONTH_NAMES[challan.billingMonth - 1] ?? challan.billingMonth} ${challan.billingYear}`;

  return (
    <>
      <div className="space-y-6 print:hidden">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <Link
              href="/dashboard/fees/challans"
              className="text-sm font-medium text-brand-primary hover:underline"
            >
              ← All challans
            </Link>
            <h2 className="mt-1 flex flex-wrap items-center gap-3 text-xl font-semibold text-slate-900">
              <span className="font-mono">{challan.challanNumber}</span>
              <Badge variant={STATUS_VARIANTS[challan.status]}>
                {CHALLAN_STATUS_LABELS[challan.status]}
              </Badge>
              {overdueDays > 0 ? (
                <Badge variant="danger">{overdueDays} days overdue</Badge>
              ) : null}
            </h2>
            <p className="mt-1 text-sm text-slate-500">
              {challan.studentName} ·{' '}
              <span className="font-mono">{challan.studentId}</span> ·{' '}
              {challan.gradeName ?? 'No class recorded'}
              {challan.sectionName === null ? '' : ` ${challan.sectionName}`}
            </p>
          </div>

          <div className="text-right">
            <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
              Balance
            </p>
            <p className="text-2xl font-bold text-slate-900">
              {formatPkr(balancePaise / 100)}
            </p>
          </div>
        </div>

        <ChallanActions
          challanId={challan.id}
          status={challan.status}
          hasPayments={challan.payments.length > 0}
          hasGuardian={challan.guardian !== null}
          canWrite={FEE_WRITE_ROLES.includes(claims.role)}
          lateFeesEnabled={lateFeeRule?.isEnabled === true}
          isOverdue={overdueDays > 0}
        />

        <div className="grid gap-4 lg:grid-cols-3">
          <Card className="lg:col-span-2 p-0" header={<CardTitle title="Line items" />}>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-500">
                  <tr>
                    <th scope="col" className="px-5 py-3 font-medium">Fee head</th>
                    <th scope="col" className="px-5 py-3 text-right font-medium">Amount</th>
                    <th scope="col" className="px-5 py-3 text-right font-medium">Concession</th>
                    <th scope="col" className="px-5 py-3 text-right font-medium">Net</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {challan.items.map((item) => (
                    <tr key={item.id}>
                      <td className="px-5 py-3 text-slate-900">{item.description}</td>
                      <td className="px-5 py-3 text-right text-slate-600">
                        {formatAmount(item.amount)}
                      </td>
                      <td className="px-5 py-3 text-right text-slate-600">
                        {Number(item.concessionAmount) === 0
                          ? '—'
                          : `−${formatAmount(item.concessionAmount)}`}
                      </td>
                      <td className="px-5 py-3 text-right font-medium text-slate-900">
                        {formatAmount(item.netAmount)}
                      </td>
                    </tr>
                  ))}

                  {Number(challan.lateFeeAmount) === 0 ? null : (
                    <tr>
                      <td className="px-5 py-3 text-slate-900">Late fee</td>
                      <td className="px-5 py-3 text-right text-slate-600">
                        {formatAmount(challan.lateFeeAmount)}
                      </td>
                      <td className="px-5 py-3 text-right text-slate-600">—</td>
                      <td className="px-5 py-3 text-right font-medium text-slate-900">
                        {formatAmount(challan.lateFeeAmount)}
                      </td>
                    </tr>
                  )}
                </tbody>
                <tfoot className="border-t border-slate-200 bg-slate-50">
                  <tr>
                    <th scope="row" colSpan={3} className="px-5 py-3 text-left font-medium text-slate-600">
                      Total payable
                    </th>
                    <td className="px-5 py-3 text-right text-base font-bold text-slate-900">
                      {formatAmount(challan.totalAmount)}
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>

            <p className="border-t border-slate-200 px-5 py-3 text-xs text-slate-500">
              {amountInWords(challan.totalAmount)}
            </p>
          </Card>

          <Card header={<CardTitle title="Details" />}>
            <dl className="space-y-3">
              <Detail label="Billing period" value={period} />
              <Detail label="Academic year" value={challan.academicYearName} />
              <Detail label="Issue date" value={challan.issueDate} />
              <Detail label="Due date" value={challan.dueDate} />
              <Detail label="Billed" value={formatPkr(challan.totalAmount)} />
              <Detail label="Paid" value={formatPkr(challan.paidAmount)} />
              <Detail label="Balance" value={formatPkr(balancePaise / 100)} />
              <Detail
                label="Guardian"
                value={
                  challan.guardian === null
                    ? 'None on file'
                    : `${challan.guardian.name} · ${challan.guardian.phone}`
                }
              />
              {challan.notes === null || challan.notes === '' ? null : (
                <Detail label="Notes" value={challan.notes} />
              )}
            </dl>
          </Card>
        </div>

        <Card
          header={
            <CardTitle
              title="Payment history"
              description="Every amount recorded against this challan, newest first."
            />
          }
          className="p-0"
        >
          {challan.payments.length === 0 ? (
            <p className="px-5 py-4 text-sm text-slate-600">
              Nothing has been received against this challan yet.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-500">
                  <tr>
                    <th scope="col" className="px-5 py-3 font-medium">Date</th>
                    <th scope="col" className="px-5 py-3 text-right font-medium">Amount</th>
                    <th scope="col" className="px-5 py-3 font-medium">Method</th>
                    <th scope="col" className="px-5 py-3 font-medium">Reference</th>
                    <th scope="col" className="px-5 py-3 font-medium">Recorded by</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {challan.payments.map((payment) => (
                    <tr key={payment.id}>
                      <td className="px-5 py-3 text-slate-600">{payment.paymentDate}</td>
                      <td className="px-5 py-3 text-right font-medium text-slate-900">
                        {formatAmount(payment.amount)}
                      </td>
                      <td className="px-5 py-3 text-slate-600">
                        {PAYMENT_METHOD_LABELS[payment.paymentMethod]}
                      </td>
                      <td className="px-5 py-3 font-mono text-xs text-slate-600">
                        {payment.referenceNumber ?? '—'}
                      </td>
                      <td className="px-5 py-3 text-slate-600">
                        {payment.collectedByName ?? '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </div>

      <ChallanPrintView
        data={{
          challanNumber: challan.challanNumber,
          schoolName: challan.schoolName,
          schoolAddress: challan.schoolAddress,
          schoolPhone: challan.schoolPhone,
          branchName: challan.branchName,
          studentName: challan.studentName,
          studentId: challan.studentId,
          gradeName: challan.gradeName,
          sectionName: challan.sectionName,
          rollNumber: challan.rollNumber,
          billingMonth: challan.billingMonth,
          billingYear: challan.billingYear,
          academicYearName: challan.academicYearName,
          issueDate: challan.issueDate,
          dueDate: challan.dueDate,
          subtotal: challan.subtotal,
          concessionAmount: challan.concessionAmount,
          lateFeeAmount: challan.lateFeeAmount,
          totalAmount: challan.totalAmount,
          paidAmount: challan.paidAmount,
          items: challan.items,
        }}
      />
    </>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs font-medium uppercase tracking-wide text-slate-500">
        {label}
      </dt>
      <dd className="mt-0.5 text-sm text-slate-900">{value}</dd>
    </div>
  );
}
