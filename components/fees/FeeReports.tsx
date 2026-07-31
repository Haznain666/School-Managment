'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';

import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card, CardTitle } from '@/components/ui/Card';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { MONTH_NAMES } from '@/db/schema/academic-years';
import { formatAmount, formatPkr } from '@/lib/money';
import { schoolErrorMessage, schoolFetch } from '@/lib/school-client';

/**
 * The three questions a bursar asks, on one screen.
 *
 *   1. Outstanding — who owes what, right now.
 *   2. Collection — what came in, month by month.
 *   3. Defaulters — who has been overdue long enough to chase, with a
 *      one-click WhatsApp reminder.
 *
 * Guardian numbers arrive from the server already masked. The reminder endpoint
 * reads the real number itself, so nothing here needs the full one — and a
 * screen that showed it would be a parent contact list for the taking.
 */

interface OutstandingRow {
  challanId: string;
  challanNumber: string;
  studentName: string;
  studentId: string;
  gradeName: string | null;
  sectionName: string | null;
  billingMonth: number | null;
  billingYear: number | null;
  dueDate: string;
  balance: string;
  daysOverdue: number;
  guardianName: string | null;
  guardianPhone: string | null;
}

interface CollectionMonth {
  month: number;
  year: number;
  collected: string;
  paymentCount: number;
}

export interface GradeOption {
  id: string;
  label: string;
}

export interface FeeReportsProps {
  grades: readonly GradeOption[];
  canSendReminders: boolean;
}

const MONTH_OPTIONS = [
  { value: '', label: 'All months' },
  ...MONTH_NAMES.map((name, index) => ({ value: String(index + 1), label: name })),
];

function periodLabel(row: { billingMonth: number | null; billingYear: number | null }): string {
  if (row.billingMonth === null || row.billingYear === null) return 'One-off';
  return `${MONTH_NAMES[row.billingMonth - 1] ?? row.billingMonth} ${row.billingYear}`;
}

export function FeeReports({ grades, canSendReminders }: FeeReportsProps) {
  return (
    <div className="space-y-6">
      <OutstandingSection grades={grades} />
      <CollectionSection />
      <DefaultersSection grades={grades} canSendReminders={canSendReminders} />
    </div>
  );
}

