'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { Badge, type BadgeVariant } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import {
  DataTable,
  DATA_TABLE_DEFAULT_PAGE_SIZE,
  type DataTableColumn,
  type DataTableSort,
} from '@/components/ui/DataTable';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { TableCell, TableRow } from '@/components/ui/Table';
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

const STATUS_OPTIONS = CHALLAN_STATUSES.map((value) => ({
  value,
  label: CHALLAN_STATUS_LABELS[value],
}));

const MONTH_OPTIONS = [
  { value: '', label: 'All months' },
  ...MONTH_NAMES.map((name, index) => ({ value: String(index + 1), label: name })),
];

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
  const [pageSize, setPageSize] = useState(DATA_TABLE_DEFAULT_PAGE_SIZE);
  const [sort, setSort] = useState<DataTableSort>({
    columnId: 'createdAt',
    direction: 'desc',
  });
  const [pending, setPending] = useState(true);

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
    setPending(true);
    const query = new URLSearchParams({
      page: String(page),
      limit: String(pageSize),
      sort: sort.columnId,
      direction: sort.direction,
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
    } finally {
      setPending(false);
    }
  }, [
    academicYearId,
    billingMonth,
    billingYear,
    gradeId,
    sectionId,
    status,
    search,
    page,
    pageSize,
    sort,
  ]);

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

  const columns: Array<DataTableColumn<ChallanRow>> = [
    {
      id: 'select',
      headerClassName: 'w-10 pl-5 pr-0',
      className: 'w-10 pl-5 pr-0',
      header: (
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
      ),
      cell: (row) => (
        <input
          type="checkbox"
          className="h-4 w-4 align-middle"
          aria-label={`Select challan ${row.challanNumber} for ${row.studentName}`}
          checked={selected.has(row.id)}
          onChange={(event) => {
            toggleRow(row.id, event.target.checked);
          }}
        />
      ),
    },
    {
      id: 'challanNumber',
      header: 'Challan #',
      muted: true,
      sortable: true,
      className: 'font-mono text-xs',
      cell: (row) => row.challanNumber,
    },
    {
      id: 'studentName',
      header: 'Student',
      sortable: true,
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
      cell: (row) =>
        `${row.gradeName ?? '—'}${row.sectionName === null ? '' : ` ${row.sectionName}`}`,
    },
    {
      id: 'period',
      header: 'Period',
      muted: true,
      cell: (row) => billingLabel(row),
    },
    {
      id: 'totalAmount',
      header: 'Amount',
      kind: 'money',
      sortable: true,
      cell: (row) => formatAmount(row.totalAmount),
    },
    {
      id: 'paidAmount',
      header: 'Paid',
      kind: 'money',
      muted: true,
      sortable: true,
      cell: (row) => formatAmount(row.paidAmount),
    },
    {
      id: 'balance',
      header: 'Balance',
      kind: 'money',
      rowHeader: true,
      sortable: true,
      cell: (row) =>
        formatAmount((toPaise(row.totalAmount) - toPaise(row.paidAmount)) / 100),
    },
    {
      id: 'status',
      header: 'Status',
      sortable: true,
      cell: (row) => (
        <Badge variant={STATUS_VARIANTS[row.status]}>
          {CHALLAN_STATUS_LABELS[row.status]}
        </Badge>
      ),
    },
    {
      id: 'dueDate',
      header: 'Due',
      kind: 'date',
      muted: true,
      sortable: true,
      cell: (row) => row.dueDate,
    },
    {
      id: 'actions',
      align: 'numeric',
      header: <span className="sr-only">Actions</span>,
      cell: (row) => (
        <Link
          href={`/dashboard/fees/challans/${row.id}`}
          className="text-sm font-medium text-brand-primary hover:underline"
        >
          View
        </Link>
      ),
    },
  ];

  return (
    <div className="space-y-4">
      {error !== null ? (
        <p
          role="alert"
          className="rounded-lg bg-status-danger-subtle px-3 py-2 text-sm text-status-danger-ink"
        >
          {error}
        </p>
      ) : null}

      {selectedIds.length > 0 ? (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-card border border-line bg-surface-sunken px-5 py-3">
          <p aria-live="polite" className="text-sm text-ink">
            <span className="font-medium">{selectedIds.length}</span> selected
            {selectedOnPage === selectedIds.length ? null : (
              <span className="text-ink-muted"> ({selectedOnPage} on this page)</span>
            )}
            {overCap ? (
              <span className="block text-status-danger-ink">
                Print at most {MAX_PRINTABLE_CHALLANS} at once — large jobs fail
                part-way through the browser&apos;s print dialog.
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
                // A new tab so the list, its filters and the selection survive
                // the print run — printing is rarely the last thing someone
                // does on this page.
                target="_blank"
                rel="noopener"
              >
                <Button size="sm">Print selected ({selectedIds.length})</Button>
              </Link>
            )}
          </div>
        </div>
      ) : null}

      <DataTable
        mode="server"
        caption="Fee challans"
        maxHeight="32rem"
        columns={columns}
        rows={rows}
        getRowKey={(row) => row.id}
        rowSelected={(row) => selected.has(row.id)}
        pending={pending}
        sort={sort}
        onSortChange={(next) => {
          // A sort is a new result set, so the same rule as a filter applies:
          // the page and the selection both belong to the order they were made
          // in. See the note at the top of this file.
          onFilterChange(() => {
            setSort(next);
          });
        }}
        page={page}
        pageSize={pageSize}
        totalItems={data?.total ?? 0}
        onPageChange={setPage}
        onPageSizeChange={setPageSize}
        search={{
          value: search,
          onChange: (value) => {
            onFilterChange(() => {
              setSearch(value);
            });
          },
          placeholder: 'Challan number, student name or student ID',
        }}
        filters={[
          {
            id: 'status',
            label: 'Status',
            allLabel: 'All statuses',
            options: STATUS_OPTIONS,
            value: status,
            onChange: (value) => {
              onFilterChange(() => {
                setStatus(value);
              });
            },
          },
        ]}
        extraFilters={
          <>
            <div className="w-full sm:w-52">
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
            </div>
            <div className="w-full sm:w-40">
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
            </div>
            <div className="w-full sm:w-32">
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
            </div>
            <div className="w-full sm:w-44">
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
            </div>
            <div className="w-full sm:w-44">
              <Select
                label="Section"
                options={[
                  { value: '', label: 'All sections' },
                  ...sections.map((section) => ({
                    value: section.id,
                    label: section.name,
                  })),
                ]}
                value={sectionId}
                disabled={gradeId === ''}
                onChange={(event) => {
                  onFilterChange(() => {
                    setSectionId(event.target.value);
                  });
                }}
              />
            </div>
          </>
        }
        filtersActive={
          search.trim() !== '' ||
          status !== '' ||
          gradeId !== '' ||
          sectionId !== '' ||
          billingMonth !== '' ||
          academicYearId !== ''
        }
        onClearFilters={() => {
          onFilterChange(() => {
            setSearch('');
            setStatus('');
            setGradeId('');
            setSectionId('');
            setBillingMonth('');
            setAcademicYearId('');
          });
        }}
        itemNoun={{ singular: 'challan', plural: 'challans' }}
        emptyTitle="No challans raised yet"
        emptyDescription="Generate a month's challans and the register fills in."
        emptyAction={
          canGenerate ? (
            <Link href="/dashboard/fees/challans/generate">
              <Button size="sm">Generate challans</Button>
            </Link>
          ) : undefined
        }
        noResultTitle="No challans match these filters"
        noResultDescription="Widen the month, class or status to see more of the register."
        footer={
          data === null ? undefined : (
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
          )
        }
      />
    </div>
  );
}
