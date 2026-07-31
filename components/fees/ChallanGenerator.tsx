'use client';

import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';

import { Button } from '@/components/ui/Button';
import { Card, CardTitle } from '@/components/ui/Card';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { MONTH_NAMES } from '@/db/schema/academic-years';
import { schoolErrorMessage, schoolFetch } from '@/lib/school-client';

/**
 * Challan generation, in two modes.
 *
 * Bulk is the one that matters operationally — a school raises four hundred
 * challans on the first of the month — and it is also the one with the largest
 * blast radius, so it leads with a dry run: how many students, how many already
 * billed. Nobody should discover they double-billed a grade after the fact.
 *
 * Single mode exists for the joiner mid-term and the correction after a
 * cancellation.
 */

export interface BranchOption {
  id: string;
  name: string;
}

export interface AcademicYearOption {
  id: string;
  name: string;
  isActive: boolean;
}

export interface ChallanGeneratorProps {
  branches: readonly BranchOption[];
  academicYears: readonly AcademicYearOption[];
  /** School's configured due day, for the default due date. */
  dueDay: number;
}

interface GradeOption {
  id: string;
  label: string;
}

interface SectionOption {
  id: string;
  name: string;
}

interface StudentOption {
  studentProfileId: string;
  studentId: string;
  name: string;
  gradeName: string;
  sectionName: string;
}

interface DryRunCounts {
  total: number;
  alreadyBilled: number;
  toGenerate: number;
}

const MONTH_OPTIONS = MONTH_NAMES.map((label, index) => ({
  value: String(index + 1),
  label,
}));

