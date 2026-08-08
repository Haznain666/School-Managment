'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

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
import { MAX_PRINTABLE_CHALLANS, challanPrintHref } from '@/lib/challan-print';
import { formatAmount, toPaise } from '@/lib/money';
import { schoolErrorMessage, schoolFetch } from '@/lib/school-client';

/**
 * The challan register.
 *
 * Filters narrow each other the way the school's own hierarchy does: choosing a
 * grade loads its sections. A section id from another grade would return
 * nothing, and offering it would look like a bug rather than an empty result.
 *
 * ── Selection, and why it outlives pagination but not filtering ───────────
 * Checkboxes feed the bulk print route, which takes explicit ids. The set
 * survives paging, because the cap is 200 and a page is 20 — a batch worth
 * printing spans pages by definition. It is cleared whenever a filter changes,
 * because the rows the user was choosing from are gone and carrying an
 * invisible selection into a new result set is how someone prints four hundred
 * vouchers they did not mean to.
 */

interface ChallanRow {
  id: string;
  challanNumber: string;
  studentName: string;
  studentId: string;
  gradeName: string | null;
  sectionName: string | null;
  billingMonth: number | null;
  billingYear: number | null;
  dueDate: string;
  totalAmount: string;
  paidAmount: string;
  status: ChallanStatus;
}

interface ChallansResponse {
  challans: ChallanRow[];
  total: number;
  page: number;
  limit: number;
  totals: { billed: string; paid: string; balance: string };
}

export interface AcademicYearOption {
  id: string;
  name: string;
  isActive: boolean;
}

export interface GradeOption {
  id: string;
  label: string;
}

export interface ChallanTableProps {
  academicYears: readonly AcademicYearOption[];
  grades: readonly GradeOption[];
  canGenerate: boolean;
}

interface SectionOption {
  id: string;
  name: string;
}

const STATUS_VARIANTS: Record<ChallanStatus, BadgeVariant> = {
  unpaid: 'warning',
  partial: 'warning',
  paid: 'success',
  cancelled: 'neutral',
  waived: 'neutral',
};

const STATUS_OPTIONS = [
  { value: '', label: 'All statuses' },
  ...CHALLAN_STATUSES.map((value) => ({
    value,
    label: CHALLAN_STATUS_LABELS[value],
  })),
];

const MONTH_OPTIONS = [
  { value: '', label: 'All months' },
  ...MONTH_NAMES.map((name, index) => ({ value: String(index + 1), label: name })),
];

const PAGE_SIZE = 20;

function billingLabel(row: ChallanRow): string {
  if (row.billingMonth === null || row.billingYear === null) return 'One-off';
  return `${MONTH_NAMES[row.billingMonth - 1] ?? row.billingMonth} ${row.billingYear}`;
}

