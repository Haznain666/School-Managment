'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
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
      <Card>
        <p className="text-sm text-slate-600">
          No academic years yet. Create one before enrolling students — every
          placement, section and student ID is filed under a year.
        </p>
        {canEdit ? (
          <Link href="/dashboard/admissions/academic-years/new" className="mt-4 inline-block">
            <Button>Create academic year</Button>
          </Link>
        ) : null}
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      {error !== null ? (
        <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </p>
      ) : null}

      <Card className="p-0">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th scope="col" className="px-4 py-3 font-medium">Name</th>
                <th scope="col" className="px-4 py-3 font-medium">Starts</th>
                <th scope="col" className="px-4 py-3 font-medium">Ends</th>
                <th scope="col" className="px-4 py-3 font-medium">Status</th>
                <th scope="col" className="px-4 py-3 font-medium">Students</th>
                <th scope="col" className="px-4 py-3 font-medium">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {years.map((year) => (
                <tr key={year.id}>
                  <td className="px-4 py-3 font-medium text-slate-900">{year.name}</td>
                  <td className="px-4 py-3 text-slate-600">
                    {formatMonthYear(year.startMonth, year.startYear)}
                  </td>
                  <td className="px-4 py-3 text-slate-600">
                    {formatMonthYear(year.endMonth, year.endYear)}
                  </td>
                  <td className="px-4 py-3">
                    <Badge variant={year.isActive ? 'success' : 'neutral'}>
                      {year.isActive ? 'Active' : 'Inactive'}
                    </Badge>
                  </td>
                  <td className="px-4 py-3 text-slate-600">{year.studentCount}</td>
                  <td className="px-4 py-3">
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
                      <span className="text-xs text-slate-400">View only</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
