'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';

import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card, CardTitle } from '@/components/ui/Card';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { MONTH_NAMES } from '@/db/schema/academic-years';
import { formatPkr } from '@/lib/money';
import { schoolErrorMessage, schoolFetch } from '@/lib/school-client';

/**
 * The three reports a school actually runs: who owes, how well a month
 * collected, and who to chase.
 *
 * Defaulters carries the action, not just the list — a report you have to
 * re-key into WhatsApp is a report nobody runs twice.
 */

export interface AcademicYearOption {
  id: string;
  name: string;
  isActive: boolean;
}

interface OutstandingRow {
  id: string;
  challanNumber: string;
  studentName: string;
  studentId: string;
  gradeName: string;
  sectionName: string;
  dueDate: string;
  totalPaise: number;
  paidPaise: number;
  balancePaise: number;
  daysOverdue: number;
  guardianPhone: string | null;
}

interface CollectionPeriod {
  billingMonth: number;
  billingYear: number;
  billedPaise: number;
  collectedPaise: number;
  outstandingPaise: number;
  collectionRate: number;
}

type ReportTab = 'outstanding' | 'collection' | 'defaulters';

const TABS: ReadonlyArray<{ id: ReportTab; label: string }> = [
  { id: 'outstanding', label: 'Outstanding fees' },
  { id: 'collection', label: 'Collection summary' },
  { id: 'defaulters', label: 'Defaulters' },
];

export function FeeReports({
  academicYears,
  canManage,
}: {
  academicYears: readonly AcademicYearOption[];
  canManage: boolean;
}) {
  const activeYearId =
    academicYears.find((year) => year.isActive)?.id ?? academicYears[0]?.id ?? '';

  const [tab, setTab] = useState<ReportTab>('outstanding');
  const [academicYearId, setAcademicYearId] = useState(activeYearId);
  const [minDaysOverdue, setMinDaysOverdue] = useState('30');

  const [outstanding, setOutstanding] = useState<OutstandingRow[] | null>(null);
  const [periods, setPeriods] = useState<CollectionPeriod[] | null>(null);
  const [defaulters, setDefaulters] = useState<OutstandingRow[] | null>(null);

  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);

    try {
      if (tab === 'outstanding') {
        const query = new URLSearchParams(
          academicYearId === '' ? {} : { academicYearId },
        );
        const payload = await schoolFetch<{ rows: OutstandingRow[] }>(
          `/api/school/fees/reports/outstanding?${query.toString()}`,
        );
        setOutstanding(payload.rows);
      } else if (tab === 'collection') {
        const query = new URLSearchParams(
          academicYearId === '' ? {} : { academicYearId },
        );
        const payload = await schoolFetch<{ periods: CollectionPeriod[] }>(
          `/api/school/fees/reports/collection?${query.toString()}`,
        );
        setPeriods(payload.periods);
      } else {
        const query = new URLSearchParams({ minDaysOverdue });
        const payload = await schoolFetch<{ rows: OutstandingRow[] }>(
          `/api/school/fees/reports/defaulters?${query.toString()}`,
        );
        setDefaulters(payload.rows);
      }
    } catch (caught) {
      setError(schoolErrorMessage(caught, 'Could not load the report.'));
    }
  }, [tab, academicYearId, minDaysOverdue]);

  useEffect(() => {
    void load();
  }, [load]);

  const remind = async (challanIds: string[], label: string): Promise<void> => {
    setBusy(label);
    setError(null);
    setNotice(null);

    try {
      const result = await schoolFetch<{
        queued: number;
        failed: number;
        skippedNoPhone: number;
      }>('/api/school/fees/reminders', {
        method: 'POST',
        body: JSON.stringify({ challanIds }),
      });

      const parts = [`${result.queued} reminder${result.queued === 1 ? '' : 's'} sent`];
      if (result.failed > 0) parts.push(`${result.failed} could not be delivered`);
      if (result.skippedNoPhone > 0) {
        parts.push(`${result.skippedNoPhone} had no guardian number on file`);
      }

      setNotice(parts.join(' · '));
    } catch (caught) {
      setError(schoolErrorMessage(caught, 'Could not send reminders.'));
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="space-y-4">
      <div role="tablist" aria-label="Reports" className="flex flex-wrap gap-2">
        {TABS.map((entry) => (
          <button
            key={entry.id}
            type="button"
            role="tab"
            aria-selected={tab === entry.id}
            onClick={() => {
              setTab(entry.id);
              setNotice(null);
            }}
            className={
              tab === entry.id
                ? 'rounded-full bg-brand-primary px-4 py-1.5 text-sm font-medium text-white'
                : 'rounded-full bg-slate-100 px-4 py-1.5 text-sm font-medium text-slate-600 hover:bg-slate-200'
            }
          >
            {entry.label}
          </button>
        ))}
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        {tab === 'defaulters' ? (
          <Input
            label="Overdue by at least (days)"
            type="number"
            min={0}
            value={minDaysOverdue}
            hint="Below 30 days a family is usually just late."
            onChange={(event) => {
              setMinDaysOverdue(event.target.value);
            }}
          />
        ) : (
          <Select
            label="Academic year"
            options={academicYears.map((year) => ({
              value: year.id,
              label: year.isActive ? `${year.name} (active)` : year.name,
            }))}
            value={academicYearId}
            onChange={(event) => {
              setAcademicYearId(event.target.value);
            }}
          />
        )}

        <div className="flex items-end">
          <Button variant="secondary" disabled title="Coming in a later sprint">
            Export CSV
          </Button>
        </div>
      </div>

      {error !== null ? (
        <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </p>
      ) : null}

      {notice !== null ? (
        <p className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
          {notice}
        </p>
      ) : null}

      {tab === 'outstanding' ? (
        <OutstandingTable rows={outstanding} title="Outstanding fees" />
      ) : null}

      {tab === 'collection' ? <CollectionTable periods={periods} /> : null}

      {tab === 'defaulters' ? (
        <>
          {canManage && defaulters !== null && defaulters.length > 0 ? (
            <Button
              isLoading={busy === 'all'}
              onClick={() => {
                void remind(
                  defaulters.map((row) => row.id),
                  'all',
                );
              }}
            >
              Send all {defaulters.length} reminders
            </Button>
          ) : null}

          <OutstandingTable
            rows={defaulters}
            title="Defaulters"
            showPhone
            onRemind={
              canManage
                ? (row) => {
                    void remind([row.id], row.id);
                  }
                : undefined
            }
            busyId={busy}
          />
        </>
      ) : null}
    </div>
  );
}

