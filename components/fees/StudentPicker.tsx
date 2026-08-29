'use client';

import { useEffect, useRef, useState } from 'react';

import { Input } from '@/components/ui/Input';
import { schoolErrorMessage, schoolFetch } from '@/lib/school-client';

/**
 * Search-and-pick for one student.
 *
 * Shared by the concessions screen and single-challan generation, because both
 * ask the same question and neither should invent its own answer. Search hits
 * the existing `/api/school/students` endpoint, which is already tenant-scoped
 * — a name typed here can only ever match this school's own children.
 */

export interface PickedStudent {
  studentProfileId: string;
  studentId: string;
  name: string;
  gradeName: string;
  sectionName: string;
}

export interface StudentPickerProps {
  /** Restricts results to one year's enrollments. */
  academicYearId?: string | undefined;
  selected: PickedStudent | null;
  onSelect: (student: PickedStudent | null) => void;
  label?: string;
}

interface StudentsResponse {
  students: Array<{
    studentProfileId: string;
    studentId: string;
    name: string;
    gradeName: string;
    sectionName: string;
  }>;
}

/** Long enough that typing a name is one request, not eight. */
const DEBOUNCE_MS = 300;

export function StudentPicker({
  academicYearId,
  selected,
  onSelect,
  label = 'Find a student',
}: StudentPickerProps) {
  const [term, setTerm] = useState('');
  const [results, setResults] = useState<PickedStudent[]>([]);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Guards against a slow early request landing after a fast later one and
  // overwriting the results the user is actually looking at.
  const requestRef = useRef(0);

  useEffect(() => {
    const trimmed = term.trim();

    if (trimmed.length < 2) {
      setResults([]);
      setSearching(false);
      return;
    }

    const requestId = requestRef.current + 1;
    requestRef.current = requestId;
    setSearching(true);

    const timer = setTimeout(() => {
      const query = new URLSearchParams({ search: trimmed, limit: '10' });
      if (academicYearId !== undefined && academicYearId !== '') {
        query.set('academicYearId', academicYearId);
      }

      schoolFetch<StudentsResponse>(`/api/school/students?${query.toString()}`)
        .then((payload) => {
          if (requestRef.current !== requestId) return;
          setResults(payload.students);
          setError(null);
        })
        .catch((caught: unknown) => {
          if (requestRef.current !== requestId) return;
          setError(schoolErrorMessage(caught, 'Could not search students.'));
        })
        .finally(() => {
          if (requestRef.current === requestId) setSearching(false);
        });
    }, DEBOUNCE_MS);

    return () => {
      clearTimeout(timer);
    };
  }, [term, academicYearId]);

  if (selected !== null) {
    return (
      <div className="rounded-lg border border-line bg-surface-sunken px-4 py-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="font-medium text-ink">{selected.name}</p>
            <p className="text-xs text-ink-muted">
              <span className="font-mono">{selected.studentId}</span> ·{' '}
              {selected.gradeName} {selected.sectionName}
            </p>
          </div>
          <button
            type="button"
            className="text-sm font-medium text-brand-primary hover:underline"
            onClick={() => {
              onSelect(null);
              setTerm('');
              setResults([]);
            }}
          >
            Change
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <Input
        label={label}
        value={term}
        placeholder="Name or student ID"
        autoComplete="off"
        hint={
          term.trim().length > 0 && term.trim().length < 2
            ? 'Type at least two characters.'
            : undefined
        }
        onChange={(event) => {
          setTerm(event.target.value);
        }}
      />

      {error !== null ? (
        <p role="alert" className="text-sm text-status-danger-ink">
          {error}
        </p>
      ) : null}

      {searching ? <p className="text-sm text-ink-muted">Searching…</p> : null}

      {!searching && term.trim().length >= 2 && results.length === 0 ? (
        <p className="text-sm text-ink-muted">No students match that.</p>
      ) : null}

      {results.length > 0 ? (
        <ul className="divide-y divide-line rounded-lg border border-line">
          {results.map((student) => (
            <li key={student.studentProfileId}>
              <button
                type="button"
                className="flex w-full items-center justify-between gap-3 px-4 py-2.5 text-left hover:bg-surface-hover"
                onClick={() => {
                  onSelect(student);
                  setResults([]);
                }}
              >
                <span className="font-medium text-ink">{student.name}</span>
                <span className="text-xs text-ink-muted">
                  <span className="font-mono">{student.studentId}</span> ·{' '}
                  {student.gradeName} {student.sectionName}
                </span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