export function ChallanTable({
  academicYears,
  grades,
  canGenerate,
}: ChallanTableProps) {
  const now = new Date();

  const [academicYearId, setAcademicYearId] = useState(
    academicYears.find((year) => year.isActive)?.id ?? academicYears[0]?.id ?? '',
  );
  const [billingMonth, setBillingMonth] = useState(String(now.getMonth() + 1));
  const [billingYear, setBillingYear] = useState(String(now.getFullYear()));
  const [gradeId, setGradeId] = useState('');
  const [sectionId, setSectionId] = useState('');
  const [status, setStatus] = useState('');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);

  const [sections, setSections] = useState<SectionOption[]>([]);
  const [data, setData] = useState<ChallansResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Insertion-ordered, so the print job comes out in the order they were
  // ticked rather than in whatever order a Set happens to iterate.
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const selected = useMemo(() => new Set(selectedIds), [selectedIds]);

  // Sections belong to a grade *and* a year, so both must be chosen first.
  useEffect(() => {
    if (gradeId === '' || academicYearId === '') {
      setSections([]);
      setSectionId('');
      return;
    }

    const query = new URLSearchParams({ gradeId, academicYearId });

    schoolFetch<{ sections: SectionOption[] }>(`/api/school/sections?${query.toString()}`)
      .then((payload) => {
        setSections(payload.sections);
      })
      .catch(() => {
        setSections([]);
      });
  }, [gradeId, academicYearId]);

  const load = useCallback(async () => {
    const query = new URLSearchParams({
      page: String(page),
      limit: String(PAGE_SIZE),
    });

    if (academicYearId !== '') query.set('academicYearId', academicYearId);
    if (billingMonth !== '') query.set('billingMonth', billingMonth);
    if (billingYear !== '') query.set('billingYear', billingYear);
    if (gradeId !== '') query.set('gradeId', gradeId);
    if (sectionId !== '') query.set('sectionId', sectionId);
    if (status !== '') query.set('status', status);
    if (search.trim() !== '') query.set('search', search.trim());

    try {
      setData(await schoolFetch<ChallansResponse>(`/api/school/fees/challans?${query}`));
      setError(null);
    } catch (caught) {
      setError(schoolErrorMessage(caught, 'Could not load the challans.'));
    }
  }, [academicYearId, billingMonth, billingYear, gradeId, sectionId, status, search, page]);

  useEffect(() => {
    const timer = setTimeout(() => {
      void load();
    }, 250);

    return () => {
      clearTimeout(timer);
    };
  }, [load]);

  // Any filter change invalidates the page number: page 4 of the old result set
  // is rarely page 4 of the new one. It invalidates the selection for the same
  // reason — see the note at the top of this file.
  const onFilterChange = (apply: () => void): void => {
    apply();
    setPage(1);
    setSelectedIds([]);
  };

  const totalPages = data === null ? 1 : Math.max(Math.ceil(data.total / PAGE_SIZE), 1);

  const rows = data?.challans ?? [];
  const pageIds = rows.map((row) => row.id);
  const selectedOnPage = pageIds.filter((id) => selected.has(id)).length;
  const allOnPageSelected = pageIds.length > 0 && selectedOnPage === pageIds.length;
  const overCap = selectedIds.length > MAX_PRINTABLE_CHALLANS;

  const toggleRow = (id: string, checked: boolean): void => {
    setSelectedIds((current) =>
      checked ? [...current, id] : current.filter((selectedId) => selectedId !== id),
    );
  };

  // The header box acts on this page only, never on the whole filtered set:
  // "select all" that reaches rows the user has not seen is a way to print a
  // thousand challans by accident.
  const togglePage = (checked: boolean): void => {
    setSelectedIds((current) =>
      checked
        ? [...current, ...pageIds.filter((id) => !current.includes(id))]
        : current.filter((id) => !pageIds.includes(id)),
    );
  };

  // `indeterminate` is a DOM property with no React attribute, so it has to be
  // set imperatively after every render that changes the count.
  const headerBox = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (headerBox.current === null) return;
    headerBox.current.indeterminate = selectedOnPage > 0 && !allOnPageSelected;
  }, [selectedOnPage, allOnPageSelected]);

  return (
    <div className="space-y-4">
      <Card>
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          <Select
            label="Academic year"
            options={[
              { value: '', label: 'All years' },
              ...academicYears.map((year) => ({
                value: year.id,
                label: year.isActive ? `${year.name} (active)` : year.name,
              })),
            ]}
            value={academicYearId}
            onChange={(event) => {
              onFilterChange(() => {
                setAcademicYearId(event.target.value);
              });
            }}
          />

          <Select
            label="Billing month"
            options={MONTH_OPTIONS}
            value={billingMonth}
            onChange={(event) => {
              onFilterChange(() => {
                setBillingMonth(event.target.value);
              });
            }}
          />

          <Input
            label="Billing year"
            type="number"
            min={2000}
            max={2100}
            value={billingYear}
            onChange={(event) => {
              onFilterChange(() => {
                setBillingYear(event.target.value);
              });
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
              onFilterChange(() => {
                setGradeId(event.target.value);
              });
            }}
          />

          <Select
            label="Section"
            options={[
              { value: '', label: 'All sections' },
              ...sections.map((section) => ({ value: section.id, label: section.name })),
            ]}
            value={sectionId}
            disabled={gradeId === ''}
            onChange={(event) => {
              onFilterChange(() => {
                setSectionId(event.target.value);
              });
            }}
          />

          <Select
            label="Status"
            options={STATUS_OPTIONS}
            value={status}
            onChange={(event) => {
              onFilterChange(() => {
                setStatus(event.target.value);
              });
            }}
          />

          <div className="xl:col-span-3">
            <Input
              label="Search"
              value={search}
              placeholder="Challan number, student name or student ID"
              onChange={(event) => {
                onFilterChange(() => {
                  setSearch(event.target.value);
                });
              }}
            />
          </div>
        </div>
      </Card>

      {error !== null ? (
        <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </p>
      ) : null}

      <Card className="p-0">
        {data === null ? (
          <p className="px-5 py-4 text-sm text-slate-500">Loading challans…</p>
        ) : data.challans.length === 0 ? (
          <div className="px-5 py-6">
            <p className="text-sm text-slate-600">
              No challans match these filters.
            </p>
            {canGenerate ? (
              <Link
                href="/dashboard/fees/challans/generate"
                className="mt-3 inline-block text-sm font-medium text-brand-primary hover:underline"
              >
                Generate challans
              </Link>
            ) : null}
          </div>
        ) : (
          <>
            {selectedIds.length > 0 ? (
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 bg-slate-50 px-5 py-3">
                <p aria-live="polite" className="text-sm text-slate-700">
                  <span className="font-medium">{selectedIds.length}</span> selected
                  {selectedOnPage === selectedIds.length ? null : (
                    <span className="text-slate-500">
                      {' '}
                      ({selectedOnPage} on this page)
                    </span>
                  )}
                  {overCap ? (
                    <span className="block text-red-700">
                      Print at most {MAX_PRINTABLE_CHALLANS} at once — large jobs
                      fail part-way through the browser&apos;s print dialog.
                    </span>
                  ) : null}
                </p>

                <div className="flex items-center gap-2">
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => {
                      setSelectedIds([]);
                    }}
                  >
                    Clear
                  </Button>

                  {overCap ? (
                    <Button size="sm" disabled>
                      Print selected
                    </Button>
                  ) : (
                    <Link
                      href={challanPrintHref(selectedIds)}
                      // A new tab so the list, its filters and the selection
                      // survive the print run — printing is rarely the last
                      // thing someone does on this page.
                      target="_blank"
                      rel="noopener"
                    >
                      <Button size="sm">
                        Print selected ({selectedIds.length})
                      </Button>
                    </Link>
                  )}
                </div>
              </div>
            ) : null}

            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-500">
                  <tr>
                    <th scope="col" className="w-10 py-3 pl-5 pr-0">
                      <input
                        ref={headerBox}
                        type="checkbox"
                        className="h-4 w-4 align-middle"
                        aria-label="Select every challan on this page"
                        checked={allOnPageSelected}
                        onChange={(event) => {
                          togglePage(event.target.checked);
                        }}
                      />
                    </th>
                    <th scope="col" className="px-5 py-3 font-medium">Challan #</th>
                    <th scope="col" className="px-5 py-3 font-medium">Student</th>
                    <th scope="col" className="px-5 py-3 font-medium">Class</th>
                    <th scope="col" className="px-5 py-3 font-medium">Period</th>
                    <th scope="col" className="px-5 py-3 text-right font-medium">Amount</th>
                    <th scope="col" className="px-5 py-3 text-right font-medium">Paid</th>
                    <th scope="col" className="px-5 py-3 text-right font-medium">Balance</th>
                    <th scope="col" className="px-5 py-3 font-medium">Status</th>
                    <th scope="col" className="px-5 py-3 font-medium">Due</th>
                    <th scope="col" className="px-5 py-3 font-medium">
                      <span className="sr-only">Actions</span>
                    </th>
                  </tr>
                </thead>

                <tbody className="divide-y divide-slate-100">
                  {data.challans.map((row) => {
                    const balance =
                      (toPaise(row.totalAmount) - toPaise(row.paidAmount)) / 100;

                    return (
                      <tr key={row.id} className={selected.has(row.id) ? 'bg-slate-50' : undefined}>
                        <td className="w-10 py-3 pl-5 pr-0">
                          <input
                            type="checkbox"
                            className="h-4 w-4 align-middle"
                            aria-label={`Select challan ${row.challanNumber} for ${row.studentName}`}
                            checked={selected.has(row.id)}
                            onChange={(event) => {
                              toggleRow(row.id, event.target.checked);
                            }}
                          />
                        </td>
                        <td className="px-5 py-3 font-mono text-xs text-slate-600">
                          {row.challanNumber}
                        </td>
                        <td className="px-5 py-3">
                          <p className="font-medium text-slate-900">{row.studentName}</p>
                          <p className="font-mono text-xs text-slate-500">
                            {row.studentId}
                          </p>
                        </td>
                        <td className="px-5 py-3 text-slate-600">
                          {row.gradeName ?? '—'}
                          {row.sectionName === null ? '' : ` ${row.sectionName}`}
                        </td>
                        <td className="px-5 py-3 text-slate-600">{billingLabel(row)}</td>
                        <td className="px-5 py-3 text-right text-slate-900">
                          {formatAmount(row.totalAmount)}
                        </td>
                        <td className="px-5 py-3 text-right text-slate-600">
                          {formatAmount(row.paidAmount)}
                        </td>
                        <td className="px-5 py-3 text-right font-medium text-slate-900">
                          {formatAmount(balance)}
                        </td>
                        <td className="px-5 py-3">
                          <Badge variant={STATUS_VARIANTS[row.status]}>
                            {CHALLAN_STATUS_LABELS[row.status]}
                          </Badge>
                        </td>
                        <td className="px-5 py-3 text-slate-600">{row.dueDate}</td>
                        <td className="px-5 py-3 text-right">
                          <Link
                            href={`/dashboard/fees/challans/${row.id}`}
                            className="text-sm font-medium text-brand-primary hover:underline"
                          >
                            View
                          </Link>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>

                <tfoot className="border-t border-slate-200 bg-slate-50">
                  <tr>
                    <th scope="row" colSpan={5} className="px-5 py-3 text-left font-medium text-slate-600">
                      Totals for these filters
                    </th>
                    <td className="px-5 py-3 text-right font-semibold text-slate-900">
                      {formatAmount(data.totals.billed)}
                    </td>
                    <td className="px-5 py-3 text-right font-semibold text-slate-900">
                      {formatAmount(data.totals.paid)}
                    </td>
                    <td className="px-5 py-3 text-right font-semibold text-slate-900">
                      {formatAmount(data.totals.balance)}
                    </td>
                    <td colSpan={3} />
                  </tr>
                </tfoot>
              </table>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 px-5 py-3">
              <p className="text-sm text-slate-500">
                {data.total} challan{data.total === 1 ? '' : 's'} · page {data.page} of{' '}
                {totalPages}
              </p>

              <div className="flex gap-2">
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={page <= 1}
                  onClick={() => {
                    setPage((current) => Math.max(current - 1, 1));
                  }}
                >
                  Previous
                </Button>
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={page >= totalPages}
                  onClick={() => {
                    setPage((current) => Math.min(current + 1, totalPages));
                  }}
                >
                  Next
                </Button>
              </div>
            </div>
          </>
        )}
      </Card>
    </div>
  );
}
