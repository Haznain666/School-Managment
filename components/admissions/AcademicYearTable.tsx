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
}

export interface AcademicYearTableProps {
  years: readonly AcademicYearRow[];
  canEdit: boolean;
}

export function AcademicYearTable({ years, canEdit }: AcademicYearTableProps) {
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
      id: 'status',
      header: 'Status',
      sortValue: (year) => (year.isActive ? 0 : 1),
      cell: (year) => (
        <Badge variant={year.isActive ? 'success' : 'neutral'}>
          {year.isActive ? 'Active' : 'Inactive'}
        </Badge>
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

            {/* Deleting a year with enrolments would take the history with it,
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
        ]}
        itemNoun={{ singular: 'academic year', plural: 'academic years' }}
        emptyTitle="No academic years yet"
      />
    </div>
  );
}
