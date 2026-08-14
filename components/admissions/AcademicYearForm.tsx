'use client';

import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';

import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import {
  academicYearName,
  academicYearRangeProblem,
  MONTH_NAMES,
} from '@/db/schema/academic-years';
import { schoolErrorMessage, schoolFetch } from '@/lib/school-client';

/**
 * Creating an academic year.
 *
 * Month and year are separate inputs rather than two date pickers because a
 * session is a window, not a pair of days: a school starting "August 2025" does
 * not care whether that is the 1st or the 14th, and asking would invite them to
 * pick a day that means nothing.
 */

const MONTH_OPTIONS = MONTH_NAMES.map((label, index) => ({
  value: String(index + 1),
  label,
}));

export interface AcademicYearFormProps {
  /** True when the school has no active year, so the checkbox defaults on. */
  hasActiveYear: boolean;
}

export function AcademicYearForm({ hasActiveYear }: AcademicYearFormProps) {
  const router = useRouter();

  const currentYear = new Date().getFullYear();

  const [startMonth, setStartMonth] = useState('8');
  const [startYear, setStartYear] = useState(String(currentYear));
  const [endMonth, setEndMonth] = useState('7');
  const [endYear, setEndYear] = useState(String(currentYear + 1));
  const [setAsActive, setSetAsActive] = useState(!hasActiveYear);
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const range = {
    startMonth: Number(startMonth),
    startYear: Number(startYear),
    endMonth: Number(endMonth),
    endYear: Number(endYear),
  };

  const problem = academicYearRangeProblem(range);
  const preview =
    problem === null ? academicYearName(range.startYear, range.endYear) : '—';

  const submit = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();

    if (problem !== null) {
      setError(problem);
      return;
    }

    setIsSubmitting(true);
    setError(null);

    try {
      await schoolFetch('/api/school/academic-years', {
        method: 'POST',
        body: JSON.stringify({ ...range, setAsActive }),
      });

      router.push('/dashboard/admissions/academic-years');
      router.refresh();
    } catch (caught) {
      setError(schoolErrorMessage(caught, 'Could not create the academic year.'));
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
          <Input
            label="Start year"
            type="number"
            min={2000}
            max={2100}
            value={startYear}
            disabled={isSubmitting}
            onChange={(event) => {
              setStartYear(event.target.value);
            }}
          />

          <Select
            label="End month"
            options={MONTH_OPTIONS}
            value={endMonth}
            disabled={isSubmitting}
            onChange={(event) => {
              setEndMonth(event.target.value);
            }}
          />
          <Input
            label="End year"
            type="number"
            min={2000}
            max={2100}
            value={endYear}
            disabled={isSubmitting}
            onChange={(event) => {
              setEndYear(event.target.value);
            }}
          />

          <div className="sm:col-span-2">
            <p className="text-sm text-ink-muted">
              This year will be called{' '}
              <strong className="text-ink">{preview}</strong>.
            </p>
            {problem !== null ? (
              <p className="mt-1 text-sm text-status-warning-onSubtle">{problem}</p>
            ) : null}
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
              Make this the active academic year
              <span className="block text-xs text-ink-muted">
                New enrolments, the dashboard counts and the public application
                form all follow the active year. Only one can be active at a time.
              </span>
            </span>
          </label>
        </div>
      </Card>

      {error !== null ? (
        <p role="alert" className="rounded-lg bg-status-danger-subtle px-3 py-2 text-sm text-status-danger-ink">
          {error}
        </p>
      ) : null}

      <div className="flex gap-3">
        <Button type="submit" isLoading={isSubmitting} disabled={problem !== null}>
          Create academic year
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
