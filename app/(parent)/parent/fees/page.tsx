import type { Metadata } from 'next';
import Link from 'next/link';

import { ChallanPrintView } from '@/components/fees/ChallanPrintView';
import { PrintButton } from '@/components/fees/PrintButton';
import { ChildSelector } from '@/components/parent/ChildSelector';
import { Badge, type BadgeVariant } from '@/components/ui/Badge';
import { Card, CardTitle } from '@/components/ui/Card';
import { PageHeader } from '@/components/ui/PageHeader';
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
import { listChildrenForGuardian, getActiveAcademicYear } from '@/lib/admissions-queries';
import { formatDateOnly } from '@/lib/dates';
import {
  getChallanDetail,
  getStudentFeeSummary,
  guardianOwnsStudent,
  listStudentChallans,
  type ChallanListRow,
} from '@/lib/fee-queries';
import { formatAmount, formatPkr, toPaise } from '@/lib/money';
import { requireSchoolRole } from '@/lib/school-guard';
import { getSchoolUserByUid } from '@/lib/school-queries';
import { isUuid } from '@/lib/validation';

export const metadata: Metadata = {
  title: 'Fees',
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
 * A parent's view of their children's fees.
 *
 * ── On authorisation ─────────────────────────────────────────────────────
 * Every read here is gated on `student_guardians.school_user_id` — the link
 * between this signed-in parent and a child. The `?child=` parameter can only
 * select among children that query already returned, and `?voucher=` is checked
 * against the selected child before the challan is fetched. A id belonging to
 * another family therefore resolves to nothing rather than to somebody else's
 * bill.
 */
export default async function ParentFeesPage({
  searchParams,
}: {
  searchParams: Promise<{ child?: string; challan?: string }>;
}) {
  const { claims, locationId } = await requireSchoolRole(['parent']);
  const profile = await getSchoolUserByUid(locationId, claims.uid);

  const activeYear = await getActiveAcademicYear(locationId);
  const children =
    profile === null
      ? []
      : await listChildrenForGuardian(locationId, profile.id, activeYear?.id ?? null);

  const { child: requestedChild, challan: requestedChallan } = await searchParams;

  const selected =
    children.find((entry) => entry.studentProfileId === requestedChild) ??
    children[0] ??
    null;

  if (selected === null) {
    return (
      <div className="space-y-6">
        <Heading />
        <Card>
          <p className="text-sm text-ink-muted">
            No children are recorded against your account yet, so there are no
            fees to show. Your school admin can link you to your child&rsquo;s
            record.
          </p>
        </Card>
      </div>
    );
  }

  // The child came from the guardian's own list, but the check is repeated
  // rather than assumed: it is the one line standing between two families.
  const owns =
    profile !== null &&
    (await guardianOwnsStudent(locationId, profile.id, selected.studentProfileId));

  if (!owns) {
    return (
      <div className="space-y-6">
        <Heading />
        <Card>
          <p className="text-sm text-ink-muted">
            That student is not linked to your account.
          </p>
        </Card>
      </div>
    );
  }

  const [summary, challans] = await Promise.all([
    getStudentFeeSummary(locationId, selected.studentProfileId),
    listStudentChallans(locationId, selected.studentProfileId),
  ]);

  const openChallan =
    isUuid(requestedChallan) &&
    challans.some((row) => row.id === requestedChallan)
      ? await getChallanDetail(locationId, requestedChallan)
      : null;

  return (
    <div className="space-y-6">
      <Heading />

      {/* The open challan is deliberately not carried across a child switch:
          a voucher belongs to one child, and keeping the id would open
          somebody else's — or, more likely, nothing at all. */}
      <div className="print:hidden">
        <ChildSelector
          students={children}
          selectedId={selected.studentProfileId}
          basePath="/parent/fees"
        />
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <SummaryCard label="Total billed" value={formatPkr(summary.billed)} />
        <SummaryCard label="Total paid" value={formatPkr(summary.paid)} />
        <SummaryCard
          label="Balance"
          value={formatPkr(summary.balance)}
          emphasis={toPaise(summary.balance) > 0}
        />
      </div>

      {openChallan === null ? null : (
        <>
          <Card
            header={
              <CardTitle
                title={openChallan.challanNumber}
                description={`${periodLabel(openChallan)} · due ${formatDateOnly(openChallan.dueDate)}`}
                action={
                  <Link
                    href={`/parent/fees?child=${selected.studentProfileId}`}
                    className="text-sm font-medium text-brand-primary hover:underline"
                  >
                    Close
                  </Link>
                }
              />
            }
          >
            <div className="overflow-x-auto">
              <Table caption="Fee vouchers" className="rounded-none border-0">
                <TableHead>
                  <TableRow>
                    <TableHeaderCell>Fee head</TableHeaderCell>
                    <TableHeaderCell align="numeric">Amount</TableHeaderCell>
                    <TableHeaderCell align="numeric">Concession</TableHeaderCell>
                    <TableHeaderCell align="numeric">Net</TableHeaderCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {openChallan.items.map((item) => (
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
                </TableBody>
                <TableFoot>
                  <TableRow>
                    <TableCell rowHeader muted colSpan={3}>
                      Total payable
                    </TableCell>
                    <TableCell align="numeric" className="text-base font-bold">
                      {formatAmount(openChallan.totalAmount)}
                    </TableCell>
                  </TableRow>
                </TableFoot>
              </Table>
            </div>

            <div className="mt-4 flex flex-wrap items-center gap-3">
              <PrintButton label="Print this voucher" />
              <p className="text-sm text-ink-muted">
                Take the printed slip to your nearest bank branch to pay.
              </p>
            </div>
          </Card>

          <ChallanPrintView
            data={{
              challanNumber: openChallan.challanNumber,
              schoolName: openChallan.schoolName,
              schoolAddress: openChallan.schoolAddress,
              schoolPhone: openChallan.schoolPhone,
              branchName: openChallan.branchName,
              studentName: openChallan.studentName,
              studentId: openChallan.studentId,
              gradeName: openChallan.gradeName,
              sectionName: openChallan.sectionName,
              rollNumber: openChallan.rollNumber,
              billingMonth: openChallan.billingMonth,
              billingYear: openChallan.billingYear,
              academicYearName: openChallan.academicYearName,
              issueDate: openChallan.issueDate,
              dueDate: openChallan.dueDate,
              subtotal: openChallan.subtotal,
              concessionAmount: openChallan.concessionAmount,
              lateFeeAmount: openChallan.lateFeeAmount,
              totalAmount: openChallan.totalAmount,
              paidAmount: openChallan.paidAmount,
              items: openChallan.items,
            }}
          />
        </>
      )}

      <Card
        header={
          <CardTitle
            title="Voucher history"
            description={`Every bill issued for ${selected.name}.`}
          />
        }
        className="p-0 print:hidden"
      >
        {challans.length === 0 ? (
          <p className="px-5 py-4 text-sm text-ink-muted">
            No challans have been issued yet.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <Table caption="Payments received" className="rounded-none border-0">
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
                    <TableCell>
                      <Link
                        href={`/parent/fees?child=${selected.studentProfileId}&challan=${row.id}`}
                        className="font-medium text-ink hover:underline"
                      >
                        {periodLabel(row)}
                      </Link>
                    </TableCell>
                    <TableCell muted className="font-mono text-xs">
                      {row.challanNumber}
                    </TableCell>
                    <TableCell align="numeric">
                      {formatAmount(row.totalAmount)}
                    </TableCell>
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
        )}
      </Card>
    </div>
  );
}

function Heading() {
  return (
    <div className="print:hidden">
      <PageHeader
        title="Fees"
        description="Your children&rsquo;s vouchers and balances. Payments are recorded by the school once received — there is nothing to pay online."
      />
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
    <Card className="print:hidden">
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
