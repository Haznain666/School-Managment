'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';

import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card, CardTitle } from '@/components/ui/Card';
import { Input } from '@/components/ui/Input';
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

  return (
    <div className="space-y-4">
      {error !== null ? (
        <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </p>
      ) : null}

      {notice !== null ? (
        <p className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
          {notice}
        </p>
      ) : null}

      {skipped.length > 0 ? (
        <Card>
          <h3 className="text-base font-semibold text-slate-900">
            Not paid in this run
          </h3>
          <p className="mt-1 text-sm text-slate-600">
            These staff were skipped because they have no salary structure. Assign
            one and regenerate while the run is still a draft.
          </p>
          <ul className="mt-3 space-y-1 text-sm text-slate-700">
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

      {runs === null ? (
        <Card>
          <p className="text-sm text-slate-500">Loading payroll runs…</p>
        </Card>
      ) : runs.length === 0 ? (
        <Card>
          <p className="text-sm text-slate-600">
            No payroll has been run yet. A run needs active staff with salary
            structures assigned — set those up under Staff first.
          </p>
        </Card>
      ) : (
        <Card
          header={
            <CardTitle
              title="Payroll runs"
              description={`${runs.length} run${runs.length === 1 ? '' : 's'}.`}
            />
          }
          className="p-0"
        >
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th scope="col" className="px-5 py-3 font-medium">Period</th>
                  <th scope="col" className="px-5 py-3 font-medium">Staff</th>
                  <th scope="col" className="px-5 py-3 font-medium">Gross</th>
                  <th scope="col" className="px-5 py-3 font-medium">Net</th>
                  <th scope="col" className="px-5 py-3 font-medium">Status</th>
                  <th scope="col" className="px-5 py-3 font-medium">
                    <span className="sr-only">Open</span>
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {runs.map((row) => (
                  <tr key={row.id}>
                    <td className="px-5 py-3">
                      <p className="font-medium text-slate-900">
                        {formatPayrollPeriod(row.payrollMonth, row.payrollYear)}
                      </p>
                      <p className="text-xs text-slate-500">
                        {row.branchName ?? 'Whole school'} · {row.workingDays} working days
                      </p>
                    </td>
                    <td className="px-5 py-3 text-slate-600">{row.staffCount}</td>
                    <td className="px-5 py-3 text-slate-600">
                      {formatPkr(row.grossTotal)}
                    </td>
                    <td className="px-5 py-3 font-medium text-slate-900">
                      {formatPkr(row.netTotal)}
                    </td>
                    <td className="px-5 py-3">
                      <Badge variant={STATUS_VARIANT[row.status]}>
                        {PAYROLL_RUN_STATUS_LABELS[row.status]}
                      </Badge>
                    </td>
                    <td className="px-5 py-3 text-right">
                      <Link
                        href={`/dashboard/payroll/runs/${row.id}`}
                        className="text-sm font-medium text-brand-primary hover:underline"
                      >
                        Open
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  );
}
