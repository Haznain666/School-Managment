'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';

import { Badge } from '@/components/ui/Badge';
import {
  DataTable,
  DATA_TABLE_DEFAULT_PAGE_SIZE,
  type DataTableColumn,
  type DataTableSort,
} from '@/components/ui/DataTable';
import { Select } from '@/components/ui/Select';
import {
  ENROLLMENT_STATUSES,
  ENROLLMENT_STATUS_LABELS,
  type EnrollmentStatus,
} from '@/db/schema/student-enrollments';
import { formatPhoneForDisplay } from '@/lib/phone-formats';
import { schoolErrorMessage, schoolFetch } from '@/lib/school-client';
import {
  STUDENT_FEE_STATUSES,
  STUDENT_FEE_STATUS_LABELS,
  isStudentFeeStatus,
  studentFeeStatusVariant,
  type StudentFeeStatus,
} from '@/lib/student-fee-status';

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
  /** The primary guardian's number, in storage form. Displayed through the mask. */
  guardianPhone: string | null;
  enrollmentDate: string;
  status: EnrollmentStatus;
  rollNumber: string | null;
  feeStatus: StudentFeeStatus;
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

  /*
   * `?feeStatus=not_billed`, so the vouchers register can link here — Sprint 28.
   *
   * Read here rather than as the page's `searchParams`, which is CLAUDE.md's
   * second rule: `searchParams` on a server component opts the whole route out
   * of prerendering for a value the browser already has. The page above is
   * `force-dynamic` for its own reads, so nothing is lost either way — but the
   * habit is what matters, and this is the reading that stays right if that
   * page ever stops fetching.
   *
   * Validated before it is used, and anything unrecognised is dropped rather
   * than refused. That is the same answer `listStudents` gives a stale value on
   * the server: a bookmark from before a state was renamed shows the whole
   * directory, which is a harmless surprise, rather than an error page, which
   * is not. Seeded once, as the initial state — from here on the dropdown owns
   * it, so clearing the filter does not fight the URL that opened the screen.
   */
  const urlFeeStatus = useSearchParams().get('feeStatus');

  const [search, setSearch] = useState('');
  const [branchId, setBranchId] = useState(lockedBranchId ?? '');
  const [gradeId, setGradeId] = useState('');
  const [sectionId, setSectionId] = useState('');
  const [academicYearId, setAcademicYearId] = useState(activeYearId);
  const [status, setStatus] = useState('');
  const [feeStatus, setFeeStatus] = useState(
    isStudentFeeStatus(urlFeeStatus) ? urlFeeStatus : '',
  );
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(DATA_TABLE_DEFAULT_PAGE_SIZE);
  const [sort, setSort] = useState<DataTableSort>({
    columnId: 'name',
    direction: 'asc',
  });
  const [pending, setPending] = useState(true);

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
      setPending(true);
      const query = new URLSearchParams({
        page: String(page),
        limit: String(pageSize),
        sort: sort.columnId,
        direction: sort.direction,
      });
      if (search.trim() !== '') query.set('search', search.trim());
      if (branchId !== '') query.set('branchId', branchId);
      if (gradeId !== '') query.set('gradeId', gradeId);
      if (sectionId !== '') query.set('sectionId', sectionId);
      if (academicYearId !== '') query.set('academicYearId', academicYearId);
      if (status !== '') query.set('status', status);
      if (feeStatus !== '') query.set('feeStatus', feeStatus);

      try {
        setData(
          await schoolFetch<StudentsResponse>(`/api/school/students?${query.toString()}`, {
            signal,
          }),
        );
        setError(null);
      } catch (caught) {
        // An aborted request is a keystroke, not a failure, and it leaves the
        // pending state alone: the request that replaced it is still in flight
        // and the skeleton belongs to that one.
        if (caught instanceof DOMException && caught.name === 'AbortError') return;
        setError(schoolErrorMessage(caught, 'Could not load students.'));
      } finally {
        if (!signal.aborted) setPending(false);
      }
    },
    [
      search,
      branchId,
      gradeId,
      sectionId,
      academicYearId,
      status,
      feeStatus,
      page,
      pageSize,
      sort,
    ],
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

  const columns: Array<DataTableColumn<StudentRow>> = [
    {
      id: 'studentId',
      header: 'Student ID',
      muted: true,
      sortable: true,
      className: 'font-mono text-xs',
      cell: (row) => row.studentId,
    },
    {
      id: 'name',
      header: 'Name',
      rowHeader: true,
      sortable: true,
      cell: (row) => row.name,
    },
    {
      id: 'grade',
      header: 'Grade',
      muted: true,
      sortable: true,
      cell: (row) => row.gradeName,
    },
    {
      id: 'section',
      header: 'Section',
      muted: true,
      sortable: true,
      cell: (row) => row.sectionName,
    },
    {
      id: 'guardianPhone',
      header: 'Guardian phone',
      muted: true,
      className: 'font-mono text-xs',
      // Stored as `+923211234567`, read as `(0321) 123-4567`. The column is the
      // *guardian's* number now: it used to read the student's own directory
      // row, which carries the `student:<admission number>` sentinel.
      cell: (row) =>
        row.guardianPhone === null ? '—' : formatPhoneForDisplay(row.guardianPhone),
    },
    {
      /*
       * One word for what this child owes, so the question does not send
       * whoever is at the counter into the fee module. `lib/student-fee-status.ts`
       * holds the ranking that decides which of the four states shows when more
       * than one is true, and the server's filter is written from the same one.
       *
       * Not sortable: the states are ranked by specificity rather than by
       * severity, so a column sorted on them would order rows by a rule that
       * looks like an ordering of urgency and is not. The filter is the control
       * that answers "show me who owes", and it says exactly what it did.
       */
      id: 'feeStatus',
      header: 'Fees',
      cell: (row) => (
        <Badge variant={studentFeeStatusVariant(row.feeStatus)}>
          {STUDENT_FEE_STATUS_LABELS[row.feeStatus]}
        </Badge>
      ),
    },
    {
      id: 'enrollmentDate',
      header: 'Enrolled',
      kind: 'date',
      muted: true,
      sortable: true,
      cell: (row) => row.enrollmentDate,
    },
    {
      id: 'status',
      header: 'Status',
      sortable: true,
      cell: (row) => (
        <Badge variant={statusVariant(row.status)}>
          {ENROLLMENT_STATUS_LABELS[row.status]}
        </Badge>
      ),
    },
    {
      id: 'actions',
      header: 'Actions',
      cell: (row) => (
        <Link
          href={`/dashboard/admissions/students/${row.studentProfileId}`}
          className="text-sm font-medium text-brand-primary hover:underline"
        >
          View profile
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

      <DataTable
        mode="server"
        caption="Students"
        columns={columns}
        rows={data?.students ?? []}
        getRowKey={(row) => row.studentProfileId}
        pending={pending}
        sort={sort}
        onSortChange={(next) => {
          setPage(1);
          setSort(next);
        }}
        page={page}
        pageSize={pageSize}
        totalItems={data?.total ?? 0}
        onPageChange={setPage}
        onPageSizeChange={setPageSize}
        search={{
          value: search,
          onChange: (value) => {
            setPage(1);
            setSearch(value);
          },
          placeholder: 'Name, student ID or guardian phone',
        }}
        filters={[
          {
            id: 'status',
            label: 'Status',
            allLabel: 'All statuses',
            options: ENROLLMENT_STATUSES.map((value) => ({
              value,
              label: ENROLLMENT_STATUS_LABELS[value],
            })),
            value: status,
            onChange: (value) => {
              setPage(1);
              setStatus(value);
            },
          },
          {
            id: 'feeStatus',
            label: 'Fees',
            allLabel: 'Any fee status',
            options: STUDENT_FEE_STATUSES.map((value) => ({
              value,
              label: STUDENT_FEE_STATUS_LABELS[value],
            })),
            value: feeStatus,
            onChange: (value) => {
              setPage(1);
              setFeeStatus(value);
            },
          },
        ]}
        /*
         * Year, branch, grade and section stay hand-written rather than
         * becoming filter descriptors: each one narrows the next, and the
         * dependency — a grade list that reloads when the branch changes — is
         * the reason a grade from another branch is never offered. A generic
         * filter has no way to express that, and offering an id that returns
         * nothing looks like a bug.
         */
        extraFilters={
          <>
            <div className="w-full sm:w-52">
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
            </div>
            <div className="w-full sm:w-52">
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
            </div>
            <div className="w-full sm:w-52">
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
            </div>
            <div className="w-full sm:w-52">
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
            </div>
          </>
        }
        filtersActive={
          search.trim() !== '' ||
          status !== '' ||
          feeStatus !== '' ||
          gradeId !== '' ||
          sectionId !== '' ||
          (branchId !== '' && lockedBranchId === null)
        }
        onClearFilters={() => {
          setPage(1);
          setSearch('');
          setStatus('');
          setFeeStatus('');
          setGradeId('');
          setSectionId('');
          // A branch-bound administrator's branch is not a filter they chose,
          // so clearing does not hand them the whole school.
          if (lockedBranchId === null) setBranchId('');
        }}
        itemNoun={{ singular: 'student', plural: 'students' }}
        emptyTitle="No students enrolled yet"
        emptyDescription="Enroll a student, or import a roll, and the directory fills in."
        noResultTitle="No students match those filters"
        noResultDescription="Widen the year, class or status and they will come back."
      />
    </div>
  );
}
