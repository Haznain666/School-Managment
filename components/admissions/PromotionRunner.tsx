'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';

import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card, CardTitle } from '@/components/ui/Card';
import { Select } from '@/components/ui/Select';

export interface GradeOption {
  id: string;
  label: string;
}

export interface YearOption {
  id: string;
  name: string;
  /**
   * `startYear * 12 + startMonth`, so years can be ordered without shipping
   * two fields to compare. An academic year is stored as a start month and
   * year rather than a date, and ordering on the year alone would put a June
   * start ahead of the previous September's — which is the shape a Pakistani
   * school year actually has.
   */
  startsAt: number;
}

export interface SectionOption {
  id: string;
  gradeId: string;
  /** Sections exist once per academic year — see `destinations`. */
  academicYearId: string;
  label: string;
}

export interface PromotionRunnerProps {
  grades: readonly GradeOption[];
  years: readonly YearOption[];
  activeYearId: string | null;
  /** Every section in the school, so the destination list can be filtered. */
  sections: readonly SectionOption[];
}

type Decision = 'promote' | 'retain' | 'graduate';

interface DecisionRow {
  id: string;
  decision: Decision;
  toSectionId: string | null;
  note: string | null;
  name: string;
  studentId: string;
  fromSectionName: string;
}

const DECISION_LABELS: Record<Decision, string> = {
  promote: 'Promote',
  retain: 'Retain',
  graduate: 'Graduate',
};

/**
 * Academic-year rollover: pick a class and two years, review every child, apply.
 *
 * ── The review step is the feature ───────────────────────────────────────
 * The list below is not a confirmation dialog with a count on it. Promotion is
 * the only action in this application that touches every child at once, and the
 * only person who can tell whether "promote all 34" is right is somebody
 * reading 34 names. So the draft is built server-side, shown in full, and
 * nothing reaches `student_enrollments` until Apply.
 *
 * ── Retain and graduate carry no destination, on purpose ─────────────────
 * A retained child stays in the section they are in — read from their
 * enrolment when the run is applied — and a graduate goes nowhere. Offering a
 * class picker for either would create a second place the answer could be
 * wrong, and the picker is hidden rather than disabled so there is nothing to
 * misread.
 */
