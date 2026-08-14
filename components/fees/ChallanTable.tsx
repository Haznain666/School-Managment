'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { Badge, type BadgeVariant } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
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
        <p role="alert" className="rounded-lg bg-status-danger-subtle px-3 py-2 text-sm text-status-danger-ink">
          {error}
        </p>
      ) : null}

      <Card className="p-0">
        {data === null ? (
          <p className="px-5 py-4 text-sm text-ink-muted">Loading challans…</p>
        ) : data.challans.length === 0 ? (
          <div className="px-5 py-6">
            <p className="text-sm text-ink-muted">
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
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line bg-surface-sunken px-5 py-3">
                <p aria-live="polite" className="text-sm text-ink">
                  <span className="font-medium">{selectedIds.length}</span> selected
                  {selectedOnPage === selectedIds.length ? null : (
                    <span className="text-ink-muted">
                      {' '}
                      ({selectedOnPage} on this page)
                    </span>
                  )}
                  {overCap ? (
                    <span className="block text-status-danger-ink">
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
              <Table
                caption="Fee challans"
                className="rounded-none border-0"
                maxHeight="32rem"
              >
                <TableHead>
                  <TableRow>
                    <TableHeaderCell className="w-10 pl-5 pr-0">
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
                    </TableHeaderCell>
                    <TableHeaderCell>Challan #</TableHeaderCell>
                    <TableHeaderCell>Student</TableHeaderCell>
                    <TableHeaderCell>Class</TableHeaderCell>
                    <TableHeaderCell>Period</TableHeaderCell>
                    <TableHeaderCell align="numeric">Amount</TableHeaderCell>
                    <TableHeaderCell align="numeric">Paid</TableHeaderCell>
                    <TableHeaderCell align="numeric">Balance</TableHeaderCell>
                    <TableHeaderCell>Status</TableHeaderCell>
                    <TableHeaderCell>Due</TableHeaderCell>
                    <TableHeaderCell>
                      <span className="sr-only">Actions</span>
                    </TableHeaderCell>
                  </TableRow>
                </TableHead>

                <TableBody>
                  {data.challans.map((row) => {
                    const balance =
                      (toPaise(row.totalAmount) - toPaise(row.paidAmount)) / 100;

                    return (
                      <TableRow key={row.id} selected={selected.has(row.id)}>
                        <TableCell className="w-10 pl-5 pr-0">
                          <input
                            type="checkbox"
                            className="h-4 w-4 align-middle"
                            aria-label={`Select challan ${row.challanNumber} for ${row.studentName}`}
                            checked={selected.has(row.id)}
                            onChange={(event) => {
                              toggleRow(row.id, event.target.checked);
                            }}
                          />
                        </TableCell>
                        <TableCell muted className="font-mono text-xs">
                          {row.challanNumber}
                        </TableCell>
                        <TableCell>
                          <p className="font-medium text-ink">{row.studentName}</p>
                          <p className="font-mono text-xs text-ink-muted">
                            {row.studentId}
                          </p>
                        </TableCell>
                        <TableCell muted>
                          {row.gradeName ?? '—'}
                          {row.sectionName === null ? '' : ` ${row.sectionName}`}
                        </TableCell>
                        <TableCell muted>{billingLabel(row)}</TableCell>
                        <TableCell align="numeric">
                          {formatAmount(row.totalAmount)}
                        </TableCell>
                        <TableCell align="numeric" muted>
                          {formatAmount(row.paidAmount)}
                        </TableCell>
                        <TableCell rowHeader align="numeric">
                          {formatAmount(balance)}
                        </TableCell>
                        <TableCell>
                          <Badge variant={STATUS_VARIANTS[row.status]}>
                            {CHALLAN_STATUS_LABELS[row.status]}
                          </Badge>
                        </TableCell>
                        <TableCell muted>{row.dueDate}</TableCell>
                        <TableCell align="numeric">
                          <Link
                            href={`/dashboard/fees/challans/${row.id}`}
                            className="text-sm font-medium text-brand-primary hover:underline"
                          >
                            View
                          </Link>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>

                <TableFoot>
                  <TableRow>
                    <TableCell rowHeader muted colSpan={5}>
                      Totals for these filters
                    </TableCell>
                    <TableCell align="numeric" className="font-semibold">
                      {formatAmount(data.totals.billed)}
                    </TableCell>
                    <TableCell align="numeric" className="font-semibold">
                      {formatAmount(data.totals.paid)}
                    </TableCell>
                    <TableCell align="numeric" className="font-semibold">
                      {formatAmount(data.totals.balance)}
                    </TableCell>
                    <TableCell colSpan={3} />
                  </TableRow>
                </TableFoot>
              </Table>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line px-5 py-3">
              <p className="text-sm text-ink-muted">
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
