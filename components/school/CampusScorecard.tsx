'use client';

import Link from 'next/link';

import { DataTable, type DataTableColumn } from '@/components/ui/DataTable';
import type { CampusScorecardRow } from '@/lib/dashboard-queries';
import { formatPkr } from '@/lib/money';

/**
 * The per-campus scorecard — Sprint 19a, item 4b(f).
 *
 * ── Why a table and not a chart ──────────────────────────────────────────
 * Five money columns across eight campuses is forty grouped bars, which reads
 * as a wall rather than a comparison. The same figures in a table are still
 * readable at twenty campuses, can be sorted by whichever column the reader is
 * worried about, and — the part a chart cannot do — every row links to that
 * campus's own dashboard. This is the owner's working artifact; the charts
 * above it are the glance.
 *
 * ── Sorted in the browser, deliberately ──────────────────────────────────
 * A school group has campuses in double figures at most, they all arrive in one
 * server read, and `mode="client"` is what `DataTable` is for at that size.
 * Paging this to the server would be a round trip per click to reorder eight
 * rows. Every column declares `sortValue`, which is what makes it sortable in
 * that mode, and `kind` so the one comparator treats money as money rather than
 * as text.
 *
 * ── A null attendance is not 0% ──────────────────────────────────────────
 * A campus whose register has not been taken and a campus where nobody came are
 * opposite statements. The first prints an em dash, and its `sortValue` is
 * `null` rather than `0` — `compareValues` sorts blanks to the bottom in both
 * directions, so an absent figure never masquerades as the worst one. Sorting a
 * missing register to the top of "worst attendance" is precisely the row a
 * reader would act on first.
 */
export function CampusScorecard({ rows }: { rows: readonly CampusScorecardRow[] }) {
  const columns: Array<DataTableColumn<CampusScorecardRow>> = [
    {
      id: 'campus',
      header: 'Campus',
      rowHeader: true,
      sortValue: (row) => row.branchName,
      searchValue: (row) => row.branchName,
      cell: (row) => (
        // Each row opens that campus's own dashboard, which is this same page
        // with `?branch=` set — so the link *is* the selector, reached from the
        // number that raised the question.
        <Link
          href={`/dashboard?branch=${row.branchId}`}
          className="font-medium text-brand-primary hover:underline"
        >
          {row.branchName}
        </Link>
      ),
    },
    {
      id: 'students',
      header: 'Students',
      kind: 'number',
      sortValue: (row) => row.students,
      cell: (row) => row.students.toLocaleString(),
    },
    {
      id: 'attendance',
      header: 'Attendance',
      kind: 'number',
      muted: true,
      sortValue: (row) => row.attendanceRate,
      cell: (row) => (row.attendanceRate === null ? '—' : `${row.attendanceRate}%`),
    },
    {
      id: 'billed',
      header: 'Billed',
      kind: 'money',
      muted: true,
      sortValue: (row) => row.billed,
      cell: (row) => formatPkr(row.billed),
    },
    {
      id: 'collected',
      header: 'Collected',
      kind: 'money',
      sortValue: (row) => row.collected,
      cell: (row) => formatPkr(row.collected),
    },
    {
      id: 'rate',
      header: 'Rate',
      kind: 'number',
      sortValue: (row) => row.collectionRate,
      cell: (row) => (row.collectionRate === null ? '—' : `${row.collectionRate}%`),
    },
    {
      id: 'outstanding',
      header: 'Outstanding',
      kind: 'money',
      sortValue: (row) => row.outstanding,
      cell: (row) => formatPkr(row.outstanding),
    },
    {
      id: 'over90',
      header: 'Over 90d',
      kind: 'money',
      muted: true,
      sortValue: (row) => row.over90,
      cell: (row) => formatPkr(row.over90),
    },
  ];

  return (
    <DataTable
      mode="client"
      caption="Every campus, this academic year"
      columns={columns}
      rows={rows}
      getRowKey={(row) => row.branchId}
      /*
        Outstanding first, descending. This table exists to find the campus that
        needs a telephone call, and alphabetical order buries it — the same
        argument the attendance-by-class chart makes for sorting worst-first.
      */
      defaultSort={{ columnId: 'outstanding', direction: 'desc' }}
      itemNoun={{ singular: 'campus', plural: 'campuses' }}
      emptyTitle="No campuses yet"
      emptyDescription="Add a campus and its numbers appear here."
    />
  );
}
