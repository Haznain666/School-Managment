'use client';

import { useCallback, useEffect, useState } from 'react';

import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { schoolErrorMessage, schoolFetch } from '@/lib/school-client';

export interface BranchOption {
  id: string;
  name: string;
}

export interface PlacementDraft {
  branchId: string;
  gradeId: string;
  sectionId: string;
  rollNumber: string;
  enrollmentDate: string;
}

interface GradeOption {
  id: string;
  branchId: string;
  label: string;
  sortOrder: number;
}

interface SectionOption {
  id: string;
  name: string;
  capacity: number | null;
  studentCount: number;
  isActive: boolean;
}

export interface AcademicPlacementFormProps {
  branches: readonly BranchOption[];
  /** The active academic year the placement will be filed under. */
  academicYearId: string;
  academicYearName: string;
  value: PlacementDraft;
  onChange: (value: PlacementDraft) => void;
  disabled?: boolean;
}

export function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * Branch -> grade -> section, each list fetched once the one above it is chosen.
 *
 * Grades are loaded rather than derived from the predefined list because only
 * the seeded rows have ids to enrol against — a branch whose ladder has not
 * been initialised genuinely has nowhere to put a student, and saying so here
 * is more use than offering grades that cannot be selected.
 */
export function AcademicPlacementForm({
  branches,
  academicYearId,
  academicYearName,
  value,
  onChange,
  disabled = false,
}: AcademicPlacementFormProps) {
  const [grades, setGrades] = useState<GradeOption[]>([]);
  const [sections, setSections] = useState<SectionOption[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [isLoadingGrades, setIsLoadingGrades] = useState(false);

  const set = useCallback(
    (patch: Partial<PlacementDraft>) => {
      onChange({ ...value, ...patch });
    },
    [onChange, value],
  );

  useEffect(() => {
    if (value.branchId === '') {
      setGrades([]);
      return;
    }

    const controller = new AbortController();
    setIsLoadingGrades(true);

    void schoolFetch<{ grades: GradeOption[] }>(
      `/api/school/grades?branchId=${encodeURIComponent(value.branchId)}`,
      { signal: controller.signal },
    )
      .then((data) => {
        setGrades(data.grades);
        setError(null);
      })
      .catch((caught: unknown) => {
        if (caught instanceof DOMException && caught.name === 'AbortError') return;
        setError(schoolErrorMessage(caught, 'Could not load grades for this branch.'));
      })
      .finally(() => {
        setIsLoadingGrades(false);
      });

    return () => {
      controller.abort();
    };
  }, [value.branchId]);

  useEffect(() => {
    if (value.gradeId === '') {
      setSections([]);
      return;
    }

    const controller = new AbortController();
    const query = new URLSearchParams({
      gradeId: value.gradeId,
      academicYearId,
    });

    void schoolFetch<{ sections: SectionOption[] }>(
      `/api/school/sections?${query.toString()}`,
      { signal: controller.signal },
    )
      .then((data) => {
        setSections(data.sections.filter((section) => section.isActive));
        setError(null);
      })
      .catch((caught: unknown) => {
        if (caught instanceof DOMException && caught.name === 'AbortError') return;
        setError(schoolErrorMessage(caught, 'Could not load sections for this grade.'));
      });

    return () => {
      controller.abort();
    };
  }, [value.gradeId, academicYearId]);

  const gradeOptions = grades.map((grade) => ({ value: grade.id, label: grade.label }));

  const sectionOptions = sections.map((section) => ({
    value: section.id,
    label:
      section.capacity === null
        ? `${section.name} — ${section.studentCount} students`
        : `${section.name} — ${section.studentCount}/${section.capacity} students${
            section.studentCount >= section.capacity ? ' (full)' : ''
          }`,
  }));

  return (
    <div className="space-y-4">
      <p className="rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-600">
        The student will be enrolled in the <strong>{academicYearName}</strong>{' '}
        academic year.
      </p>

      <div className="grid gap-4 sm:grid-cols-2">
        <Select
          label="Branch"
          required
          placeholder="Select a branch"
          options={branches.map((branch) => ({ value: branch.id, label: branch.name }))}
          value={value.branchId}
          disabled={disabled}
          onChange={(event) => {
            // Grade and section belong to the old branch; keeping them would
            // submit a placement that does not go together.
            set({ branchId: event.target.value, gradeId: '', sectionId: '' });
          }}
        />

        <Select
          label="Grade"
          required
          placeholder={
            value.branchId === ''
              ? 'Choose a branch first'
              : isLoadingGrades
                ? 'Loading grades…'
                : 'Select a grade'
          }
          options={gradeOptions}
          value={value.gradeId}
          disabled={disabled || value.branchId === '' || gradeOptions.length === 0}
          onChange={(event) => {
            set({ gradeId: event.target.value, sectionId: '' });
          }}
        />

        <Select
          label="Section"
          required
          placeholder={
            value.gradeId === '' ? 'Choose a grade first' : 'Select a section'
          }
          options={sectionOptions}
          value={value.sectionId}
          disabled={disabled || value.gradeId === '' || sectionOptions.length === 0}
          onChange={(event) => {
            set({ sectionId: event.target.value });
          }}
        />

        <Input
          label="Roll number"
          hint="Optional — the student's number within the section."
          value={value.rollNumber}
          disabled={disabled}
          onChange={(event) => {
            set({ rollNumber: event.target.value });
          }}
        />

        <Input
          label="Enrolment date"
          type="date"
          value={value.enrollmentDate}
          disabled={disabled}
          onChange={(event) => {
            set({ enrollmentDate: event.target.value });
          }}
        />
      </div>

      {value.branchId !== '' && !isLoadingGrades && gradeOptions.length === 0 ? (
        <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">
          This branch has no grades yet. Initialise them on the{' '}
          <a href="/dashboard/admissions/grades" className="font-medium underline">
            Grades &amp; Sections
          </a>{' '}
          page before enrolling students.
        </p>
      ) : null}

      {value.gradeId !== '' && sectionOptions.length === 0 ? (
        <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">
          This grade has no sections for {academicYearName}. Add one on the Grades
          &amp; Sections page.
        </p>
      ) : null}

      {error !== null ? (
        <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </p>
      ) : null}

      {branches.length === 0 ? (
        <Button variant="secondary" disabled>
          No active branches
        </Button>
      ) : null}
    </div>
  );
}
