'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useMemo, useState, type FormEvent } from 'react';

import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Input } from '@/components/ui/Input';
import { MultiSelect } from '@/components/ui/MultiSelect';
import { Select } from '@/components/ui/Select';
import { MONTH_NAMES, formatMonthYear } from '@/db/schema/academic-years';
import {
  MAX_RUN_YEARS,
  academicYearRunProblem,
  planAcademicYearRun,
} from '@/lib/academic-year-runs';
import { schoolErrorMessage, schoolFetch } from '@/lib/school-client';

/**
 * Creating academic years — one, or a decade of them.
 *
 * ── Month and year, never a date picker ─────────────────────────────────
 * A session is a window, not a pair of days: a school starting "August 2025"
 * does not care whether that is the 1st or the 14th, and asking would invite
 * them to pick a day that means nothing. Unchanged since Sprint 4.
 *
 * ── The end *year* is derived and the end *month* is asked ──────────────
 * Sprint 19b. The run repeats one shape, so the only end fact that varies
 * between the sessions in it is the year — and that is a consequence of the
 * months, not a separate answer. Asking for it once per year was one field an
 * operator could make internally inconsistent, on a value that later decides
 * which session a child's fees, results and admission number are filed under.
 * `planAcademicYearRun` derives it and the preview below shows every window it
 * produced, because a run nobody can read before pressing the button is a run
 * nobody checks.
 *
 * ── The campus multi-select, and when it is absent ──────────────────────
 * Item 13: a school with one campus is not asked. `campuses` arrives empty in
 * that case — and also when a branch-bound reader can reach only their own —
 * and the server then files the run against whatever the caller's scope
 * resolves to, which is the only answer the question could have had.
 *
 * Ticking nothing at a multi-campus school means **every campus**, which is
 * what every academic year in existence already is. The hint says so, because
 * an empty multi-select otherwise reads as "nothing selected, nothing will
 * happen".
 */

const MONTH_OPTIONS = MONTH_NAMES.map((label, index) => ({
  value: String(index + 1),
  label,
}));

export interface AcademicYearFormProps {
  /** True when the school has a year marked active, so the checkbox defaults on. */
  hasActiveYear: boolean;
  /** The campuses this caller may file a session against. Empty = no control. */
  campuses: readonly { id: string; name: string }[];
}

