'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';

import type { BadgeVariant } from '@/components/ui/Badge';
import {
  DataTable,
  DATA_TABLE_DEFAULT_PAGE_SIZE,
  type DataTableColumn,
  type DataTableSort,
} from '@/components/ui/DataTable';
import {
  APPLICATION_STATUSES,
  APPLICATION_STATUS_LABELS,
  type ApplicationStatus,
} from '@/db/schema/admission-applications';
import { schoolErrorMessage, schoolFetch } from '@/lib/school-client';

/**
 * The admissions inbox, one tab per status.
 *
 * Tabs rather than a status filter because reviewing is a queue: an admissions
 * officer works through "pending" until it is empty, and a dropdown hides how
 * much is left.
 */

export interface ApplicationRow {
  id: string;
  studentName: string;
  guardianName: string;
  guardianPhone: string;
  gradeName: string | null;
  branchName: string | null;
  status: ApplicationStatus;
  submittedAt: string;
  convertedToStudentProfileId: string | null;
}

export function applicationStatusVariant(status: ApplicationStatus): BadgeVariant {
  switch (status) {
    case 'accepted':
      return 'success';
    case 'rejected':
      return 'danger';
    case 'waitlisted':
    case 'reviewing':
      return 'warning';
    case 'pending':
      return 'neutral';
    default:
      return 'neutral';
  }
}

function formatDate(value: string): string {
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : parsed.toISOString().slice(0, 10);
}

export function ApplicationTable() {
  const [status, setStatus] = useState<ApplicationStatus>('pending');
  const [search, setSearch] = useState('');
  const [applications, setApplications] = useState<ApplicationRow[] | null>(null);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(DATA_TABLE_DEFAULT_PAGE_SIZE);
  const [sort, setSort] = useState<DataTableSort>({
    columnId: 'submittedAt',
    direction: 'desc',
  });
  const [pending, setPending] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(
    async (signal: AbortSignal) => {
      setPending(true);
      const query = new URLSearchParams({
        status,
        page: String(page),
        limit: String(pageSize),
        sort: sort.columnId,
        direction: sort.direction,
      });
      if (search.trim() !== '') query.set('search', search.trim());

      try {
        const payload = await schoolFetch<{
          applications: ApplicationRow[];
          total: number;
        }>(`/api/school/applications?${query.toString()}`, { signal });
        setApplications(payload.applications);
        setTotal(payload.total);
        setError(null);
      } catch (caught) {
        if (caught instanceof DOMException && caught.name === 'AbortError') return;
        setError(schoolErrorMessage(caught, 'Could not load applications.'));
      } finally {
        if (!signal.aborted) setPending(false);
      }
    },
    [status, search, page, pageSize, sort],
  );

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

  const columns: Array<DataTableColumn<ApplicationRow>> = [
    {
      id: 'studentName',
      header: 'Student',
      rowHeader: true,
      sortable: true,
      cell: (application) => application.studentName,
    },
    {
      id: 'guardianName',
      header: 'Guardian',
      muted: true,
      sortable: true,
      cell: (application) => application.guardianName,
    },
    {
      id: 'guardianPhone',
      header: 'Phone',
      muted: true,
      className: 'font-mono text-xs',
      cell: (application) => application.guardianPhone,
    },
    {
      id: 'grade',
      header: 'Grade',
      muted: true,
      sortable: true,
      cell: (application) => application.gradeName ?? 'Not specified',
    },
    {
      id: 'branch',
      header: 'Branch',
      muted: true,
      sortable: true,
      cell: (application) => application.branchName ?? '—',
    },
    {
      id: 'submittedAt',
      header: 'Submitted',
      kind: 'date',
      muted: true,
      sortable: true,
      cell: (application) => formatDate(application.submittedAt),
    },
    {
      id: 'actions',
      header: 'Actions',
      cell: (application) =>
        application.convertedToStudentProfileId === null ? (
          <Link
            href={`/dashboard/admissions/applications/${application.id}`}
            className="text-sm font-medium text-brand-primary hover:underline"
          >
            {application.status === 'accepted' ? 'Convert' : 'Review'}
          </Link>
        ) : (
          <Link
            href={`/dashboard/admissions/students/${application.convertedToStudentProfileId}`}
            className="text-sm font-medium text-brand-primary hover:underline"
          >
            View student
          </Link>
        ),
    },
  ];

  return (
    <div className="space-y-4">
      {/*
        Tabs rather than a status filter in the bar: reviewing is a queue, an
        officer works "pending" until it is empty, and a dropdown hides how much
        is left. The status therefore stays out of `filters` — clearing the
        filters must not silently move somebody to a different queue.
      */}
      <div role="tablist" aria-label="Application status" className="flex flex-wrap gap-2">
        {APPLICATION_STATUSES.map((value) => (
          <button
            key={value}
            type="button"
            role="tab"
            aria-selected={status === value}
            onClick={() => {
              setPage(1);
              setStatus(value);
            }}
            className={
              status === value
                ? 'rounded-full bg-brand-primary px-3 py-1.5 text-sm font-medium text-brand-onPrimary'
                : 'rounded-full bg-surface-sunken px-3 py-1.5 text-sm font-medium text-ink-muted hover:bg-line'
            }
          >
            {APPLICATION_STATUS_LABELS[value]}
          </button>
        ))}
      </div>

      {error !== null ? (
        <p
          role="alert"
          className="rounded-lg bg-status-danger-subtle px-3 py-2 text-sm text-status-danger-ink"
        >
          {error}
        </p>
      ) : null}

      <DataTable
        mode="server"
        caption="Admission applications"
        columns={columns}
        rows={applications ?? []}
        getRowKey={(application) => application.id}
        pending={pending}
        sort={sort}
        onSortChange={(next) => {
          setPage(1);
          setSort(next);
        }}
        page={page}
        pageSize={pageSize}
        totalItems={total}
        onPageChange={setPage}
        onPageSizeChange={setPageSize}
        search={{
          value: search,
          onChange: (value) => {
            setPage(1);
            setSearch(value);
          },
          placeholder: 'Student, guardian or phone',
        }}
        filtersActive={search.trim() !== ''}
        onClearFilters={() => {
          setPage(1);
          setSearch('');
        }}
        itemNoun={{ singular: 'application', plural: 'applications' }}
        emptyTitle={`No ${APPLICATION_STATUS_LABELS[status].toLowerCase()} applications`}
        emptyDescription="Applications arrive from the school's public admission form."
        noResultTitle="Nothing matches that search"
        noResultDescription={`No ${APPLICATION_STATUS_LABELS[
          status
        ].toLowerCase()} application matches it. Clear the search, or try another queue.`}
      />
    </div>
  );
}
