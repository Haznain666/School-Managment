'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';

import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card, CardTitle } from '@/components/ui/Card';
import { DataTable, type DataTableColumn } from '@/components/ui/DataTable';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { MONTH_NAMES } from '@/db/schema/academic-years';
import { formatAmount, formatPkr } from '@/lib/money';
import { formatPhoneForDisplay } from '@/lib/phone-formats';
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
  const [pending, setPending] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setPending(true);
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
    } finally {
      setPending(false);
    }
  }, [gradeId, billingMonth]);

  useEffect(() => {
    void load();
  }, [load]);

  const total = (rows ?? []).reduce((sum, row) => sum + Number(row.balance), 0);

  const outstandingColumns: Array<DataTableColumn<OutstandingRow>> = [
    {
      id: 'student',
      header: 'Student',
      sortValue: (row) => row.studentName,
      searchValue: (row) => `${row.studentName} ${row.studentId} ${row.challanNumber}`,
      cell: (row) => (
        <>
          <p className="font-medium text-ink">{row.studentName}</p>
          <p className="font-mono text-xs text-ink-muted">{row.studentId}</p>
        </>
      ),
    },
    {
      id: 'class',
      header: 'Class',
      muted: true,
      sortValue: (row) => `${row.gradeName ?? ''} ${row.sectionName ?? ''}`,
      cell: (row) =>
        `${row.gradeName ?? '—'}${row.sectionName === null ? '' : ` ${row.sectionName}`}`,
    },
    {
      id: 'period',
      header: 'Period',
      muted: true,
      sortValue: (row) =>
        row.billingYear === null || row.billingMonth === null
          ? null
          : row.billingYear * 100 + row.billingMonth,
      cell: (row) => periodLabel(row),
    },
    {
      id: 'due',
      header: 'Due',
      kind: 'date',
      muted: true,
      sortValue: (row) => row.dueDate,
      cell: (row) => row.dueDate,
    },
    {
      id: 'overdue',
      header: 'Overdue',
      kind: 'number',
      sortValue: (row) => row.daysOverdue,
      cell: (row) =>
        row.daysOverdue === 0 ? (
          <span className="text-ink-muted">—</span>
        ) : (
          <Badge variant={row.daysOverdue >= 30 ? 'danger' : 'warning'}>
            {row.daysOverdue}d
          </Badge>
        ),
    },
    {
      id: 'balance',
      header: 'Balance',
      kind: 'money',
      rowHeader: true,
      sortValue: (row) => Number(row.balance),
      cell: (row) => formatAmount(row.balance),
    },
    {
      id: 'link',
      header: <span className="sr-only">Voucher</span>,
      align: 'numeric',
      cell: (row) => (
        <Link
          href={`/dashboard/fees/challans/${row.challanId}`}
          className="text-sm font-medium text-brand-primary hover:underline"
        >
          View
        </Link>
      ),
    },
  ];

  return (
    <Card
      header={
        <CardTitle
          title="Outstanding fees"
          description="Unpaid and partly-paid vouchers, most overdue first."
        />
      }
      className="p-0"
    >
      {error !== null ? (
        <p role="alert" className="px-5 py-3 text-sm text-status-danger-ink">
          {error}
        </p>
      ) : null}

      <div className="p-5">
        <DataTable
          caption="Outstanding fees"
          maxHeight="24rem"
          columns={outstandingColumns}
          rows={rows ?? []}
          getRowKey={(row) => row.challanId}
          pending={pending}
          defaultSort={{ columnId: 'overdue', direction: 'desc' }}
          search={{ placeholder: 'Student, ID or voucher number' }}
          filters={[
            {
              id: 'age',
              label: 'Age',
              allLabel: 'Any age',
              options: [
                { value: 'due', label: 'Not yet overdue' },
                { value: 'recent', label: 'Under 30 days' },
                { value: 'old', label: '30 days or more' },
              ],
              rowValue: (row) =>
                row.daysOverdue === 0 ? 'due' : row.daysOverdue >= 30 ? 'old' : 'recent',
            },
          ]}
          extraFilters={
            <>
              <div className="w-full sm:w-52">
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
              </div>
              <div className="w-full sm:w-44">
                <Select
                  label="Billing month"
                  options={MONTH_OPTIONS}
                  value={billingMonth}
                  onChange={(event) => {
                    setBillingMonth(event.target.value);
                  }}
                />
              </div>
            </>
          }
          actions={
            <p className="text-sm text-ink-muted">
              <span className="font-semibold text-ink">{formatPkr(total)}</span>{' '}
              outstanding across {(rows ?? []).length} challan
              {(rows ?? []).length === 1 ? '' : 's'}.
            </p>
          }
          itemNoun={{ singular: 'voucher', plural: 'vouchers' }}
          emptyTitle="Nothing is outstanding"
          emptyDescription="Every voucher raised has been settled. That is worth knowing."
          noResultTitle="Nothing outstanding for these filters"
          noResultDescription="Widen the grade or the billing month to see more."
        />
      </div>
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
  const [pending, setPending] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setPending(true);
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
    } finally {
      setPending(false);
    }
  }, [fromDate, toDate]);

  useEffect(() => {
    void load();
  }, [load]);

  const peak = Math.max(
    1,
    ...(data?.months ?? []).map((month) => Number(month.collected)),
  );

  const collectionColumns: Array<DataTableColumn<CollectionMonth>> = [
    {
      id: 'month',
      header: 'Month',
      // Ordered on year-and-month, never on the label: "April" before
      // "January" is what sorting a month name as text gives you.
      sortValue: (month) => month.year * 100 + month.month,
      cell: (month) => `${MONTH_NAMES[month.month - 1] ?? month.month} ${month.year}`,
    },
    {
      id: 'share',
      header: 'Share',
      cell: (month) => (
        /* A bar rather than a chart library: one number per row, compared
           against the best month in the range. */
        <span
          aria-hidden="true"
          className="block h-2 rounded-full bg-brand-primary/70"
          style={{ width: `${Math.max((Number(month.collected) / peak) * 100, 2)}%` }}
        />
      ),
    },
    {
      id: 'payments',
      header: 'Payments',
      kind: 'number',
      muted: true,
      sortValue: (month) => month.paymentCount,
      cell: (month) => month.paymentCount,
    },
    {
      id: 'collected',
      header: 'Collected',
      kind: 'money',
      rowHeader: true,
      sortValue: (month) => Number(month.collected),
      cell: (month) => formatAmount(month.collected),
    },
  ];

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
      {error !== null ? (
        <p role="alert" className="px-5 py-3 text-sm text-status-danger-ink">
          {error}
        </p>
      ) : null}

      <div className="p-5">
        <DataTable
          caption="Collection summary"
          columns={collectionColumns}
          rows={data?.months ?? []}
          getRowKey={(month) => `${month.year}-${month.month}`}
          pending={pending}
          defaultSort={{ columnId: 'month', direction: 'desc' }}
          extraFilters={
            <>
              <div className="w-full sm:w-44">
                <Input
                  label="From"
                  type="date"
                  value={fromDate}
                  onChange={(event) => {
                    setFromDate(event.target.value);
                  }}
                />
              </div>
              <div className="w-full sm:w-44">
                <Input
                  label="To"
                  type="date"
                  value={toDate}
                  onChange={(event) => {
                    setToDate(event.target.value);
                  }}
                />
              </div>
            </>
          }
          actions={
            <p className="text-sm text-ink-muted">
              <span className="font-semibold text-ink">{formatPkr(data?.total ?? 0)}</span>{' '}
              across {data?.paymentCount ?? 0} payment
              {data?.paymentCount === 1 ? '' : 's'}.
            </p>
          }
          itemNoun={{ singular: 'month', plural: 'months' }}
          emptyTitle="No payments in this range"
          emptyDescription="Choose a wider window and the months will appear."
        />
      </div>
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
  const [pending, setPending] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    setPending(true);
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
    } finally {
      setPending(false);
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

  const defaulterColumns: Array<DataTableColumn<OutstandingRow>> = [
    {
      id: 'student',
      header: 'Student',
      sortValue: (row) => row.studentName,
      searchValue: (row) =>
        `${row.studentName} ${row.challanNumber} ${row.guardianName ?? ''}`,
      cell: (row) => (
        <>
          <Link
            href={`/dashboard/fees/challans/${row.challanId}`}
            className="font-medium text-ink hover:underline"
          >
            {row.studentName}
          </Link>
          <p className="font-mono text-xs text-ink-muted">{row.challanNumber}</p>
        </>
      ),
    },
    {
      id: 'class',
      header: 'Class',
      muted: true,
      sortValue: (row) => `${row.gradeName ?? ''} ${row.sectionName ?? ''}`,
      cell: (row) =>
        `${row.gradeName ?? '—'}${row.sectionName === null ? '' : ` ${row.sectionName}`}`,
    },
    {
      id: 'guardian',
      header: 'Guardian',
      muted: true,
      sortValue: (row) => row.guardianName,
      cell: (row) => (
        <>
          {row.guardianName ?? '—'}
          {row.guardianPhone === null ? null : (
            <span className="block font-mono text-xs text-ink-muted">
              {formatPhoneForDisplay(row.guardianPhone)}
            </span>
          )}
        </>
      ),
    },
    {
      id: 'overdue',
      header: 'Overdue',
      kind: 'number',
      sortValue: (row) => row.daysOverdue,
      cell: (row) => <Badge variant="danger">{row.daysOverdue}d</Badge>,
    },
    {
      id: 'balance',
      header: 'Balance',
      kind: 'money',
      rowHeader: true,
      sortValue: (row) => Number(row.balance),
      cell: (row) => formatAmount(row.balance),
    },
    {
      id: 'actions',
      header: <span className="sr-only">Actions</span>,
      align: 'numeric',
      cell: (row) =>
        canSendReminders && row.guardianPhone !== null ? (
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
        ) : null,
    },
  ];

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
      {error !== null ? (
        <p role="alert" className="px-5 py-3 text-sm text-status-danger-ink">
          {error}
        </p>
      ) : null}

      {notice !== null ? (
        <p className="px-5 py-3 text-sm text-status-success-ink">{notice}</p>
      ) : null}

      <div className="p-5">
        <DataTable
          caption="Defaulters"
          maxHeight="24rem"
          columns={defaulterColumns}
          rows={rows ?? []}
          getRowKey={(row) => row.challanId}
          pending={pending}
          defaultSort={{ columnId: 'overdue', direction: 'desc' }}
          search={{ placeholder: 'Student, guardian or voucher number' }}
          filters={[
            {
              id: 'reachable',
              label: 'Contact',
              allLabel: 'Everyone',
              options: [
                { value: 'yes', label: 'Guardian on file' },
                { value: 'no', label: 'No guardian on file' },
              ],
              rowValue: (row) => (row.guardianPhone === null ? 'no' : 'yes'),
            },
          ]}
          extraFilters={
            <>
              <div className="w-full sm:w-44">
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
              </div>
              <div className="w-full sm:w-52">
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
              </div>
            </>
          }
          actions={
            <p className="text-sm text-ink-muted">
              <span className="font-semibold text-ink">{formatPkr(totalOutstanding)}</span>{' '}
              across {(rows ?? []).length} challan
              {(rows ?? []).length === 1 ? '' : 's'}.
            </p>
          }
          itemNoun={{ singular: 'defaulter', plural: 'defaulters' }}
          emptyTitle={`Nobody is more than ${minDays || '30'} days overdue`}
          emptyDescription="That is worth knowing."
          noResultTitle="No defaulters match those filters"
          noResultDescription="Widen the grade, the age or the search."
        />
      </div>
    </Card>
  );
}
