'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';

import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card, CardTitle } from '@/components/ui/Card';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeaderCell,
  TableRow,
} from '@/components/ui/Table';
import { MONTH_NAMES } from '@/db/schema/academic-years';
import { formatAmount, formatPkr } from '@/lib/money';
import { schoolErrorMessage, schoolFetch } from '@/lib/school-client';

/**
 * The three questions a bursar asks, on one screen.
 *
 *   1. Outstanding — who owes what, right now.
 *   2. Collection — what came in, month by month.
 *   3. Defaulters — who has been overdue long enough to chase, with a
 *      one-click emailed reminder.
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
      <div className="grid gap-4 border-b border-line px-5 py-4 sm:grid-cols-2 lg:grid-cols-3">
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
          <p className="text-sm text-ink-muted">
            <span className="font-semibold text-ink">{formatPkr(total)}</span>{' '}
            outstanding across {(rows ?? []).length} challan
            {(rows ?? []).length === 1 ? '' : 's'}.
          </p>
        </div>
      </div>

      {error !== null ? (
        <p role="alert" className="px-5 py-3 text-sm text-status-danger-ink">
          {error}
        </p>
      ) : null}

      {rows === null ? (
        <p className="px-5 py-4 text-sm text-ink-muted">Loading…</p>
      ) : rows.length === 0 ? (
        <p className="px-5 py-4 text-sm text-ink-muted">
          Nothing is outstanding for these filters.
        </p>
      ) : (
        <div className="max-h-96 overflow-auto">
          <Table caption="Collection summary" className="rounded-none border-0">
            <TableHead>
              <TableRow>
                <TableHeaderCell>Student</TableHeaderCell>
                <TableHeaderCell>Class</TableHeaderCell>
                <TableHeaderCell>Period</TableHeaderCell>
                <TableHeaderCell>Due</TableHeaderCell>
                <TableHeaderCell align="numeric">Overdue</TableHeaderCell>
                <TableHeaderCell align="numeric">Balance</TableHeaderCell>
                <TableHeaderCell>
                  <span className="sr-only">Challan</span>
                </TableHeaderCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {rows.map((row) => (
                <TableRow key={row.challanId}>
                  <TableCell>
                    <p className="font-medium text-ink">{row.studentName}</p>
                    <p className="font-mono text-xs text-ink-muted">{row.studentId}</p>
                  </TableCell>
                  <TableCell muted>
                    {row.gradeName ?? '—'}
                    {row.sectionName === null ? '' : ` ${row.sectionName}`}
                  </TableCell>
                  <TableCell muted>{periodLabel(row)}</TableCell>
                  <TableCell muted>{row.dueDate}</TableCell>
                  <TableCell align="numeric">
                    {row.daysOverdue === 0 ? (
                      <span className="text-ink-muted">—</span>
                    ) : (
                      <Badge variant={row.daysOverdue >= 30 ? 'danger' : 'warning'}>
                        {row.daysOverdue}d
                      </Badge>
                    )}
                  </TableCell>
                  <TableCell rowHeader align="numeric">
                    {formatAmount(row.balance)}
                  </TableCell>
                  <TableCell align="numeric">
                    <Link
                      href={`/dashboard/fees/challans/${row.challanId}`}
                      className="text-sm font-medium text-brand-primary hover:underline"
                    >
                      View
                    </Link>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
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
      <div className="grid gap-4 border-b border-line px-5 py-4 sm:grid-cols-3">
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
          <p className="text-sm text-ink-muted">
            <span className="font-semibold text-ink">
              {formatPkr(data?.total ?? 0)}
            </span>{' '}
            across {data?.paymentCount ?? 0} payment
            {data?.paymentCount === 1 ? '' : 's'}.
          </p>
        </div>
      </div>

      {error !== null ? (
        <p role="alert" className="px-5 py-3 text-sm text-status-danger-ink">
          {error}
        </p>
      ) : null}

      {data === null ? (
        <p className="px-5 py-4 text-sm text-ink-muted">Loading…</p>
      ) : data.months.length === 0 ? (
        <p className="px-5 py-4 text-sm text-ink-muted">
          No payments were recorded in this range.
        </p>
      ) : (
        <Table caption="Outstanding by age" className="rounded-none border-0">
          <TableHead>
            <TableRow>
              <TableHeaderCell>Month</TableHeaderCell>
              <TableHeaderCell>Share</TableHeaderCell>
              <TableHeaderCell align="numeric">Payments</TableHeaderCell>
              <TableHeaderCell align="numeric">Collected</TableHeaderCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {data.months.map((month) => (
              <TableRow key={`${month.year}-${month.month}`}>
                <TableCell>
                  {MONTH_NAMES[month.month - 1] ?? month.month} {month.year}
                </TableCell>
                <TableCell>
                  {/* A bar rather than a chart library: one number per row,
                      compared against the best month in the range. */}
                  <span
                    aria-hidden="true"
                    className="block h-2 rounded-full bg-brand-primary/70"
                    style={{
                      width: `${Math.max((Number(month.collected) / peak) * 100, 2)}%`,
                    }}
                  />
                </TableCell>
                <TableCell align="numeric" muted>
                  {month.paymentCount}
                </TableCell>
                <TableCell rowHeader align="numeric">
                  {formatAmount(month.collected)}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
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
          description="Overdue long enough to chase. Reminders go out by email."
          action={
            canSendReminders && withGuardian.length > 0 ? (
              <Button
                size="sm"
                isLoading={busy === 'all'}
                onClick={() => {
                  if (
                    window.confirm(
                      `Email a reminder to ${withGuardian.length} guardian${
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
      <div className="grid gap-4 border-b border-line px-5 py-4 sm:grid-cols-3">
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
          <p className="text-sm text-ink-muted">
            <span className="font-semibold text-ink">
              {formatPkr(totalOutstanding)}
            </span>{' '}
            across {(rows ?? []).length} challan
            {(rows ?? []).length === 1 ? '' : 's'}.
          </p>
        </div>
      </div>

      {error !== null ? (
        <p role="alert" className="px-5 py-3 text-sm text-status-danger-ink">
          {error}
        </p>
      ) : null}

      {notice !== null ? (
        <p className="px-5 py-3 text-sm text-status-success-ink">{notice}</p>
      ) : null}

      {rows === null ? (
        <p className="px-5 py-4 text-sm text-ink-muted">Loading…</p>
      ) : rows.length === 0 ? (
        <p className="px-5 py-4 text-sm text-ink-muted">
          Nobody is more than {minDays || '30'} days overdue. That is worth knowing.
        </p>
      ) : (
        <div className="max-h-96 overflow-auto">
          <Table caption="Defaulters" className="rounded-none border-0">
            <TableHead>
              <TableRow>
                <TableHeaderCell>Student</TableHeaderCell>
                <TableHeaderCell>Class</TableHeaderCell>
                <TableHeaderCell>Guardian</TableHeaderCell>
                <TableHeaderCell align="numeric">Overdue</TableHeaderCell>
                <TableHeaderCell align="numeric">Balance</TableHeaderCell>
                <TableHeaderCell>
                  <span className="sr-only">Actions</span>
                </TableHeaderCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {rows.map((row) => (
                <TableRow key={row.challanId}>
                  <TableCell>
                    <Link
                      href={`/dashboard/fees/challans/${row.challanId}`}
                      className="font-medium text-ink hover:underline"
                    >
                      {row.studentName}
                    </Link>
                    <p className="font-mono text-xs text-ink-muted">
                      {row.challanNumber}
                    </p>
                  </TableCell>
                  <TableCell muted>
                    {row.gradeName ?? '—'}
                    {row.sectionName === null ? '' : ` ${row.sectionName}`}
                  </TableCell>
                  <TableCell muted>
                    {row.guardianName ?? '—'}
                    {row.guardianPhone === null ? null : (
                      <span className="block font-mono text-xs text-ink-muted">
                        {row.guardianPhone}
                      </span>
                    )}
                  </TableCell>
                  <TableCell align="numeric">
                    <Badge variant="danger">{row.daysOverdue}d</Badge>
                  </TableCell>
                  <TableCell rowHeader align="numeric">
                    {formatAmount(row.balance)}
                  </TableCell>
                  <TableCell align="numeric">
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
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </Card>
  );
}