function OutstandingSection({ grades }: { grades: readonly GradeOption[] }) {
  const [gradeId, setGradeId] = useState('');
  const [billingMonth, setBillingMonth] = useState('');
  const [rows, setRows] = useState<OutstandingRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const query = new URLSearchParams();
    if (gradeId !== '') query.set('gradeId', gradeId);
    if (billingMonth !== '') query.set('billingMonth', billingMonth);

    try {
      const payload = await schoolFetch<{ outstanding: OutstandingRow[] }>(
        `/api/school/fees/reports/outstanding?${query.toString()}`,
      );
      setRows(payload.outstanding);
      setError(null);
    } catch (caught) {
      setError(schoolErrorMessage(caught, 'Could not load outstanding fees.'));
    }
  }, [gradeId, billingMonth]);

  useEffect(() => {
    void load();
  }, [load]);

  const total = (rows ?? []).reduce((sum, row) => sum + Number(row.balance), 0);

  return (
    <Card
      header={
        <CardTitle
          title="Outstanding fees"
          description="Unpaid and partly-paid challans, most overdue first."
        />
      }
      className="p-0"
    >
      <div className="grid gap-4 border-b border-slate-200 px-5 py-4 sm:grid-cols-2 lg:grid-cols-3">
        <Select
          label="Grade"
          options={[
            { value: '', label: 'All grades' },
            ...grades.map((grade) => ({ value: grade.id, label: grade.label })),
          ]}
          value={gradeId}
          onChange={(event) => {
            setGradeId(event.target.value);
          }}
        />
        <Select
          label="Billing month"
          options={MONTH_OPTIONS}
          value={billingMonth}
          onChange={(event) => {
            setBillingMonth(event.target.value);
          }}
        />
        <div className="flex items-end">
          <p className="text-sm text-slate-600">
            <span className="font-semibold text-slate-900">{formatPkr(total)}</span>{' '}
            outstanding across {(rows ?? []).length} challan
            {(rows ?? []).length === 1 ? '' : 's'}.
          </p>
        </div>
      </div>

      {error !== null ? (
        <p role="alert" className="px-5 py-3 text-sm text-red-700">
          {error}
        </p>
      ) : null}

      {rows === null ? (
        <p className="px-5 py-4 text-sm text-slate-500">Loading…</p>
      ) : rows.length === 0 ? (
        <p className="px-5 py-4 text-sm text-slate-600">
          Nothing is outstanding for these filters.
        </p>
      ) : (
        <div className="max-h-96 overflow-auto">
          <table className="w-full text-left text-sm">
            <thead className="sticky top-0 border-b border-slate-200 bg-white text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th scope="col" className="px-5 py-3 font-medium">Student</th>
                <th scope="col" className="px-5 py-3 font-medium">Class</th>
                <th scope="col" className="px-5 py-3 font-medium">Period</th>
                <th scope="col" className="px-5 py-3 font-medium">Due</th>
                <th scope="col" className="px-5 py-3 text-right font-medium">Overdue</th>
                <th scope="col" className="px-5 py-3 text-right font-medium">Balance</th>
                <th scope="col" className="px-5 py-3 font-medium">
                  <span className="sr-only">Challan</span>
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rows.map((row) => (
                <tr key={row.challanId}>
                  <td className="px-5 py-2.5">
                    <p className="font-medium text-slate-900">{row.studentName}</p>
                    <p className="font-mono text-xs text-slate-500">{row.studentId}</p>
                  </td>
                  <td className="px-5 py-2.5 text-slate-600">
                    {row.gradeName ?? '—'}
                    {row.sectionName === null ? '' : ` ${row.sectionName}`}
                  </td>
                  <td className="px-5 py-2.5 text-slate-600">{periodLabel(row)}</td>
                  <td className="px-5 py-2.5 text-slate-600">{row.dueDate}</td>
                  <td className="px-5 py-2.5 text-right">
                    {row.daysOverdue === 0 ? (
                      <span className="text-slate-500">—</span>
                    ) : (
                      <Badge variant={row.daysOverdue >= 30 ? 'danger' : 'warning'}>
                        {row.daysOverdue}d
                      </Badge>
                    )}
                  </td>
                  <td className="px-5 py-2.5 text-right font-medium text-slate-900">
                    {formatAmount(row.balance)}
                  </td>
                  <td className="px-5 py-2.5 text-right">
                    <Link
                      href={`/dashboard/fees/challans/${row.challanId}`}
                      className="text-sm font-medium text-brand-primary hover:underline"
                    >
                      View
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

function CollectionSection() {
  const now = new Date();
  const defaultFrom = new Date(now.getFullYear(), now.getMonth() - 11, 1)
    .toISOString()
    .slice(0, 10);

  const [fromDate, setFromDate] = useState(defaultFrom);
  const [toDate, setToDate] = useState(now.toISOString().slice(0, 10));
  const [data, setData] = useState<{
    months: CollectionMonth[];
    total: string;
    paymentCount: number;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const query = new URLSearchParams({ fromDate, toDate });

    try {
      setData(
        await schoolFetch<{
          months: CollectionMonth[];
          total: string;
          paymentCount: number;
        }>(`/api/school/fees/reports/collection?${query.toString()}`),
      );
      setError(null);
    } catch (caught) {
      setError(schoolErrorMessage(caught, 'Could not load the collection summary.'));
    }
  }, [fromDate, toDate]);

  useEffect(() => {
    void load();
  }, [load]);

  const peak = Math.max(
    1,
    ...(data?.months ?? []).map((month) => Number(month.collected)),
  );

  return (
    <Card
      header={
        <CardTitle
          title="Collection summary"
          description="What was received each month, by payment date."
        />
      }
      className="p-0"
    >
      <div className="grid gap-4 border-b border-slate-200 px-5 py-4 sm:grid-cols-3">
        <Input
          label="From"
          type="date"
          value={fromDate}
          onChange={(event) => {
            setFromDate(event.target.value);
          }}
        />
        <Input
          label="To"
          type="date"
          value={toDate}
          onChange={(event) => {
            setToDate(event.target.value);
          }}
        />
        <div className="flex items-end">
          <p className="text-sm text-slate-600">
            <span className="font-semibold text-slate-900">
              {formatPkr(data?.total ?? 0)}
            </span>{' '}
            across {data?.paymentCount ?? 0} payment
            {data?.paymentCount === 1 ? '' : 's'}.
          </p>
        </div>
      </div>

      {error !== null ? (
        <p role="alert" className="px-5 py-3 text-sm text-red-700">
          {error}
        </p>
      ) : null}

      {data === null ? (
        <p className="px-5 py-4 text-sm text-slate-500">Loading…</p>
      ) : data.months.length === 0 ? (
        <p className="px-5 py-4 text-sm text-slate-600">
          No payments were recorded in this range.
        </p>
      ) : (
        <table className="w-full text-left text-sm">
          <thead className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-500">
            <tr>
              <th scope="col" className="px-5 py-3 font-medium">Month</th>
              <th scope="col" className="px-5 py-3 font-medium">Share</th>
              <th scope="col" className="px-5 py-3 text-right font-medium">Payments</th>
              <th scope="col" className="px-5 py-3 text-right font-medium">Collected</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {data.months.map((month) => (
              <tr key={`${month.year}-${month.month}`}>
                <td className="px-5 py-2.5 text-slate-900">
                  {MONTH_NAMES[month.month - 1] ?? month.month} {month.year}
                </td>
                <td className="px-5 py-2.5">
                  {/* A bar rather than a chart library: one number per row,
                      compared against the best month in the range. */}
                  <span
                    aria-hidden="true"
                    className="block h-2 rounded-full bg-brand-primary/70"
                    style={{
                      width: `${Math.max((Number(month.collected) / peak) * 100, 2)}%`,
                    }}
                  />
                </td>
                <td className="px-5 py-2.5 text-right text-slate-600">
                  {month.paymentCount}
                </td>
                <td className="px-5 py-2.5 text-right font-medium text-slate-900">
                  {formatAmount(month.collected)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Card>
  );
}

function DefaultersSection({
  grades,
  canSendReminders,
}: {
  grades: readonly GradeOption[];
  canSendReminders: boolean;
}) {
  const [minDays, setMinDays] = useState('30');
  const [gradeId, setGradeId] = useState('');
  const [rows, setRows] = useState<OutstandingRow[] | null>(null);
  const [totalOutstanding, setTotalOutstanding] = useState('0');
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    const query = new URLSearchParams({ minDaysOverdue: minDays || '30' });
    if (gradeId !== '') query.set('gradeId', gradeId);

    try {
      const payload = await schoolFetch<{
        defaulters: OutstandingRow[];
        totalOutstanding: string;
      }>(`/api/school/fees/reports/defaulters?${query.toString()}`);

      setRows(payload.defaulters);
      setTotalOutstanding(payload.totalOutstanding);
      setError(null);
    } catch (caught) {
      setError(schoolErrorMessage(caught, 'Could not load the defaulters list.'));
    }
  }, [minDays, gradeId]);

  useEffect(() => {
    const timer = setTimeout(() => {
      void load();
    }, 250);

    return () => {
      clearTimeout(timer);
    };
  }, [load]);

  const remind = async (challanIds: string[], key: string): Promise<void> => {
    setBusy(key);
    setError(null);
    setNotice(null);

    try {
      const result = await schoolFetch<{ queued: number; noGuardian: number }>(
        '/api/school/fees/reminders',
        { method: 'POST', body: JSON.stringify({ challanIds }) },
      );

      setNotice(
        `${result.queued} reminder${result.queued === 1 ? '' : 's'} queued` +
          (result.noGuardian > 0
            ? `. ${result.noGuardian} had no guardian on file.`
            : '.'),
      );
    } catch (caught) {
      setError(schoolErrorMessage(caught, 'Could not send the reminders.'));
    } finally {
      setBusy(null);
    }
  };

  const withGuardian = (rows ?? []).filter((row) => row.guardianPhone !== null);

  return (
    <Card
      header={
        <CardTitle
          title="Defaulters"
          description="Overdue long enough to chase. Reminders go out over WhatsApp."
          action={
            canSendReminders && withGuardian.length > 0 ? (
              <Button
                size="sm"
                isLoading={busy === 'all'}
                onClick={() => {
                  if (
                    window.confirm(
                      `Send a WhatsApp reminder to ${withGuardian.length} guardian${
                        withGuardian.length === 1 ? '' : 's'
                      }?`,
                    )
                  ) {
                    void remind(
                      withGuardian.map((row) => row.challanId),
                      'all',
                    );
                  }
                }}
              >
                Send all reminders ({withGuardian.length})
              </Button>
            ) : undefined
          }
        />
      }
      className="p-0"
    >
      <div className="grid gap-4 border-b border-slate-200 px-5 py-4 sm:grid-cols-3">
        <Input
          label="Minimum days overdue"
          type="number"
          min={0}
          max={3650}
          value={minDays}
          onChange={(event) => {
            setMinDays(event.target.value);
          }}
        />
        <Select
          label="Grade"
          options={[
            { value: '', label: 'All grades' },
            ...grades.map((grade) => ({ value: grade.id, label: grade.label })),
          ]}
          value={gradeId}
          onChange={(event) => {
            setGradeId(event.target.value);
          }}
        />
        <div className="flex items-end">
          <p className="text-sm text-slate-600">
            <span className="font-semibold text-slate-900">
              {formatPkr(totalOutstanding)}
            </span>{' '}
            across {(rows ?? []).length} challan
            {(rows ?? []).length === 1 ? '' : 's'}.
          </p>
        </div>
      </div>

      {error !== null ? (
        <p role="alert" className="px-5 py-3 text-sm text-red-700">
          {error}
        </p>
      ) : null}

      {notice !== null ? (
        <p className="px-5 py-3 text-sm text-emerald-700">{notice}</p>
      ) : null}

      {rows === null ? (
        <p className="px-5 py-4 text-sm text-slate-500">Loading…</p>
      ) : rows.length === 0 ? (
        <p className="px-5 py-4 text-sm text-slate-600">
          Nobody is more than {minDays || '30'} days overdue. That is worth knowing.
        </p>
      ) : (
        <div className="max-h-96 overflow-auto">
          <table className="w-full text-left text-sm">
            <thead className="sticky top-0 border-b border-slate-200 bg-white text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th scope="col" className="px-5 py-3 font-medium">Student</th>
                <th scope="col" className="px-5 py-3 font-medium">Class</th>
                <th scope="col" className="px-5 py-3 font-medium">Guardian</th>
                <th scope="col" className="px-5 py-3 text-right font-medium">Overdue</th>
                <th scope="col" className="px-5 py-3 text-right font-medium">Balance</th>
                <th scope="col" className="px-5 py-3 font-medium">
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rows.map((row) => (
                <tr key={row.challanId}>
                  <td className="px-5 py-2.5">
                    <Link
                      href={`/dashboard/fees/challans/${row.challanId}`}
                      className="font-medium text-slate-900 hover:underline"
                    >
                      {row.studentName}
                    </Link>
                    <p className="font-mono text-xs text-slate-500">
                      {row.challanNumber}
                    </p>
                  </td>
                  <td className="px-5 py-2.5 text-slate-600">
                    {row.gradeName ?? '—'}
                    {row.sectionName === null ? '' : ` ${row.sectionName}`}
                  </td>
                  <td className="px-5 py-2.5 text-slate-600">
                    {row.guardianName ?? '—'}
                    {row.guardianPhone === null ? null : (
                      <span className="block font-mono text-xs text-slate-500">
                        {row.guardianPhone}
                      </span>
                    )}
                  </td>
                  <td className="px-5 py-2.5 text-right">
                    <Badge variant="danger">{row.daysOverdue}d</Badge>
                  </td>
                  <td className="px-5 py-2.5 text-right font-medium text-slate-900">
                    {formatAmount(row.balance)}
                  </td>
                  <td className="px-5 py-2.5 text-right">
                    {canSendReminders && row.guardianPhone !== null ? (
                      <Button
                        size="sm"
                        variant="secondary"
                        isLoading={busy === row.challanId}
                        onClick={() => {
                          void remind([row.challanId], row.challanId);
                        }}
                      >
                        Send reminder
                      </Button>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}
