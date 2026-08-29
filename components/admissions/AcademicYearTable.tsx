'use client';

import { CalendarDays, Plus } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { DataTable, type DataTableColumn } from '@/components/ui/DataTable';
import { EmptyState } from '@/components/ui/EmptyState';
import { formatMonthYear } from '@/db/schema/academic-years';
import { schoolErrorMessage, schoolFetch } from '@/lib/school-client';

/**
 * The list of academic years, with the one action that matters: which year is
 * current. Everything that says "this year" reads that flag, so switching it is
 * the single most consequential button on the Admissions setup screens — hence
 * the confirmation and the explicit note about what it changes.
 */

export interface AcademicYearRow {
  id: string;
  name: string;
  startMonth: number;
  startYear: number;
  endMonth: number;
  endYear: number;
  isActive: boolean;
  studentCount: number;
  /** The campuses this session runs at. **Empty means every campus.** */
  campuses: readonly { id: string; name: string }[];
}

export interface AcademicYearTableProps {
  years: readonly AcademicYearRow[];
  canEdit: boolean;
  /**
   * The year that is current only because today falls inside it — item 14c.
   *
   * Null whenever somebody has actually marked a year, because then the flag is
   * the answer. When it is set, that row is badged *Current* rather than
   * *Inactive*: a school looking at a list where every row says "Inactive"
   * would otherwise conclude the product is using no year at all, while every
   * other screen is quietly using this one.
   */
  currentByCalendarId?: string | null;
}

/** What every campus reads as, and it is a sentence rather than a dash. */
const ALL_CAMPUSES = 'All campuses';

