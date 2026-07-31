'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';

import { Badge, type BadgeVariant } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { MONTH_NAMES } from '@/db/schema/academic-years';
import {
  CHALLAN_STATUSES,
  CHALLAN_STATUS_LABELS,
  type ChallanStatus,
} from '@/db/schema/fee-challans';
import { formatPkr } from '@/lib/money';
import { schoolErrorMessage, schoolFetch } from '@/lib/school-client';

/** The challan register, filtered and paginated. */

export interface ChallanTableRow {
  id: string;
  challanNumber: string;
  studentName: string;
  studentId: string;
  gradeName: string;
  sectionName: string;
  billingMonth: number | null;
  billingYear: number | null;
  dueDate: string;
  totalPaise: number;
  paidPaise: number;
  balancePaise: number;
  status: ChallanStatus;
  daysOverdue: number;
}

export interface BranchOption {
  id: string;
  name: string;
}

export interface AcademicYearOption {
  id: string;
  name: string;
  isActive: boolean;
}

export interface ChallanTableProps {
  academicYears: readonly AcademicYearOption[];
  branches: readonly BranchOption[];
  canManage: boolean;
}

interface GradeOption {
  id: string;
  label: string;
}

interface ChallansResponse {
  challans: ChallanTableRow[];
  total: number;
  page: number;
  limit: number;
  filteredTotalPaise: number;
  filteredPaidPaise: number;
}

export function challanStatusVariant(status: ChallanStatus): BadgeVariant {
  switch (status) {
    case 'paid':
      return 'success';
    case 'partial':
      return 'warning';
    case 'unpaid':
      return 'neutral';
    case 'cancelled':
    case 'waived':
      return 'danger';
    default:
      return 'neutral';
  }
}

const STATUS_OPTIONS = [
  { value: '', label: 'All statuses' },
  ...CHALLAN_STATUSES.map((value) => ({
    value,
    label: CHALLAN_STATUS_LABELS[value],
  })),
];

const MONTH_OPTIONS = [
  { value: '', label: 'All months' },
  ...MONTH_NAMES.map((label, index) => ({ value: String(index + 1), label })),
];