function dueDateFor(month: string, year: string, dueDay: number): string {
  const day = Math.min(Math.max(dueDay, 1), 28);
  return `${year}-${month.padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

export function ChallanGenerator({
  branches,
  academicYears,
  dueDay,
}: ChallanGeneratorProps) {
  const router = useRouter();

  const activeYearId =
    academicYears.find((year) => year.isActive)?.id ?? academicYears[0]?.id ?? '';

  const now = new Date();
  const [mode, setMode] = useState<'bulk' | 'single'>('bulk');
  const [academicYearId, setAcademicYearId] = useState(activeYearId);
  const [billingMonth, setBillingMonth] = useState(String(now.getUTCMonth() + 1));
  const [billingYear, setBillingYear] = useState(String(now.getUTCFullYear()));
  const [dueDate, setDueDate] = useState(
    dueDateFor(String(now.getUTCMonth() + 1), String(now.getUTCFullYear()), dueDay),
  );

  const [branchId, setBranchId] = useState(branches.length === 1 ? (branches[0]?.id ?? '') : '');
  const [gradeId, setGradeId] = useState('');
  const [sectionId, setSectionId] = useState('');
  const [grades, setGrades] = useState<GradeOption[]>([]);
  const [sections, setSections] = useState<SectionOption[]>([]);

  const [studentSearch, setStudentSearch] = useState('');
  const [students, setStudents] = useState<StudentOption[]>([]);
  const [studentProfileId, setStudentProfileId] = useState('');

  const [dryRun, setDryRun] = useState<DryRunCounts | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // The due date follows the selected month until the admin overrides it.
  useEffect(() => {
    setDueDate(dueDateFor(billingMonth, billingYear, dueDay));
  }, [billingMonth, billingYear, dueDay]);

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

  // Student lookup for single mode.
  useEffect(() => {
    if (mode !== 'single' || studentSearch.trim().length < 2) {
      setStudents([]);
      return;
    }

    const controller = new AbortController();
    const timer = setTimeout(() => {
      const query = new URLSearchParams({
        search: studentSearch.trim(),
        limit: '10',
        ...(academicYearId === '' ? {} : { academicYearId }),
      });

      void schoolFetch<{ students: StudentOption[] }>(
        `/api/school/students?${query.toString()}`,
        { signal: controller.signal },
      )
        .then((payload) => {
          setStudents(payload.students);
        })
        .catch(() => {
          setStudents([]);
        });
    }, 250);

    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [mode, studentSearch, academicYearId]);

  const runDryRun = useCallback(async () => {
    if (gradeId === '' || academicYearId === '') {
      setDryRun(null);
      return;
    }

    const query = new URLSearchParams({
      gradeId,
      academicYearId,
      billingMonth,
      billingYear,
      ...(sectionId === '' ? {} : { sectionId }),
    });

    try {
      setDryRun(
        await schoolFetch<DryRunCounts>(
          `/api/school/fees/challans/bulk-generate?${query.toString()}`,
        ),
      );
      setError(null);
    } catch (caught) {
      setDryRun(null);
      setError(schoolErrorMessage(caught, 'Could not check who would be billed.'));
    }
  }, [gradeId, sectionId, academicYearId, billingMonth, billingYear]);

  useEffect(() => {
    if (mode === 'bulk') void runDryRun();
  }, [mode, runDryRun]);

  const generateBulk = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    setResult(null);

    try {
      const payload = await schoolFetch<{
        generated: number;
        skipped: number;
        errors: Array<{ message: string }>;
      }>('/api/school/fees/challans/bulk-generate', {
        method: 'POST',
        body: JSON.stringify({
          gradeId,
          sectionId: sectionId === '' ? null : sectionId,
          billingMonth: Number(billingMonth),
          billingYear: Number(billingYear),
          academicYearId,
          dueDate,
        }),
      });

      const parts = [`${payload.generated} challan${payload.generated === 1 ? '' : 's'} generated`];
      if (payload.skipped > 0) parts.push(`${payload.skipped} skipped (already billed)`);
      if (payload.errors.length > 0) {
        parts.push(`${payload.errors.length} failed: ${payload.errors[0]?.message ?? ''}`);
      }

      setResult(parts.join(' · '));
      await runDryRun();
      router.refresh();
    } catch (caught) {
      setError(schoolErrorMessage(caught, 'Could not generate the challans.'));
    } finally {
      setBusy(false);
    }
  };

  const generateSingle = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    setResult(null);

    try {
      const payload = await schoolFetch<{ challan: { id: string } }>(
        '/api/school/fees/challans',
        {
          method: 'POST',
          body: JSON.stringify({
            studentProfileId,
            billingMonth: Number(billingMonth),
            billingYear: Number(billingYear),
            academicYearId,
            dueDate,
          }),
        },
      );

      router.push(`/dashboard/fees/challans/${payload.challan.id}`);
      router.refresh();
    } catch (caught) {
      setError(schoolErrorMessage(caught, 'Could not generate the challan.'));
      setBusy(false);
    }
  };

  const selectedStudent = students.find(
    (student) => student.studentProfileId === studentProfileId,
  );

  return (
    <div className="space-y-6">
      <div role="tablist" aria-label="Generation mode" className="flex gap-2">
        {(['bulk', 'single'] as const).map((value) => (
          <button
            key={value}
            type="button"
            role="tab"
            aria-selected={mode === value}
            onClick={() => {
              setMode(value);
              setResult(null);
              setError(null);
            }}
            className={
              mode === value
                ? 'rounded-full bg-brand-primary px-4 py-1.5 text-sm font-medium text-white'
                : 'rounded-full bg-slate-100 px-4 py-1.5 text-sm font-medium text-slate-600 hover:bg-slate-200'
            }
          >
            {value === 'bulk' ? 'Whole grade or section' : 'One student'}
          </button>
        ))}
      </div>

      <Card header={<CardTitle title="Billing period" />}>
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <Select
            label="Academic year"
            options={academicYears.map((year) => ({
              value: year.id,
              label: year.isActive ? `${year.name} (active)` : year.name,
            }))}
            value={academicYearId}
            disabled={busy}
            onChange={(event) => {
              setAcademicYearId(event.target.value);
            }}
          />
          <Select
            label="Billing month"
            options={MONTH_OPTIONS}
            value={billingMonth}
            disabled={busy}
            onChange={(event) => {
              setBillingMonth(event.target.value);
            }}
          />
          <Input
            label="Billing year"
            type="number"
            min={2000}
            max={2100}
            value={billingYear}
            disabled={busy}
            onChange={(event) => {
              setBillingYear(event.target.value);
            }}
          />
          <Input
            label="Due date"
            type="date"
            value={dueDate}
            disabled={busy}
            hint={`Defaults to the ${dueDay}th`}
            onChange={(event) => {
              setDueDate(event.target.value);
            }}
          />
        </div>
        <p className="mt-4 rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-600">
          Only <strong>monthly</strong> fee heads are billed. Annual and one-time
          heads are charged separately, so a family is not billed the annual
          charges twelve times a year.
        </p>
      </Card>

      {mode === 'bulk' ? (
        <Card header={<CardTitle title="Who gets billed" />}>
          <div className="grid gap-4 sm:grid-cols-3">
            <Select
              label="Branch"
              placeholder="Select a branch"
              options={branches.map((branch) => ({ value: branch.id, label: branch.name }))}
              value={branchId}
              disabled={busy}
              onChange={(event) => {
                setBranchId(event.target.value);
                setGradeId('');
                setSectionId('');
              }}
            />
            <Select
              label="Grade"
              placeholder={branchId === '' ? 'Choose a branch first' : 'Select a grade'}
              options={grades.map((grade) => ({ value: grade.id, label: grade.label }))}
              value={gradeId}
              disabled={busy || branchId === ''}
              onChange={(event) => {
                setGradeId(event.target.value);
                setSectionId('');
              }}
            />
            <Select
              label="Section"
              placeholder="All sections in this grade"
              options={[
                { value: '', label: 'All sections' },
                ...sections.map((section) => ({ value: section.id, label: section.name })),
              ]}
              value={sectionId}
              disabled={busy || gradeId === ''}
              onChange={(event) => {
                setSectionId(event.target.value);
              }}
            />
          </div>

          {dryRun !== null ? (
            <div className="mt-4 rounded-lg border border-slate-200 p-4">
              <p className="text-sm text-slate-700">
                <strong className="text-slate-900">{dryRun.total}</strong> actively
                enrolled student{dryRun.total === 1 ? '' : 's'} in this selection.
              </p>
              {dryRun.alreadyBilled > 0 ? (
                <p className="mt-1 text-sm text-amber-800">
                  {dryRun.alreadyBilled} already {dryRun.alreadyBilled === 1 ? 'has' : 'have'} a
                  challan for {MONTH_NAMES[Number(billingMonth) - 1]} {billingYear} and will be
                  skipped.
                </p>
              ) : null}
              <p className="mt-1 text-sm font-medium text-slate-900">
                {dryRun.toGenerate} challan{dryRun.toGenerate === 1 ? '' : 's'} will be
                generated.
              </p>
            </div>
          ) : null}

          <Button
            className="mt-4"
            isLoading={busy}
            disabled={gradeId === '' || dryRun === null || dryRun.toGenerate === 0}
            onClick={() => {
              void generateBulk();
            }}
          >
            Generate {dryRun?.toGenerate ?? 0} challans
          </Button>
        </Card>
      ) : (
        <Card header={<CardTitle title="Student" />}>
          <Input
            label="Find a student"
            placeholder="Name or student ID"
            value={studentSearch}
            disabled={busy}
            onChange={(event) => {
              setStudentSearch(event.target.value);
              setStudentProfileId('');
            }}
          />

          {students.length > 0 ? (
            <ul className="mt-3 divide-y divide-slate-100 rounded-lg border border-slate-200">
              {students.map((student) => (
                <li key={student.studentProfileId}>
                  <button
                    type="button"
                    onClick={() => {
                      setStudentProfileId(student.studentProfileId);
                    }}
                    className={
                      student.studentProfileId === studentProfileId
                        ? 'flex w-full items-center justify-between bg-brand-primary/10 px-4 py-2 text-left text-sm'
                        : 'flex w-full items-center justify-between px-4 py-2 text-left text-sm hover:bg-slate-50'
                    }
                  >
                    <span className="font-medium text-slate-900">{student.name}</span>
                    <span className="text-xs text-slate-500">
                      {student.studentId} · {student.gradeName} {student.sectionName}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          ) : null}

          {selectedStudent !== undefined ? (
            <p className="mt-3 rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-600">
              Generating for <strong>{selectedStudent.name}</strong> —{' '}
              {selectedStudent.gradeName} {selectedStudent.sectionName}. Amounts come
              from that grade&rsquo;s fee structure, with the student&rsquo;s
              concessions applied.
            </p>
          ) : null}

          <Button
            className="mt-4"
            isLoading={busy}
            disabled={studentProfileId === ''}
            onClick={() => {
              void generateSingle();
            }}
          >
            Generate challan
          </Button>
        </Card>
      )}

      {result !== null ? (
        <p className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
          {result}
        </p>
      ) : null}

      {error !== null ? (
        <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </p>
      ) : null}
    </div>
  );
}
