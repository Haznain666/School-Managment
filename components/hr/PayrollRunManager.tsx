'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';

import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card, CardTitle } from '@/components/ui/Card';
import { Input } from '@/components/ui/Input';
import { DataTable, type DataTableColumn } from '@/components/ui/DataTable';
import { Select } from '@/components/ui/Select';
import {
  PAYROLL_MONTH_NAMES,
  PAYROLL_RUN_STATUS_LABELS,
  formatPayrollPeriod,
  type PayrollRunStatus,
} from '@/db/schema/payroll-runs';
import { formatPkr } from '@/lib/money';
import { defaultWorkingDays } from '@/lib/payroll-calculator';
import { schoolErrorMessage, schoolFetch } from '@/lib/school-client';

/**
 * The payroll runs a school has raised, and the form that raises the next one.
 *
 * Working days defaults to the month's Mondays-to-Saturdays, which is the
 * Pakistani school week — but it is editable, because public holidays and
 * vacation vary by school and by province and no calendar shipped in code
 * would be right for all of them. It is the denominator for loss of pay, so
 * getting it wrong changes what every docked teacher is paid.
 *
 * Skipped staff are named on screen after a run rather than counted. "3 staff
 * skipped" tells an HR manager nothing they can act on; three names do.
 */

interface RunRow {
  id: string;
  branchName: string | null;
  payrollMonth: number;
  payrollYear: number;
  status: PayrollRunStatus;
  workingDays: number;
  staffCount: number;
  grossTotal: string;
  deductionTotal: string;
  netTotal: string;
}

interface SkippedRow {
  staffId: string;
  name: string;
  reason: string;
}

export interface PayrollRunManagerProps {
  canEdit: boolean;
}

const STATUS_VARIANT: Record<PayrollRunStatus, 'success' | 'warning' | 'danger' | 'neutral'> =
  {
    draft: 'warning',
    approved: 'neutral',
    paid: 'success',
    cancelled: 'danger',
  };

function previousMonth(): { month: number; year: number } {
  const now = new Date();
  const month = now.getUTCMonth(); // 0-indexed now = last month 1-indexed
  return month === 0
    ? { month: 12, year: now.getUTCFullYear() - 1 }
    : { month, year: now.getUTCFullYear() };
}

