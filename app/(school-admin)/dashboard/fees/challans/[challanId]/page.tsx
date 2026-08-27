import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import { SiblingCard } from '@/components/admissions/SiblingCard';
import { ChallanActions } from '@/components/fees/ChallanActions';
import { ChallanPrintView } from '@/components/fees/ChallanPrintView';
import { Badge, type BadgeVariant } from '@/components/ui/Badge';
import { Card, CardTitle } from '@/components/ui/Card';
import {
  Table,
  TableBody,
  TableCell,
  TableFoot,
  TableHead,
  TableHeaderCell,
  TableRow,
} from '@/components/ui/Table';
import { MONTH_NAMES } from '@/db/schema/academic-years';
import {
  CHALLAN_STATUS_LABELS,
  type ChallanStatus,
} from '@/db/schema/fee-challans';
import { PAYMENT_METHOD_LABELS } from '@/db/schema/fee-payments';
import { daysOverdue } from '@/lib/fee-calculator';
import {
  getChallanDetail,
  getLateFeeRule,
  getStudentCreditHistory,
} from '@/lib/fee-queries';
import { amountInWords, formatAmount, formatPkr, toPaise } from '@/lib/money';
import { requireSchoolPermission } from '@/lib/school-guard';
import { listSiblings } from '@/lib/siblings';
import { isUuid } from '@/lib/validation';

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
  const { locationId, permissions } = await requireSchoolPermission('fees.read');
  const { challanId } = await params;

  if (!isUuid(challanId)) notFound();

  const [challan, lateFeeRule] = await Promise.all([
    getChallanDetail(locationId, challanId),
    getLateFeeRule(locationId),
  ]);

  if (challan === null) notFound();

  /*
   * Who else in this family the school is billing.
   *
   * Read after the challan because it needs the student on it. It answers the
   * question a parent asks at the counter — "is this everything, or is there
   * another slip for my other child" — which until now could only be answered
   * by searching the challan list twice and knowing to.
   */
  const [siblings, credits] = await Promise.all([
    listSiblings(locationId, challan.studentProfileId),
    // What this child is still owed, after whatever this voucher already took
    // off. A credit nobody can see is a credit nobody trusts, and the counter
    // is where a parent asks about it.
    getStudentCreditHistory(locationId, challan.studentProfileId),
  ]);

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
            <h2 className="mt-1 flex flex-wrap items-center gap-3 text-xl font-semibold text-ink">
              <span className="font-mono">{challan.challanNumber}</span>
              <Badge variant={STATUS_VARIANTS[challan.status]}>
                {CHALLAN_STATUS_LABELS[challan.status]}
              </Badge>
              {overdueDays > 0 ? (
                <Badge variant="danger">{overdueDays} days overdue</Badge>
              ) : null}
            </h2>
            <p className="mt-1 text-sm text-ink-muted">
              {challan.studentName} ·{' '}
              <span className="font-mono">{challan.studentId}</span> ·{' '}
              {challan.gradeName ?? 'No class recorded'}
              {challan.sectionName === null ? '' : ` ${challan.sectionName}`}
            </p>
          </div>

          <div className="text-right">
            <p className="text-xs font-medium uppercase tracking-wide text-ink-muted">
              Balance
            </p>
            <p className="text-2xl font-bold text-ink">
              {formatPkr(balancePaise / 100)}
            </p>
          </div>
        </div>

        <ChallanActions
          challanId={challan.id}
          status={challan.status}
          hasPayments={challan.payments.length > 0}
          hasGuardian={challan.guardian !== null}
          canWrite={permissions.includes('fees.write')}
          lateFeesEnabled={lateFeeRule?.isEnabled === true}
          isOverdue={overdueDays > 0}
        />

        <div className="grid gap-4 lg:grid-cols-3">
          <Card className="lg:col-span-2 p-0" header={<CardTitle title="Line items" />}>
            <div className="overflow-x-auto">
              <Table caption="Challan lines" className="rounded-none border-0">
                <TableHead>
                  <TableRow>
                    <TableHeaderCell>Fee head</TableHeaderCell>
                    <TableHeaderCell align="numeric">Amount</TableHeaderCell>
                    <TableHeaderCell align="numeric">Concession</TableHeaderCell>
                    <TableHeaderCell align="numeric">Net</TableHeaderCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {challan.items.map((item) => (
                    <TableRow key={item.id}>
                      <TableCell>{item.description}</TableCell>
                      <TableCell align="numeric" muted>
                        {formatAmount(item.amount)}
                      </TableCell>
                      <TableCell align="numeric" muted>
                        {Number(item.concessionAmount) === 0
                          ? '—'
                          : `−${formatAmount(item.concessionAmount)}`}
                      </TableCell>
                      <TableCell rowHeader align="numeric">
                        {formatAmount(item.netAmount)}
                      </TableCell>
                    </TableRow>
                  ))}

                  {/*
                    Credit carried forward, as a line of its own.

                    It is not a `fee_challan_items` row and cannot be: every
                    line there carries a `fee_type_id`, and an adjustment has no
                    fee head — it is not a charge the school levied, it is money
                    the school already owed. It sits on the header and is
                    rendered from there, above the late fee, because that is the
                    order the total is built in:
                    subtotal − concession − credit + late fee.
                  */}
                  {toPaise(challan.creditApplied) === 0 ? null : (
                    <TableRow>
                      <TableCell>Adjustment — credit carried forward</TableCell>
                      <TableCell align="numeric" muted>—</TableCell>
                      <TableCell align="numeric" muted>
                        {`−${formatAmount(challan.creditApplied)}`}
                      </TableCell>
                      <TableCell rowHeader align="numeric">
                        {`−${formatAmount(challan.creditApplied)}`}
                      </TableCell>
                    </TableRow>
                  )}

                  {Number(challan.lateFeeAmount) === 0 ? null : (
                    <TableRow>
                      <TableCell>Late fee</TableCell>
                      <TableCell align="numeric" muted>
                        {formatAmount(challan.lateFeeAmount)}
                      </TableCell>
                      <TableCell align="numeric" muted>—</TableCell>
                      <TableCell rowHeader align="numeric">
                        {formatAmount(challan.lateFeeAmount)}
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
                <TableFoot>
                  <TableRow>
                    <TableCell rowHeader muted colSpan={3}>
                      Total payable
                    </TableCell>
                    <TableCell align="numeric" className="text-base font-bold">
                      {formatAmount(challan.totalAmount)}
                    </TableCell>
                  </TableRow>
                </TableFoot>
              </Table>
            </div>

            <p className="border-t border-line px-5 py-3 text-xs text-ink-muted">
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
              {toPaise(credits.balance) === 0 ? null : (
                <Detail
                  label="Credit carried forward"
                  value={`${formatPkr(credits.balance)} — comes off the next voucher`}
                />
              )}
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

        <SiblingCard
          siblings={siblings}
          title="Siblings at this school"
          description="This student's family. If more than one of them has an open challan this month, a single family voucher can be issued instead — Fees → Family Vouchers."
          hrefFor={(sibling) =>
            `/dashboard/admissions/students/${sibling.studentProfileId}`
          }
        />

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
            <p className="px-5 py-4 text-sm text-ink-muted">
              Nothing has been received against this challan yet.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <Table caption="Payments against this challan" className="rounded-none border-0">
                <TableHead>
                  <TableRow>
                    <TableHeaderCell>Date</TableHeaderCell>
                    <TableHeaderCell align="numeric">Amount</TableHeaderCell>
                    <TableHeaderCell>Method</TableHeaderCell>
                    <TableHeaderCell>Reference</TableHeaderCell>
                    <TableHeaderCell>Recorded by</TableHeaderCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {challan.payments.map((payment) => (
                    <TableRow key={payment.id}>
                      <TableCell muted>{payment.paymentDate}</TableCell>
                      <TableCell rowHeader align="numeric">
                        {formatAmount(payment.amount)}
                      </TableCell>
                      <TableCell muted>
                        {PAYMENT_METHOD_LABELS[payment.paymentMethod]}
                      </TableCell>
                      <TableCell muted className="font-mono text-xs">
                        {payment.referenceNumber ?? '—'}
                      </TableCell>
                      <TableCell muted>
                        {payment.collectedByName ?? '—'}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
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
          creditApplied: challan.creditApplied,
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
      <dt className="text-xs font-medium uppercase tracking-wide text-ink-muted">
        {label}
      </dt>
      <dd className="mt-0.5 text-sm text-ink">{value}</dd>
    </div>
  );
}
