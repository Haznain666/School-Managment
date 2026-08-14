'use client';

import { CalendarDays, Plus } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeaderCell,
  TableRow,
} from '@/components/ui/Table';
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

  return (
    <div className="space-y-4">
      {error !== null ? (
        <p role="alert" className="rounded-lg bg-status-danger-subtle px-3 py-2 text-sm text-status-danger-ink">
          {error}
        </p>
      ) : null}

      <Table caption="Academic years">
        <TableHead>
          <TableRow>
            <TableHeaderCell>Name</TableHeaderCell>
            <TableHeaderCell>Starts</TableHeaderCell>
            <TableHeaderCell>Ends</TableHeaderCell>
            <TableHeaderCell>Status</TableHeaderCell>
            {/* A count is a quantity, so it aligns and sets like one. */}
            <TableHeaderCell align="numeric">Students</TableHeaderCell>
            <TableHeaderCell>Actions</TableHeaderCell>
          </TableRow>
        </TableHead>
        <TableBody>
              {years.map((year) => (
                <TableRow key={year.id}>
                  <TableCell rowHeader>{year.name}</TableCell>
                  <TableCell muted>
                    {formatMonthYear(year.startMonth, year.startYear)}
                  </TableCell>
                  <TableCell muted>
                    {formatMonthYear(year.endMonth, year.endYear)}
                  </TableCell>
                  <TableCell>
                    <Badge variant={year.isActive ? 'success' : 'neutral'}>
                      {year.isActive ? 'Active' : 'Inactive'}
                    </Badge>
                  </TableCell>
                  <TableCell align="numeric" muted>{year.studentCount}</TableCell>
                  <TableCell>
                    {canEdit ? (
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

                        {/* Deleting a year with enrolments would take the
                            history with it, so the button is not offered. */}
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
                    )}
                  </TableCell>
                </TableRow>
              ))}
        </TableBody>
      </Table>
    </div>
  );
}