export function PayrollRunManager({ canEdit }: PayrollRunManagerProps) {
  const initial = previousMonth();

  const [runs, setRuns] = useState<RunRow[] | null>(null);
  const [month, setMonth] = useState(String(initial.month));
  const [year, setYear] = useState(String(initial.year));
  const [workingDays, setWorkingDays] = useState(
    String(defaultWorkingDays(initial.month, initial.year)),
  );
  const [skipped, setSkipped] = useState<SkippedRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const payload = await schoolFetch<{ runs: RunRow[] }>('/api/school/payroll/runs');
      setRuns(payload.runs);
      setError(null);
    } catch (caught) {
      setError(schoolErrorMessage(caught, 'Could not load the payroll runs.'));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  /** Keep the working-days default in step with the period being chosen. */
  const retargetPeriod = (nextMonth: string, nextYear: string): void => {
    setMonth(nextMonth);
    setYear(nextYear);

    const monthNumber = Number(nextMonth);
    const yearNumber = Number(nextYear);

    if (Number.isInteger(monthNumber) && Number.isInteger(yearNumber)) {
      setWorkingDays(String(defaultWorkingDays(monthNumber, yearNumber)));
    }
  };

  const generate = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    setNotice(null);
    setSkipped([]);

    try {
      const payload = await schoolFetch<{
        runId: string;
        staffCount: number;
        skipped: SkippedRow[];
      }>('/api/school/payroll/runs', {
        method: 'POST',
        body: JSON.stringify({
          payrollMonth: Number(month),
          payrollYear: Number(year),
          workingDays: Number(workingDays),
        }),
      });

      setNotice(
        `Raised ${payload.staffCount} payslip${payload.staffCount === 1 ? '' : 's'} for ${formatPayrollPeriod(Number(month), Number(year))}.`,
      );
      setSkipped(payload.skipped);
      await load();
    } catch (caught) {
      setError(schoolErrorMessage(caught, 'Could not run payroll.'));
    } finally {
      setBusy(false);
    }
  };

  const currentYear = new Date().getUTCFullYear();

  const MONTH_OPTIONS = PAYROLL_MONTH_NAMES.map((label, index) => ({
    value: String(index + 1),
    label,
  }));

  const YEAR_OPTIONS = [currentYear, currentYear - 1, currentYear - 2].map((value) => ({
    value: String(value),
    label: String(value),
  }));

  const runColumns: Array<DataTableColumn<RunRow>> = [
    {
      id: 'period',
      header: 'Period',
      // Year and month as one number, so December 2025 sorts before January
      // 2026 rather than after it as text.
      sortValue: (row) => row.payrollYear * 100 + row.payrollMonth,
      searchValue: (row) =>
        `${formatPayrollPeriod(row.payrollMonth, row.payrollYear)} ${
          row.branchName ?? 'Whole school'
        }`,
      cell: (row) => (
        <>
          <p className="font-medium text-ink">
            {formatPayrollPeriod(row.payrollMonth, row.payrollYear)}
          </p>
          <p className="text-xs text-ink-muted">
            {row.branchName ?? 'Whole school'} · {row.workingDays} working days
          </p>
        </>
      ),
    },
    {
      id: 'staff',
      header: 'Staff',
      kind: 'number',
      muted: true,
      sortValue: (row) => row.staffCount,
      cell: (row) => row.staffCount,
    },
    {
      id: 'gross',
      header: 'Gross',
      kind: 'money',
      muted: true,
      sortValue: (row) => Number(row.grossTotal),
      cell: (row) => formatPkr(row.grossTotal),
    },
    {
      id: 'net',
      header: 'Net',
      kind: 'money',
      rowHeader: true,
      sortValue: (row) => Number(row.netTotal),
      cell: (row) => formatPkr(row.netTotal),
    },
    {
      id: 'status',
      header: 'Status',
      sortValue: (row) => PAYROLL_RUN_STATUS_LABELS[row.status],
      cell: (row) => (
        <Badge variant={STATUS_VARIANT[row.status]}>
          {PAYROLL_RUN_STATUS_LABELS[row.status]}
        </Badge>
      ),
    },
    {
      id: 'open',
      header: <span className="sr-only">Open</span>,
      align: 'numeric',
      cell: (row) => (
        <Link
          href={`/dashboard/payroll/runs/${row.id}`}
          className="text-sm font-medium text-brand-primary hover:underline"
        >
          Open
        </Link>
      ),
    },
  ];

  return (
    <div className="space-y-4">
      {error !== null ? (
        <p role="alert" className="rounded-lg bg-status-danger-subtle px-3 py-2 text-sm text-status-danger-ink">
          {error}
        </p>
      ) : null}

      {notice !== null ? (
        <p className="rounded-lg bg-status-success-subtle px-3 py-2 text-sm text-status-success-ink">
          {notice}
        </p>
      ) : null}

      {skipped.length > 0 ? (
        <Card>
          <h3 className="text-base font-semibold text-ink">
            Not paid in this run
          </h3>
          <p className="mt-1 text-sm text-ink-muted">
            These staff were skipped because they have no salary structure. Assign
            one and regenerate while the run is still a draft.
          </p>
          <ul className="mt-3 space-y-1 text-sm text-ink">
            {skipped.map((row) => (
              <li key={row.staffId}>
                <Link
                  href={`/dashboard/hr/staff/${row.staffId}`}
                  className="font-medium text-brand-primary hover:underline"
                >
                  {row.name}
                </Link>{' '}
                — {row.reason}
              </li>
            ))}
          </ul>
        </Card>
      ) : null}

      {canEdit ? (
        <Card
          header={
            <CardTitle
              title="Run payroll"
              description="One run per month. A draft can be recomputed; an approved run cannot."
            />
          }
        >
          <div className="grid gap-4 sm:grid-cols-4">
            <Select
              label="Month"
              options={MONTH_OPTIONS}
              value={month}
              onChange={(event) => {
                retargetPeriod(event.target.value, year);
              }}
            />
            <Select
              label="Year"
              options={YEAR_OPTIONS}
              value={year}
              onChange={(event) => {
                retargetPeriod(month, event.target.value);
              }}
            />
            <Input
              label="Working days"
              type="number"
              min={1}
              max={31}
              value={workingDays}
              hint="The denominator for loss of pay."
              onChange={(event) => {
                setWorkingDays(event.target.value);
              }}
            />
            <div className="flex items-end">
              <Button
                isLoading={busy}
                onClick={() => {
                  void generate();
                }}
              >
                Run payroll
              </Button>
            </div>
          </div>
        </Card>
      ) : null}

      <DataTable
        caption="Payroll runs"
        columns={runColumns}
        rows={runs ?? []}
        getRowKey={(row) => row.id}
        pending={runs === null}
        defaultSort={{ columnId: 'period', direction: 'desc' }}
        search={{ placeholder: 'Month, year or campus' }}
        filters={[
          {
            id: 'status',
            label: 'Status',
            allLabel: 'Every run',
            options: Object.entries(PAYROLL_RUN_STATUS_LABELS).map(([value, label]) => ({
              value,
              label,
            })),
            rowValue: (row) => row.status,
          },
        ]}
        itemNoun={{ singular: 'run', plural: 'runs' }}
        emptyTitle="No payroll has been run yet"
        emptyDescription="A run needs active staff with salary structures assigned — set those up under Staff first."
        noResultTitle="No runs match those filters"
        noResultDescription="Clear the search or choose another status."
      />
    </div>
  );
}