export function PromotionRunner({
  grades,
  years,
  activeYearId,
  sections,
}: PromotionRunnerProps) {
  const [gradeId, setGradeId] = useState('');
  const [fromYear, setFromYear] = useState(activeYearId ?? '');
  const [toYear, setToYear] = useState('');

  const [runId, setRunId] = useState<string | null>(null);
  const [rows, setRows] = useState<DecisionRow[]>([]);
  const [applied, setApplied] = useState<{
    promoted: number;
    retained: number;
    graduated: number;
  } | null>(null);

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);

  /**
   * Sections in the receiving year that a promoted child could land in.
   *
   * **Filtered by year, and that is not optional.** A section exists once per
   * academic year, so an unfiltered list offers "Grade 5 — A" three times with
   * nothing to tell them apart, and two of the three are sections of years the
   * PATCH route will refuse. Found in the browser against a school with three
   * years: the picker had 21 entries for 7 classes.
   *
   * The grade being promoted *out of* is also excluded — promoting a class
   * into itself is a retain, which is its own decision.
   */
  const destinations = useMemo(
    () =>
      sections.filter(
        (section) => section.gradeId !== gradeId && section.academicYearId === toYear,
      ),
    [sections, gradeId, toYear],
  );

  const fromYearStartsAt = useMemo(
    () => years.find((year) => year.id === fromYear)?.startsAt ?? null,
    [years, fromYear],
  );

  const receivingYears = useMemo(
    () =>
      fromYearStartsAt === null
        ? []
        : years.filter((year) => year.startsAt > fromYearStartsAt),
    [years, fromYearStartsAt],
  );

  // Changing the year being left can strip the destination out from under the
  // picker. Clearing it is better than leaving a stale id that the route would
  // then refuse for a reason nobody can see on screen.
  useEffect(() => {
    if (toYear !== '' && !receivingYears.some((year) => year.id === toYear)) {
      setToYear('');
    }
  }, [receivingYears, toYear]);

  const load = useCallback(async (id: string) => {
    const response = await fetch(`/api/school/promotions/${id}`);
    const payload = (await response.json()) as {
      ok: boolean;
      data?: { decisions: DecisionRow[] };
    };
    if (payload.ok === true && payload.data !== undefined) setRows(payload.data.decisions);
  }, []);

  const open = useCallback(async () => {
    setBusy(true);
    setError(null);
    setNotice(null);

    try {
      const response = await fetch('/api/school/promotions', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          gradeId,
          fromAcademicYearId: fromYear,
          toAcademicYearId: toYear,
        }),
      });

      const payload = (await response.json()) as {
        ok: boolean;
        data?: { runId: string; students: number; nextGrade: { name: string } | null };
        error?: { message: string };
      };

      if (!response.ok || payload.ok !== true || payload.data === undefined) {
        setError(payload.error?.message ?? 'Could not open that promotion.');
        return;
      }

      setRunId(payload.data.runId);
      setNotice(
        payload.data.nextGrade === null
          ? `${payload.data.students} students. This class has nothing above it, so everyone defaults to graduating.`
          : `${payload.data.students} students, defaulting to ${payload.data.nextGrade.name}.`,
      );
      await load(payload.data.runId);
    } catch {
      setError('Could not open that promotion.');
    } finally {
      setBusy(false);
    }
  }, [gradeId, fromYear, toYear, load]);

  /** Local edit; the server is told when Apply is pressed, in one request. */
  const setRow = useCallback((id: string, patch: Partial<DecisionRow>) => {
    setRows((current) =>
      current.map((row) => (row.id === id ? { ...row, ...patch } : row)),
    );
    setConfirming(false);
  }, []);

  const setAll = useCallback((decision: Decision) => {
    setRows((current) =>
      current.map((row) => ({
        ...row,
        decision,
        toSectionId: decision === 'promote' ? row.toSectionId : null,
      })),
    );
    setConfirming(false);
  }, []);

  const apply = useCallback(async () => {
    if (runId === null) return;

    setBusy(true);
    setError(null);
    setNotice(null);

    try {
      // Saved and applied as two requests rather than one: the decisions are
      // worth keeping even if the apply refuses, so a rejected run can be
      // corrected on screen rather than re-entered from the start.
      const save = await fetch(`/api/school/promotions/${runId}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          decisions: rows.map((row) => ({
            id: row.id,
            decision: row.decision,
            toSectionId: row.toSectionId,
            note: row.note,
          })),
        }),
      });

      const savePayload = (await save.json()) as {
        ok: boolean;
        error?: { message: string };
      };

      if (!save.ok || savePayload.ok !== true) {
        setError(savePayload.error?.message ?? 'Could not save those decisions.');
        return;
      }

      const response = await fetch(`/api/school/promotions/${runId}/apply`, {
        method: 'POST',
      });

      const payload = (await response.json()) as {
        ok: boolean;
        data?: { result: { promoted: number; retained: number; graduated: number } };
        error?: { message: string };
      };

      if (!response.ok || payload.ok !== true || payload.data === undefined) {
        setError(payload.error?.message ?? 'Could not carry out that promotion.');
        return;
      }

      setApplied(payload.data.result);
      setConfirming(false);
    } catch {
      setError('Could not carry out that promotion.');
    } finally {
      setBusy(false);
    }
  }, [runId, rows]);

  const missingSection = rows.filter(
    (row) => row.decision === 'promote' && row.toSectionId === null,
  ).length;

  const banner = (
    <>
      {error !== null ? (
        <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </p>
      ) : null}
      {notice !== null ? (
        <p role="status" className="rounded-lg bg-slate-100 px-3 py-2 text-sm text-slate-700">
          {notice}
        </p>
      ) : null}
    </>
  );

  if (applied !== null) {
    return (
      <div className="space-y-4">
        <Card header={<CardTitle title="Promotion complete" />}>
          <div className="flex flex-wrap gap-2">
            <Badge variant="success">{applied.promoted} promoted</Badge>
            {applied.retained > 0 ? (
              <Badge variant="warning">{applied.retained} retained</Badge>
            ) : null}
            {applied.graduated > 0 ? (
              <Badge variant="neutral">{applied.graduated} graduated</Badge>
            ) : null}
          </div>
          <p className="mt-4 text-sm text-slate-600">
            Last year&rsquo;s enrolments are still there and still say which
            section each child was in — promotion adds rows, it does not edit
            them.
          </p>
          <div className="mt-4">
            <Button
              onClick={() => {
                setApplied(null);
                setRunId(null);
                setRows([]);
                setGradeId('');
                setToYear('');
              }}
            >
              Promote another class
            </Button>
          </div>
        </Card>
      </div>
    );
  }

  if (runId === null) {
    return (
      <div className="space-y-4">
        {banner}
        <Card
          header={
            <CardTitle
              title="Which class, and into which year?"
              description="One class at a time. You will see every student before anything changes."
            />
          }
        >
          <div className="grid gap-4 sm:grid-cols-3">
            <Select
              label="Class"
              options={[
                { value: '', label: 'Choose a class…' },
                ...grades.map((grade) => ({ value: grade.id, label: grade.label })),
              ]}
              value={gradeId}
              onChange={(event) => {
                setGradeId(event.target.value);
              }}
            />
            <Select
              label="Currently in"
              options={[
                { value: '', label: 'Choose a year…' },
                ...years.map((year) => ({ value: year.id, label: year.name })),
              ]}
              value={fromYear}
              onChange={(event) => {
                setFromYear(event.target.value);
              }}
            />
            {/*
              Only years that start *after* the one being left.
              Filtering on `id !== fromYear` — which this did until it was
              tried against a school with two years — offered the previous
              year as a destination, so "promotion" could move a class
              backwards into a year that has already happened. The route
              refuses it too; this is what stops it being offered.
            */}
            <Select
              label="Moving into"
              options={[
                { value: '', label: 'Choose a year…' },
                ...years
                  .filter((year) => year.startsAt > (fromYearStartsAt ?? Infinity))
                  .map((year) => ({ value: year.id, label: year.name })),
              ]}
              value={toYear}
              hint={
                fromYearStartsAt !== null && receivingYears.length === 0
                  ? 'There is no later academic year to move into yet.'
                  : undefined
              }
              onChange={(event) => {
                setToYear(event.target.value);
              }}
            />
          </div>

          <div className="mt-4">
            <Button
              isLoading={busy}
              disabled={gradeId === '' || fromYear === '' || toYear === ''}
              onClick={() => {
                void open();
              }}
            >
              Build the list
            </Button>
          </div>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {banner}

      <Card
        header={
          <CardTitle
            title="Review every student"
            description="Nothing has been changed yet."
            action={
              <div className="flex flex-nowrap gap-2 whitespace-nowrap">
                {(['promote', 'retain', 'graduate'] as const).map((decision) => (
                  <Button
                    key={decision}
                    variant="secondary"
                    size="sm"
                    onClick={() => {
                      setAll(decision);
                    }}
                  >
                    All {DECISION_LABELS[decision].toLowerCase()}
                  </Button>
                ))}
              </div>
            }
          />
        }
        className="p-0"
      >
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th scope="col" className="px-4 py-3 font-medium">Student</th>
                <th scope="col" className="px-4 py-3 font-medium">Now in</th>
                <th scope="col" className="px-4 py-3 font-medium">Decision</th>
                <th scope="col" className="px-4 py-3 font-medium">Goes to</th>
                <th scope="col" className="px-4 py-3 font-medium">Note</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rows.map((row) => (
                <tr key={row.id}>
                  <td className="px-4 py-2">
                    <span className="font-medium text-slate-900">{row.name}</span>
                    <span className="block font-mono text-xs text-slate-500">
                      {row.studentId}
                    </span>
                  </td>
                  <td className="px-4 py-2 text-slate-600">{row.fromSectionName}</td>
                  <td className="px-4 py-2">
                    <select
                      aria-label={`Decision for ${row.name}`}
                      className="rounded-lg border border-slate-300 px-2 py-1 text-sm"
                      value={row.decision}
                      onChange={(event) => {
                        const decision = event.target.value as Decision;
                        setRow(row.id, {
                          decision,
                          toSectionId: decision === 'promote' ? row.toSectionId : null,
                        });
                      }}
                    >
                      {(['promote', 'retain', 'graduate'] as const).map((decision) => (
                        <option key={decision} value={decision}>
                          {DECISION_LABELS[decision]}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="px-4 py-2">
                    {row.decision === 'promote' ? (
                      <select
                        aria-label={`Class for ${row.name}`}
                        className="rounded-lg border border-slate-300 px-2 py-1 text-sm"
                        value={row.toSectionId ?? ''}
                        onChange={(event) => {
                          setRow(row.id, { toSectionId: event.target.value || null });
                        }}
                      >
                        <option value="">Choose…</option>
                        {destinations.map((section) => (
                          <option key={section.id} value={section.id}>
                            {section.label}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <span className="text-slate-400">
                        {row.decision === 'retain' ? 'Stays put' : '—'}
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-2 text-xs text-amber-800">{row.note ?? ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      {missingSection > 0 ? (
        <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">
          {missingSection} student{missingSection === 1 ? ' has' : 's have'} no
          class chosen. Pick one for each, or change them to retain.
        </p>
      ) : null}

      <div className="flex flex-wrap items-center gap-3">
        {confirming ? (
          <>
            <span className="text-sm text-slate-700">
              Move {rows.length} student{rows.length === 1 ? '' : 's'}? This is
              not a single click to undo.
            </span>
            <Button
              isLoading={busy}
              onClick={() => {
                void apply();
              }}
            >
              Apply
            </Button>
            <Button
              variant="ghost"
              disabled={busy}
              onClick={() => {
                setConfirming(false);
              }}
            >
              Cancel
            </Button>
          </>
        ) : (
          <>
            <Button
              disabled={missingSection > 0}
              onClick={() => {
                setConfirming(true);
                setError(null);
              }}
            >
              Apply promotion
            </Button>
            <Button
              variant="ghost"
              disabled={busy}
              onClick={() => {
                void fetch(`/api/school/promotions/${runId}`, { method: 'DELETE' });
                setRunId(null);
                setRows([]);
                setNotice(null);
              }}
            >
              Discard
            </Button>
          </>
        )}
      </div>
    </div>
  );
}
