'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';

import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import {
  ENROLLMENT_STATUSES,
  ENROLLMENT_STATUS_LABELS,
  type EnrollmentStatus,
} from '@/db/schema/student-enrollments';
import { schoolErrorMessage, schoolFetch } from '@/lib/school-client';

/**
 * The enrolled-student directory.
 *
 * Filters are stacked left to right and each one narrows the next: choosing a
 * branch loads its grades, choosing a grade loads its sections. That is not
 * decoration — a grade id from another branch would simply return nothing, and
 * offering it would look like a bug.
 */

export interface StudentRow {
  studentProfileId: string;
  studentId: string;
  name: string;
  gradeName: string;
  sectionName: string;
  branchName: string | null;
  guardianPhone: string | null;
  enrollmentDate: string;
  status: EnrollmentStatus;
  rollNumber: string | null;
}

export interface BranchOption {
  id: string;
  name: string;
}

export interface AcademicYearOption {
  id: string;
  name: string;
  isActive: boolean;
}

export interface StudentTableProps {
  branches: readonly BranchOption[];
  academicYears: readonly AcademicYearOption[];
  /** branch_admin is pinned to one branch and cannot widen the filter. */
  lockedBranchId: string | null;
}

interface GradeOption {
  id: string;
  label: string;
}

interface SectionOption {
  id: string;
  name: string;
}

interface StudentsResponse {
  students: StudentRow[];
  total: number;
  page: number;
  limit: number;
}

const STATUS_OPTIONS = [
  { value: '', label: 'All statuses' },
  ...ENROLLMENT_STATUSES.map((value) => ({
    value,
    label: ENROLLMENT_STATUS_LABELS[value],
  })),
];

function statusVariant(status: EnrollmentStatus): 'success' | 'warning' | 'danger' | 'neutral' {
  switch (status) {
    case 'active':
      return 'success';
    case 'transferred':
      return 'warning';
    case 'withdrawn':
      return 'danger';
    case 'graduated':
      return 'neutral';
    default:
      return 'neutral';
  }
}