export function AcademicYearForm({ hasActiveYear, campuses }: AcademicYearFormProps) {
  const router = useRouter();

  const currentYear = new Date().getFullYear();

  const [startMonth, setStartMonth] = useState('8');
  const [endMonth, setEndMonth] = useState('7');
  const [startYear, setStartYear] = useState(String(currentYear));
  const [years, setYears] = useState('1');
  const [branchIds, setBranchIds] = useState<string[]>([]);
  const [setAsActive, setSetAsActive] = useState(!hasActiveYear);
  const [error, setError] = useState<string | null>(null);
  const [clash, setClash] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const run = {
    startMonth: Number(startMonth),
    endMonth: Number(endMonth),
    startYear: Number(startYear),
    count: Number(years),
  };

  const problem = academicYearRunProblem(run);
  // The same planner the route uses. Two implementations of "what will this
  // create" is one too many, and the one that drifts is the preview — which is
  // the only one anybody reads before pressing the button.
  const planned = useMemo(
    () => planAcademicYearRun(run),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [run.startMonth, run.endMonth, run.startYear, run.count],
  );

  const submit = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();

    if (problem !== null) {
      setError(problem);
      return;
    }

    setIsSubmitting(true);
    setError(null);
    setClash(false);

    try {
      await schoolFetch('/api/school/academic-years', {
        method: 'POST',
        body: JSON.stringify({
          startMonth: run.startMonth,
          endMonth: run.endMonth,
          startYear: run.startYear,
          years: run.count,
          branchIds,
          setAsActive,
        }),
      });

      router.push('/dashboard/admissions/academic-years');
      router.refresh();
    } catch (caught) {
      setError(schoolErrorMessage(caught, 'Could not create the academic years.'));
      // The one refusal with somewhere to go: the year is already there, so
      // offer the list it is on rather than leaving the operator to find it.
      setClash(true);
      setIsSubmitting(false);
    }
  };

  return (
    <form
      onSubmit={(event) => {
        void submit(event);
      }}
      className="space-y-6"
      noValidate
    >
      <Card>
        <div className="grid gap-4 sm:grid-cols-2">
          <Select
            label="Start month"
            options={MONTH_OPTIONS}
            value={startMonth}
            disabled={isSubmitting}
            onChange={(event) => {
              setStartMonth(event.target.value);
            }}
          />
          <Select
            label="End month"
            options={MONTH_OPTIONS}
            hint="The year this ends in is worked out for you."
            value={endMonth}
            disabled={isSubmitting}
            onChange={(event) => {
              setEndMonth(event.target.value);
            }}
          />

          <Input
            label="First year starts"
            type="number"
            min={2000}
            max={2100}
            value={startYear}
            disabled={isSubmitting}
            onChange={(event) => {
              setStartYear(event.target.value);
            }}
          />
          <Input
            label="How many years"
            type="number"
            min={1}
            max={MAX_RUN_YEARS}
            hint={`Up to ${MAX_RUN_YEARS} at a time. Ones that already exist are skipped, not refused.`}
            value={years}
            disabled={isSubmitting}
            onChange={(event) => {
              setYears(event.target.value);
            }}
          />

          {campuses.length === 0 ? null : (
            <div className="sm:col-span-2">
              <MultiSelect
                label="Campuses"
                options={campuses.map((campus) => ({
                  value: campus.id,
                  label: campus.name,
                }))}
                value={branchIds}
                disabled={isSubmitting}
                hint="Leave every box clear for a session the whole school runs — which is what every existing year is."
                onChange={setBranchIds}
              />
            </div>
          )}

          <div className="sm:col-span-2">
            {problem === null ? (
              <div className="rounded-lg bg-surface-sunken px-3 py-2.5 text-sm text-ink">
                <p className="font-medium">
                  This will create {planned.length}{' '}
                  {planned.length === 1 ? 'year' : 'years'}
                </p>
                <ul className="mt-1.5 space-y-0.5 text-ink-muted">
                  {planned.map((year) => (
                    <li key={year.name}>
                      <strong className="text-ink">{year.name}</strong> ·{' '}
                      {formatMonthYear(year.startMonth, year.startYear)} to{' '}
                      {formatMonthYear(year.endMonth, year.endYear)}
                    </li>
                  ))}
                </ul>
              </div>
            ) : (
              <p className="text-sm text-status-warning-onSubtle">{problem}</p>
            )}
          </div>

          <label className="flex items-start gap-2 text-sm text-ink sm:col-span-2">
            <input
              type="checkbox"
              className="mt-0.5 h-4 w-4"
              checked={setAsActive}
              disabled={isSubmitting}
              onChange={(event) => {
                setSetAsActive(event.target.checked);
              }}
            />
            <span>
              Make the first of these the active academic year
              <span className="block text-xs text-ink-muted">
                New enrollments, the dashboard counts and the public application
                form all follow the active year. Only one can be active at a
                time, so a run marks its first and leaves the rest alone.
              </span>
            </span>
          </label>
        </div>
      </Card>

      {error !== null ? (
        <p
          role="alert"
          className="rounded-lg bg-status-danger-subtle px-3 py-2 text-sm text-status-danger-ink"
        >
          {error}
          {clash ? (
            <>
              {' '}
              <Link
                href="/dashboard/admissions/academic-years"
                className="font-medium underline"
              >
                Open academic years
              </Link>
            </>
          ) : null}
        </p>
      ) : null}

      <div className="flex gap-3">
        <Button type="submit" isLoading={isSubmitting} disabled={problem !== null}>
          {planned.length === 1 ? 'Create academic year' : `Create ${planned.length} years`}
        </Button>
        <Button
          type="button"
          variant="secondary"
          disabled={isSubmitting}
          onClick={() => {
            router.back();
          }}
        >
          Cancel
        </Button>
      </div>
    </form>
  );
}
