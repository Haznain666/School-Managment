import type { Metadata } from 'next';

import { Badge, type BadgeVariant } from '@/components/ui/Badge';
import { Card, CardTitle } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/EmptyState';
import { PageHeader } from '@/components/ui/PageHeader';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeaderCell,
  TableRow,
} from '@/components/ui/Table';
import { MONTH_NAMES } from '@/db/schema/academic-years';
import { CHALLAN_STATUS_LABELS, type ChallanStatus } from '@/db/schema/fee-challans';
import { getStudentBySchoolUserId } from '@/lib/admissions-queries';
import { formatDateOnly } from '@/lib/dates';
import {
  getStudentFeeSummary,
  listStudentChallans,
  type ChallanListRow,
} from '@/lib/fee-queries';
import { formatAmount, formatPkr, toPaise } from '@/lib/money';
import { requireSchoolRole } from '@/lib/school-guard';
import { getSchoolUserByUid } from '@/lib/school-queries';

export const metadata: Metadata = {
  title: 'My fees',
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

function periodLabel(row: ChallanListRow): string {
  if (row.billingMonth === null || row.billingYear === null) return 'One-off';
  return `${MONTH_NAMES[row.billingMonth - 1] ?? row.billingMonth} ${row.billingYear}`;
}

/**
 * A student's own fee status.
 *
 * ── Read-only, and no printable voucher ──────────────────────────────────
 * A challan is paid at a bank counter by whoever holds the money, and that is
 * the parent. Giving a student a printable voucher would put a second copy of a
 * payable document into circulation, which is how a fee gets paid twice or a
 * cancelled voucher gets presented. The parent portal prints it; this page tells
 * the student where they stand, which is the thing they were previously told
 * nothing about.
 *
 * The student profile is resolved from the verified session, so there is no id
 * here that could name somebody else.
 */
export default async function StudentFeesPage() {
  const { claims, locationId } = await requireSchoolRole(['student']);
  const profile = await getSchoolUserByUid(locationId, claims.uid);

  const student =
    profile === null ? null : await getStudentBySchoolUserId(locationId, profile.id);

  if (student === null) {
    return (
      <div className="space-y-6">
        <Heading />
        <Card>
          <p className="text-sm text-ink-muted">
            Your student record is still being set up.
          </p>
        </Card>
      </div>
    );
  }

  const [summary, challans] = await Promise.all([
    getStudentFeeSummary(locationId, student.studentProfileId),
    listStudentChallans(locationId, student.studentProfileId),
  ]);

  return (
    <div className="space-y-6">
      <Heading />

      <div className="grid gap-4 sm:grid-cols-3">
        <SummaryCard label="Total billed" value={formatPkr(summary.billed)} />
        <SummaryCard label="Total paid" value={formatPkr(summary.paid)} />
        <SummaryCard
          label="Balance"
          value={formatPkr(summary.balance)}
          emphasis={toPaise(summary.balance) > 0}
        />
      </div>

      {challans.length === 0 ? (
        <EmptyState
          title="No vouchers have been issued"
          description="A fee voucher appears here once your school raises one against your name."
        />
      ) : (
        <Card
          header={
            <CardTitle
              title="Voucher history"
              description="Every bill issued against your name. Your parent or guardian prints and pays these."
            />
          }
          className="p-0"
        >
          <div className="overflow-x-auto">
            <Table caption="Fee vouchers" className="rounded-none border-0">
              <TableHead>
                <TableRow>
                  <TableHeaderCell>Period</TableHeaderCell>
                  <TableHeaderCell>Voucher #</TableHeaderCell>
                  <TableHeaderCell align="numeric">Amount</TableHeaderCell>
                  <TableHeaderCell align="numeric">Paid</TableHeaderCell>
                  <TableHeaderCell>Status</TableHeaderCell>
                  <TableHeaderCell>Due date</TableHeaderCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {challans.map((row) => (
                  <TableRow key={row.id}>
                    <TableCell rowHeader>{periodLabel(row)}</TableCell>
                    <TableCell muted className="font-mono text-xs">
                      {row.challanNumber}
                    </TableCell>
                    <TableCell align="numeric">{formatAmount(row.totalAmount)}</TableCell>
                    <TableCell align="numeric" muted>
                      {formatAmount(row.paidAmount)}
                    </TableCell>
                    <TableCell>
                      <Badge variant={STATUS_VARIANTS[row.status]}>
                        {CHALLAN_STATUS_LABELS[row.status]}
                      </Badge>
                    </TableCell>
                    <TableCell muted>{formatDateOnly(row.dueDate)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </Card>
      )}
    </div>
  );
}

function Heading() {
  return (
    <PageHeader
      title="My fees"
      description="What has been billed against your name and what has been paid. Payments are recorded by the school once received."
    />
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
      <p className="text-xs font-medium uppercase tracking-wide text-ink-muted">
        {label}
      </p>
      <p
        className={
          emphasis
            ? 'mt-2 text-2xl font-bold text-status-danger-ink'
            : 'mt-2 text-2xl font-bold text-ink'
        }
      >
        {value}
      </p>
    </Card>
  );
}