export function StudentTable({
  branches,
  academicYears,
  lockedBranchId,
}: StudentTableProps) {
  const activeYearId =
    academicYears.find((year) => year.isActive)?.id ?? academicYears[0]?.id ?? '';

  const [search, setSearch] = useState('');
  const [branchId, setBranchId] = useState(lockedBranchId ?? '');
  const [gradeId, setGradeId] = useState('');
  const [sectionId, setSectionId] = useState('');
  const [academicYearId, setAcademicYearId] = useState(activeYearId);
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);

  const [grades, setGrades] = useState<GradeOption[]>([]);
  const [sections, setSections] = useState<SectionOption[]>([]);
  const [data, setData] = useState<StudentsResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (branchId === '') {
      setGrades([]);
      return;
    }

    const controller = new AbortController();

    void schoolFetch<{ grades: GradeOption[] }>(
      `/api/school/grades?branchId=${encodeURIComponent(branchId)}`,
      { signal: controller.signal },
    )
      .then((payload) => {
        setGrades(payload.grades);
      })
      .catch(() => {
        setGrades([]);
      });

    return () => {
      controller.abort();
    };
  }, [branchId]);

  useEffect(() => {
    if (gradeId === '' || academicYearId === '') {
      setSections([]);
      return;
    }

    const controller = new AbortController();
    const query = new URLSearchParams({ gradeId, academicYearId });

    void schoolFetch<{ sections: SectionOption[] }>(
      `/api/school/sections?${query.toString()}`,
      { signal: controller.signal },
    )
      .then((payload) => {
        setSections(payload.sections);
      })
      .catch(() => {
        setSections([]);
      });

    return () => {
      controller.abort();
    };
  }, [gradeId, academicYearId]);

  const load = useCallback(
    async (signal: AbortSignal) => {
      const query = new URLSearchParams({ page: String(page), limit: '20' });
      if (search.trim() !== '') query.set('search', search.trim());
      if (branchId !== '') query.set('branchId', branchId);
      if (gradeId !== '') query.set('gradeId', gradeId);
      if (sectionId !== '') query.set('sectionId', sectionId);
      if (academicYearId !== '') query.set('academicYearId', academicYearId);
      if (status !== '') query.set('status', status);

      try {
        setData(
          await schoolFetch<StudentsResponse>(`/api/school/students?${query.toString()}`, {
            signal,
          }),
        );
        setError(null);
      } catch (caught) {
        if (caught instanceof DOMException && caught.name === 'AbortError') return;
        setError(schoolErrorMessage(caught, 'Could not load students.'));
      }
    },
    [search, branchId, gradeId, sectionId, academicYearId, status, page],
  );

  // Debounced so typing in the search box does not fire a request per keystroke.
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

  const totalPages =
    data === null ? 1 : Math.max(Math.ceil(data.total / data.limit), 1);

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        <Input
          label="Search"
          placeholder="Name, student ID or phone"
          value={search}
          onChange={(event) => {
            setPage(1);
            setSearch(event.target.value);
          }}
        />

        <Select
          label="Academic year"
          options={academicYears.map((year) => ({
            value: year.id,
            label: year.isActive ? `${year.name} (active)` : year.name,
          }))}
          value={academicYearId}
          onChange={(event) => {
            setPage(1);
            setSectionId('');
            setAcademicYearId(event.target.value);
          }}
        />

        <Select
          label="Branch"
          options={[
            { value: '', label: 'All branches' },
            ...branches.map((branch) => ({ value: branch.id, label: branch.name })),
          ]}
          value={branchId}
          disabled={lockedBranchId !== null}
          onChange={(event) => {
            setPage(1);
            setGradeId('');
            setSectionId('');
            setBranchId(event.target.value);
          }}
        />

        <Select
          label="Grade"
          options={[
            { value: '', label: 'All grades' },
            ...grades.map((grade) => ({ value: grade.id, label: grade.label })),
          ]}
          value={gradeId}
          disabled={branchId === ''}
          onChange={(event) => {
            setPage(1);
            setSectionId('');
            setGradeId(event.target.value);
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
            setPage(1);
            setSectionId(event.target.value);
          }}
        />

        <Select
          label="Status"
          options={STATUS_OPTIONS}
          value={status}
          onChange={(event) => {
            setPage(1);
            setStatus(event.target.value);
          }}
        />
      </div>

      {error !== null ? (
        <p role="alert" className="rounded-lg bg-status-danger-subtle px-3 py-2 text-sm text-status-danger-ink">
          {error}
        </p>
      ) : null}

      {data === null ? (
        <Card>
          <p className="text-sm text-ink-muted">Loading students…</p>
        </Card>
      ) : data.students.length === 0 ? (
        <Card>
          <p className="text-sm text-ink-muted">No students match those filters.</p>
        </Card>
      ) : (
        <>
          <Card className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="border-b border-line text-xs uppercase tracking-wide text-ink-muted">
                  <tr>
                    <th scope="col" className="px-4 py-3 font-medium">Student ID</th>
                    <th scope="col" className="px-4 py-3 font-medium">Name</th>
                    <th scope="col" className="px-4 py-3 font-medium">Grade</th>
                    <th scope="col" className="px-4 py-3 font-medium">Section</th>
                    <th scope="col" className="px-4 py-3 font-medium">Guardian phone</th>
                    <th scope="col" className="px-4 py-3 font-medium">Enrolled</th>
                    <th scope="col" className="px-4 py-3 font-medium">Status</th>
                    <th scope="col" className="px-4 py-3 font-medium">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {data.students.map((row) => (
                    <tr key={row.studentProfileId}>
                      <td className="px-4 py-3 font-mono text-xs text-ink-muted">
                        {row.studentId}
                      </td>
                      <td className="px-4 py-3 font-medium text-ink">{row.name}</td>
                      <td className="px-4 py-3 text-ink-muted">{row.gradeName}</td>
                      <td className="px-4 py-3 text-ink-muted">{row.sectionName}</td>
                      <td className="px-4 py-3 font-mono text-xs text-ink-muted">
                        {row.guardianPhone ?? '—'}
                      </td>
                      <td className="px-4 py-3 text-ink-muted">{row.enrollmentDate}</td>
                      <td className="px-4 py-3">
                        <Badge variant={statusVariant(row.status)}>
                          {ENROLLMENT_STATUS_LABELS[row.status]}
                        </Badge>
                      </td>
                      <td className="px-4 py-3">
                        <Link
                          href={`/dashboard/admissions/students/${row.studentProfileId}`}
                          className="text-sm font-medium text-brand-primary hover:underline"
                        >
                          View profile
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>

          <div className="flex items-center justify-between text-sm text-ink-muted">
            <span>
              {data.total} student{data.total === 1 ? '' : 's'} · page {data.page} of{' '}
              {totalPages}
            </span>
            <div className="flex gap-2">
              <Button
                variant="secondary"
                size="sm"
                disabled={data.page <= 1}
                onClick={() => {
                  setPage((current) => Math.max(current - 1, 1));
                }}
              >
                Previous
              </Button>
              <Button
                variant="secondary"
                size="sm"
                disabled={data.page >= totalPages}
                onClick={() => {
                  setPage((current) => current + 1);
                }}
              >
                Next
              </Button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
