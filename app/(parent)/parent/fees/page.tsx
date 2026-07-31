import type { Metadata } from 'next';
import Link from 'next/link';

import { ChallanPrintView } from '@/components/fees/ChallanPrintView';
import { PrintButton } from '@/components/fees/PrintButton';
import { Badge, type BadgeVariant } from '@/components/ui/Badge';
import { Card, CardTitle } from '@/components/ui/Card';
import { MONTH_NAMES } from '@/db/schema/academic-years';
import {
  CHALLAN_STATUS_LABELS,
  type ChallanStatus,
} from '@/db/schema/fee-challans';
import { listChildrenForGuardian, getActiveAcademicYear } from '@/lib/admissions-queries';
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
 * select among children that query already returned, and `?challan=` is checked
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
          <p className="text-sm text-slate-600">
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
          <p className="text-sm text-slate-600">
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

      {children.length > 1 ? (
        <nav aria-label="Children" className="flex flex-wrap gap-2">
          {children.map((child) => (
            <Link
              key={child.studentProfileId}
              href={`/parent/fees?child=${child.studentProfileId}`}
              aria-current={
                child.studentProfileId === selected.studentProfileId ? 'page' : undefined
              }
              className={
                child.studentProfileId === selected.studentProfileId
                  ? 'rounded-full bg-brand-primary px-3 py-1.5 text-sm font-medium text-white'
                  : 'rounded-full bg-slate-100 px-3 py-1.5 text-sm font-medium text-slate-600 hover:bg-slate-200'
              }
            >
              {child.name}
            </Link>
          ))}
        </nav>
      ) : null}

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
                description={`${periodLabel(openChallan)} · due ${openChallan.dueDate}`}
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
              <table className="w-full text-left text-sm">
                <thead className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-500">
                  <tr>
                    <th scope="col" className="py-2 font-medium">Fee head</th>
                    <th scope="col" className="py-2 text-right font-medium">Amount</th>
                    <th scope="col" className="py-2 text-right font-medium">Concession</th>
                    <th scope="col" className="py-2 text-right font-medium">Net</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {openChallan.items.map((item) => (
                    <tr key={item.id}>
                      <td className="py-2 text-slate-900">{item.description}</td>
                      <td className="py-2 text-right text-slate-600">
                        {formatAmount(item.amount)}
                      </td>
                      <td className="py-2 text-right text-slate-600">
                        {Number(item.concessionAmount) === 0
                          ? '—'
                          : `−${formatAmount(item.concessionAmount)}`}
                      </td>
                      <td className="py-2 text-right font-medium text-slate-900">
                        {formatAmount(item.netAmount)}
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot className="border-t border-slate-200">
                  <tr>
                    <th scope="row" colSpan={3} className="py-3 text-left font-medium text-slate-600">
                      Total payable
                    </th>
                    <td className="py-3 text-right text-base font-bold text-slate-900">
                      {formatAmount(openChallan.totalAmount)}
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>

            <div className="mt-4 flex flex-wrap items-center gap-3">
              <PrintButton label="Print this challan" />
              <p className="text-sm text-slate-500">
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
            title="Challan history"
            description={`Every bill issued for ${selected.name}.`}
          />
        }
        className="p-0 print:hidden"
      >
        {challans.length === 0 ? (
          <p className="px-5 py-4 text-sm text-slate-600">
            No challans have been issued yet.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th scope="col" className="px-5 py-3 font-medium">Period</th>
                  <th scope="col" className="px-5 py-3 font-medium">Challan #</th>
                  <th scope="col" className="px-5 py-3 text-right font-medium">Amount</th>
                  <th scope="col" className="px-5 py-3 text-right font-medium">Paid</th>
                  <th scope="col" className="px-5 py-3 font-medium">Status</th>
                  <th scope="col" className="px-5 py-3 font-medium">Due date</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {challans.map((row) => (
                  <tr key={row.id}>
                    <td className="px-5 py-3">
                      <Link
                        href={`/parent/fees?child=${selected.studentProfileId}&challan=${row.id}`}
                        className="font-medium text-slate-900 hover:underline"
                      >
                        {periodLabel(row)}
                      </Link>
                    </td>
                    <td className="px-5 py-3 font-mono text-xs text-slate-600">
                      {row.challanNumber}
                    </td>
                    <td className="px-5 py-3 text-right text-slate-900">
                      {formatAmount(row.totalAmount)}
                    </td>
                    <td className="px-5 py-3 text-right text-slate-600">
                      {formatAmount(row.paidAmount)}
                    </td>
                    <td className="px-5 py-3">
                      <Badge variant={STATUS_VARIANTS[row.status]}>
                        {CHALLAN_STATUS_LABELS[row.status]}
                      </Badge>
                    </td>
                    <td className="px-5 py-3 text-slate-600">{row.dueDate}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}

function Heading() {
  return (
    <div className="print:hidden">
      <h2 className="text-xl font-semibold text-slate-900">Fees</h2>
      <p className="mt-1 text-sm text-slate-500">
        Your children&rsquo;s challans and balances. Payments are recorded by the
        school once received — there is nothing to pay online.
      </p>
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
      <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
        {label}
      </p>
      <p
        className={
          emphasis
            ? 'mt-2 text-2xl font-bold text-red-600'
            : 'mt-2 text-2xl font-bold text-slate-900'
        }
      >
        {value}
      </p>
    </Card>
  );
}