export function AcademicYearTable({
  years,
  canEdit,
  currentByCalendarId = null,
}: AcademicYearTableProps) {
  const router = useRouter();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const activate = async (yearId: string): Promise<void> => {
    setBusyId(yearId);
    setError(null);

    try {
      await schoolFetch(`/api/school/academic-years/${yearId}/activate`, {
        method: 'POST',
      });
      router.refresh();
    } catch (caught) {
      setError(schoolErrorMessage(caught, 'Could not activate that academic year.'));
    } finally {
      setBusyId(null);
    }
  };

  const remove = async (yearId: string): Promise<void> => {
    setBusyId(yearId);
    setError(null);

    try {
      await schoolFetch(`/api/school/academic-years/${yearId}`, { method: 'DELETE' });
      router.refresh();
    } catch (caught) {
      setError(schoolErrorMessage(caught, 'Could not delete that academic year.'));
    } finally {
      setBusyId(null);
    }
  };

  if (years.length === 0) {
    return (
      <EmptyState
        icon={CalendarDays}
        title="No academic years yet"
        description="Create one before enrolling students — every placement, section and student ID is filed under a year."
        action={
          canEdit ? (
            <Link href="/dashboard/admissions/academic-years/new">
              <Button icon={Plus}>Create academic year</Button>
            </Link>
          ) : null
        }
      />
    );
  }

  /*
   * The campuses that appear anywhere in this list, for the facet.
   *
   * Derived from the rows rather than passed in, because a campus with no
   * session is a filter that can only ever return nothing — and the list of
   * campuses a *reader* may see is already what produced these rows.
   */
  const campusFilterOptions = [
    ...new Map(
      years.flatMap((year) =>
        year.campuses.map((campus) => [campus.id, campus.name] as const),
      ),
    ),
  ]
    .sort((a, b) => a[1].localeCompare(b[1]))
    .map(([value, label]) => ({ value, label }));

  const columns: Array<DataTableColumn<AcademicYearRow>> = [
    {
      id: 'name',
      header: 'Name',
      rowHeader: true,
      sortValue: (year) => year.name,
      searchValue: (year) => year.name,
      cell: (year) => year.name,
    },
    {
      id: 'starts',
      header: 'Starts',
      muted: true,
      kind: 'date',
      // Sorted on the year and month, not on the label: "April 2026" sorts
      // before "January 2026" as text, which is a school year in the wrong
      // order every time.
      sortValue: (year) => year.startYear * 100 + year.startMonth,
      cell: (year) => formatMonthYear(year.startMonth, year.startYear),
    },
    {
      id: 'ends',
      header: 'Ends',
      muted: true,
      sortValue: (year) => year.endYear * 100 + year.endMonth,
      cell: (year) => formatMonthYear(year.endMonth, year.endYear),
    },
    {
      /*
        The campuses this session runs at. Empty is "All campuses" and not a
        dash — see the prop's docblock, and `academic_year_branches`, which
        stores the absence rather than the fact.
      */
      id: 'campuses',
      header: 'Campus',
      muted: true,
      sortValue: (year) =>
        year.campuses.length === 0
          ? ALL_CAMPUSES
          : year.campuses.map((campus) => campus.name).join(', '),
      searchValue: (year) =>
        year.campuses.map((campus) => campus.name).join(' '),
      cell: (year) =>
        year.campuses.length === 0
          ? ALL_CAMPUSES
          : year.campuses.map((campus) => campus.name).join(', '),
    },
    {
      id: 'status',
      header: 'Status',
      sortValue: (year) => (year.isActive ? 0 : 1),
      cell: (year) =>
        year.isActive ? (
          <Badge variant="success">Active</Badge>
        ) : year.id === currentByCalendarId ? (
          // Nobody has marked a year, and this is the one the rest of the
          // product is using because today falls inside it.
          <Badge variant="info">Current by calendar</Badge>
        ) : (
          <Badge variant="neutral">Inactive</Badge>
        ),
    },
    {
      // A count is a quantity, so it aligns and sets like one.
      id: 'students',
      header: 'Students',
      kind: 'number',
      muted: true,
      sortValue: (year) => year.studentCount,
      cell: (year) => year.studentCount,
    },
    {
      id: 'actions',
      header: 'Actions',
      cell: (year) =>
        canEdit ? (
          <div className="flex flex-wrap gap-2">
            {year.isActive ? null : (
              <Button
                size="sm"
                variant="secondary"
                isLoading={busyId === year.id}
                onClick={() => {
                  void activate(year.id);
                }}
              >
                Set as active
              </Button>
            )}

            {/* Deleting a year with enrollments would take the history with it,
                so the button is not offered. */}
            {year.studentCount === 0 && !year.isActive ? (
              <Button
                size="sm"
                variant="ghost"
                isLoading={busyId === year.id}
                onClick={() => {
                  void remove(year.id);
                }}
              >
                Delete
              </Button>
            ) : null}
          </div>
        ) : (
          <span className="text-xs text-ink-muted">View only</span>
        ),
    },
  ];

  return (
    <div className="space-y-4">
      {error !== null ? (
        <p role="alert" className="rounded-lg bg-status-danger-subtle px-3 py-2 text-sm text-status-danger-ink">
          {error}
        </p>
      ) : null}

      <DataTable
        caption="Academic years"
        columns={columns}
        rows={years}
        getRowKey={(year) => year.id}
        defaultSort={{ columnId: 'starts', direction: 'desc' }}
        search={{ placeholder: 'Year name' }}
        filters={[
          {
            id: 'status',
            label: 'Status',
            allLabel: 'Every year',
            options: [
              { value: 'active', label: 'Active' },
              { value: 'inactive', label: 'Inactive' },
            ],
            rowValue: (year) => (year.isActive ? 'active' : 'inactive'),
          },
          // Offered only where there is more than one campus to choose from —
          // item 13, one level down: a dropdown with one option is a question
          // with one answer.
          ...(campusFilterOptions.length > 1
            ? [
                {
                  id: 'campus',
                  label: 'Campus',
                  allLabel: 'Every campus',
                  options: campusFilterOptions,
                  /*
                    A school-wide year matches **every** campus, because it
                    runs at every campus. Returning its own sentinel instead
                    would hide the whole existing calendar the moment anybody
                    used this filter, which is the same trap `sharedOrOwnedBy`
                    exists to prevent one layer down.
                  */
                  rowValue: (year: AcademicYearRow) =>
                    year.campuses.length === 0
                      ? campusFilterOptions.map((option) => option.value)
                      : year.campuses.map((campus) => campus.id),
                },
              ]
            : []),
        ]}
        itemNoun={{ singular: 'academic year', plural: 'academic years' }}
        emptyTitle="No academic years yet"
      />
    </div>
  );
}