export function ChallanTable({
  academicYears,
  branches,
  canManage,
}: ChallanTableProps) {
  const activeYearId =
    academicYears.find((year) => year.isActive)?.id ?? academicYears[0]?.id ?? '';

  const [search, setSearch] = useState('');
  const [academicYearId, setAcademicYearId] = useState(activeYearId);
  const [branchId, setBranchId] = useState('');
  const [gradeId, setGradeId] = useState('');
  const [billingMonth, setBillingMonth] = useState('');
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);

  const [grades, setGrades] = useState<GradeOption[]>([]);
  const [data, setData] = useState<ChallansResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (branchId === '') {
      setGrades([]);
      return;
    }

    const controller = new AbortController();

    void schoolFetch<{ grades: GradeOption[] }>(
      `/api/school/grades?branchId=${encodeURIComponent(branchId)}`,
      { signal: controller.signal },
    )
      .then((payload) => {
        setGrades(payload.grades);
      })
      .catch(() => {
        setGrades([]);
      });

    return () => {
      controller.abort();
    };
  }, [branchId]);

  const load = useCallback(
    async (signal: AbortSignal) => {
      const query = new URLSearchParams({ page: String(page), limit: '20' });
      if (search.trim() !== '') query.set('search', search.trim());
      if (academicYearId !== '') query.set('academicYearId', academicYearId);
      if (gradeId !== '') query.set('gradeId', gradeId);
      if (billingMonth !== '') query.set('billingMonth', billingMonth);
      if (status !== '') query.set('status', status);

      try {
        setData(
          await schoolFetch<ChallansResponse>(
            `/api/school/fees/challans?${query.toString()}`,
            { signal },
          ),
        );
        setError(null);
      } catch (caught) {
        if (caught instanceof DOMException && caught.name === 'AbortError') return;
        setError(schoolErrorMessage(caught, 'Could not load challans.'));
      }
    },
    [search, academicYearId, gradeId, billingMonth, status, page],
  );

  // Debounced so typing in the search box does not fire a request per keystroke.
  useEffect(() => {
    const controller = new AbortController();
    const timer = setTimeout(() => {
      void load(controller.signal);
    }, 250);

    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [load]);

  const totalPages =
    data === null ? 1 : Math.max(Math.ceil(data.total / data.limit), 1);

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        <Input
          label="Search"
          placeholder="Student, student ID or challan number"
          value={search}
          onChange={(event) => {
            setPage(1);
            setSearch(event.target.value);
          }}
        />
        <Select
          label="Academic year"
          options={academicYears.map((year) => ({
            value: year.id,
            label: year.isActive ? `${year.name} (active)` : year.name,
          }))}
          value={academicYearId}
          onChange={(event) => {
            setPage(1);
            setAcademicYearId(event.target.value);
          }}
        />
        <Select
          label="Billing month"
          options={MONTH_OPTIONS}
          value={billingMonth}
          onChange={(event) => {
            setPage(1);
            setBillingMonth(event.target.value);
          }}
        />
        <Select
          label="Branch"
          options={[
            { value: '', label: 'All branches' },
            ...branches.map((branch) => ({ value: branch.id, label: branch.name })),
          ]}
          value={branchId}
          onChange={(event) => {
            setPage(1);
            setGradeId('');
            setBranchId(event.target.value);
          }}
        />
        <Select
          label="Grade"
          options={[
            { value: '', label: 'All grades' },
            ...grades.map((grade) => ({ value: grade.id, label: grade.label })),
          ]}
          value={gradeId}
          disabled={branchId === ''}
          onChange={(event) => {
            setPage(1);
            setGradeId(event.target.value);
          }}
        />
        <Select
          label="Status"
          options={STATUS_OPTIONS}
          value={status}
          onChange={(event) => {
            setPage(1);
            setStatus(event.target.value);
          }}
        />
      </div>

      {error !== null ? (
        <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </p>
      ) : null}

      {data === null ? (
        <Card>
          <p className="text-sm text-slate-500">Loading challans…</p>
        </Card>
      ) : data.challans.length === 0 ? (
        <Card>
          <p className="text-sm text-slate-600">No challans match those filters.</p>
        </Card>
      ) : (
        <>
          <Card className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-500">
                  <tr>
                    <th scope="col" className="px-4 py-3 font-medium">Challan #</th>
                    <th scope="col" className="px-4 py-3 font-medium">Student</th>
                    <th scope="col" className="px-4 py-3 font-medium">Class</th>
                    <th scope="col" className="px-4 py-3 font-medium">Amount</th>
                    <th scope="col" className="px-4 py-3 font-medium">Paid</th>
                    <th scope="col" className="px-4 py-3 font-medium">Due</th>
                    <th scope="col" className="px-4 py-3 font-medium">Status</th>
                    <th scope="col" className="px-4 py-3 font-medium">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {data.challans.map((challan) => (
                    <tr key={challan.id}>
                      <td className="px-4 py-3 font-mono text-xs text-slate-600">
                        {challan.challanNumber}
                      </td>
                      <td className="px-4 py-3">
                        <span className="font-medium text-slate-900">
                          {challan.studentName}
                        </span>
                        <span className="block font-mono text-xs text-slate-500">
                          {challan.studentId}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-slate-600">
                        {challan.gradeName} · {challan.sectionName}
                      </td>
                      <td className="px-4 py-3 text-slate-900">
                        {formatPkr(challan.totalPaise)}
                      </td>
                      <td className="px-4 py-3 text-slate-600">
                        {formatPkr(challan.paidPaise)}
                      </td>
                      <td className="px-4 py-3 text-slate-600">
                        {challan.dueDate}
                        {challan.daysOverdue > 0 ? (
                          <span className="block text-xs font-medium text-red-600">
                            {challan.daysOverdue} day
                            {challan.daysOverdue === 1 ? '' : 's'} overdue
                          </span>
                        ) : null}
                      </td>
                      <td className="px-4 py-3">
                        <Badge variant={challanStatusVariant(challan.status)}>
                          {CHALLAN_STATUS_LABELS[challan.status]}
                        </Badge>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex gap-3">
                          <Link
                            href={`/dashboard/fees/challans/${challan.id}`}
                            className="text-sm font-medium text-brand-primary hover:underline"
                          >
                            View
                          </Link>
                          {canManage &&
                          (challan.status === 'unpaid' || challan.status === 'partial') ? (
                            <Link
                              href={`/dashboard/fees/challans/${challan.id}/record-payment`}
                              className="text-sm font-medium text-brand-primary hover:underline"
                            >
                              Record payment
                            </Link>
                          ) : null}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot className="border-t border-slate-200 bg-slate-50 text-sm">
                  <tr>
                    <td colSpan={3} className="px-4 py-3 font-medium text-slate-700">
                      Totals for this filter
                    </td>
                    <td className="px-4 py-3 font-semibold text-slate-900">
                      {formatPkr(data.filteredTotalPaise)}
                    </td>
                    <td className="px-4 py-3 font-semibold text-slate-900">
                      {formatPkr(data.filteredPaidPaise)}
                    </td>
                    <td colSpan={3} className="px-4 py-3 text-slate-600">
                      Outstanding{' '}
                      {formatPkr(
                        Math.max(data.filteredTotalPaise - data.filteredPaidPaise, 0),
                      )}
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </Card>

          <div className="flex items-center justify-between text-sm text-slate-600">
            <span>
              {data.total} challan{data.total === 1 ? '' : 's'} · page {data.page} of{' '}
              {totalPages}
            </span>
            <div className="flex gap-2">
              <Button
                variant="secondary"
                size="sm"
                disabled={data.page <= 1}
                onClick={() => {
                  setPage((current) => Math.max(current - 1, 1));
                }}
              >
                Previous
              </Button>
              <Button
                variant="secondary"
                size="sm"
                disabled={data.page >= totalPages}
                onClick={() => {
                  setPage((current) => current + 1);
                }}
              >
                Next
              </Button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