function OutstandingTable({
  rows,
  title,
  showPhone = false,
  onRemind,
  busyId,
}: {
  rows: OutstandingRow[] | null;
  title: string;
  showPhone?: boolean;
  onRemind?: ((row: OutstandingRow) => void) | undefined;
  busyId?: string | null;
}) {
  if (rows === null) {
    return (
      <Card>
        <p className="text-sm text-slate-500">Loading…</p>
      </Card>
    );
  }

  if (rows.length === 0) {
    return (
      <Card>
        <p className="text-sm text-slate-600">Nothing outstanding. </p>
      </Card>
    );
  }

  const total = rows.reduce((sum, row) => sum + row.balancePaise, 0);

  return (
    <Card
      className="p-0"
      header={
        <CardTitle
          title={title}
          description={`${rows.length} challan${rows.length === 1 ? '' : 's'} · PKR ${formatPkr(total)} outstanding`}
        />
      }
    >
      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-500">
            <tr>
              <th scope="col" className="px-4 py-3 font-medium">Student</th>
              <th scope="col" className="px-4 py-3 font-medium">Class</th>
              {showPhone ? (
                <th scope="col" className="px-4 py-3 font-medium">Guardian</th>
              ) : null}
              <th scope="col" className="px-4 py-3 font-medium">Challan #</th>
              <th scope="col" className="px-4 py-3 font-medium">Due</th>
              <th scope="col" className="px-4 py-3 font-medium">Balance</th>
              <th scope="col" className="px-4 py-3 font-medium">Overdue</th>
              <th scope="col" className="px-4 py-3 font-medium">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {rows.map((row) => (
              <tr key={row.id}>
                <td className="px-4 py-3">
                  <span className="font-medium text-slate-900">{row.studentName}</span>
                  <span className="block font-mono text-xs text-slate-500">
                    {row.studentId}
                  </span>
                </td>
                <td className="px-4 py-3 text-slate-600">
                  {row.gradeName} · {row.sectionName}
                </td>
                {showPhone ? (
                  <td className="px-4 py-3 font-mono text-xs text-slate-600">
                    {row.guardianPhone ?? '—'}
                  </td>
                ) : null}
                <td className="px-4 py-3 font-mono text-xs text-slate-600">
                  {row.challanNumber}
                </td>
                <td className="px-4 py-3 text-slate-600">{row.dueDate}</td>
                <td className="px-4 py-3 font-medium text-slate-900">
                  {formatPkr(row.balancePaise)}
                </td>
                <td className="px-4 py-3">
                  {row.daysOverdue > 0 ? (
                    <Badge variant={row.daysOverdue > 60 ? 'danger' : 'warning'}>
                      {row.daysOverdue} days
                    </Badge>
                  ) : (
                    <span className="text-xs text-slate-400">Not yet due</span>
                  )}
                </td>
                <td className="px-4 py-3">
                  <div className="flex gap-3">
                    <Link
                      href={`/dashboard/fees/challans/${row.id}`}
                      className="text-sm font-medium text-brand-primary hover:underline"
                    >
                      View
                    </Link>
                    {onRemind !== undefined && row.guardianPhone !== null ? (
                      <Button
                        size="sm"
                        variant="ghost"
                        isLoading={busyId === row.id}
                        onClick={() => {
                          onRemind(row);
                        }}
                      >
                        Remind
                      </Button>
                    ) : null}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

function CollectionTable({ periods }: { periods: CollectionPeriod[] | null }) {
  if (periods === null) {
    return (
      <Card>
        <p className="text-sm text-slate-500">Loading…</p>
      </Card>
    );
  }

  if (periods.length === 0) {
    return (
      <Card>
        <p className="text-sm text-slate-600">No challans have been raised yet.</p>
      </Card>
    );
  }

  const billed = periods.reduce((sum, period) => sum + period.billedPaise, 0);
  const collected = periods.reduce((sum, period) => sum + period.collectedPaise, 0);
  const rate = billed === 0 ? 0 : Math.round((collected / billed) * 1000) / 10;

  return (
    <>
      <div className="grid gap-4 sm:grid-cols-3">
        <Card>
          <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
            Total billed
          </p>
          <p className="mt-2 text-2xl font-bold text-slate-900">PKR {formatPkr(billed)}</p>
        </Card>
        <Card>
          <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
            Total collected
          </p>
          <p className="mt-2 text-2xl font-bold text-slate-900">
            PKR {formatPkr(collected)}
          </p>
        </Card>
        <Card>
          <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
            Collection rate
          </p>
          <p className="mt-2 text-2xl font-bold text-slate-900">{rate}%</p>
        </Card>
      </div>

      <Card className="p-0">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th scope="col" className="px-4 py-3 font-medium">Month</th>
                <th scope="col" className="px-4 py-3 font-medium">Billed</th>
                <th scope="col" className="px-4 py-3 font-medium">Collected</th>
                <th scope="col" className="px-4 py-3 font-medium">Outstanding</th>
                <th scope="col" className="px-4 py-3 font-medium">Rate</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {periods.map((period) => (
                <tr key={`${period.billingYear}-${period.billingMonth}`}>
                  <td className="px-4 py-3 font-medium text-slate-900">
                    {period.billingMonth === 0
                      ? 'One-off'
                      : `${MONTH_NAMES[period.billingMonth - 1] ?? ''} ${period.billingYear}`}
                  </td>
                  <td className="px-4 py-3 text-slate-600">
                    {formatPkr(period.billedPaise)}
                  </td>
                  <td className="px-4 py-3 text-slate-600">
                    {formatPkr(period.collectedPaise)}
                  </td>
                  <td className="px-4 py-3 text-slate-600">
                    {formatPkr(period.outstandingPaise)}
                  </td>
                  <td className="px-4 py-3">
                    <Badge
                      variant={
                        period.collectionRate >= 90
                          ? 'success'
                          : period.collectionRate >= 70
                            ? 'warning'
                            : 'danger'
                      }
                    >
                      {period.collectionRate}%
                    </Badge>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </>
  );
}
