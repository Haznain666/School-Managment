'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useState } from 'react';

import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card, CardTitle } from '@/components/ui/Card';
import { DataTable, type DataTableColumn } from '@/components/ui/DataTable';
import { Select } from '@/components/ui/Select';

export interface GradeOption {
  id: string;
  label: string;
  /** The campus that owns this class. A promotion never leaves it. */
  branchId: string;
  branchName: string | null;
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
  /** The campus of the grade this section belongs to — item 15c. */
  branchId: string;
  /** Sections exist once per academic year — see `destinations`. */
  academicYearId: string;
  label: string;
}

export interface PromotionRunnerProps {
  grades: readonly GradeOption[];
  years: readonly YearOption[];
  activeYearId: string | null;
  /** Every section in scope, so the destination list can be filtered. */
  sections: readonly SectionOption[];
  /**
   * The campus chosen in the selector above, or null for every one in scope.
   *
   * Passed only so the *Copy sections* button can tell the server which campus
   * to build. The destination filter does not read it — that is decided by the
   * sending grade's own campus, which is a fact about the class rather than
   * about what the operator happens to be looking at.
   */
  selectedBranchId?: string | null;
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
 * enrollment when the run is applied — and a graduate goes nowhere. Offering a
 * class picker for either would create a second place the answer could be
 * wrong, and the picker is hidden rather than disabled so there is nothing to
 * misread.
 */
export function PromotionRunner({
  grades,
  years,
  activeYearId,
  sections,
  selectedBranchId = null,
}: PromotionRunnerProps) {
  const router = useRouter();
  const [gradeId, setGradeId] = useState('');
  const [fromYear, setFromYear] = useState(activeYearId ?? '');
  const [toYear, setToYear] = useState('');
  const [copying, setCopying] = useState(false);

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
  const sendingGrade = useMemo(
    () => grades.find((grade) => grade.id === gradeId) ?? null,
    [grades, gradeId],
  );

  const destinations = useMemo(
    () =>
      sections.filter(
        (section) =>
          section.gradeId !== gradeId &&
          section.academicYearId === toYear &&
          /*
           * Item 15c: a promotion never crosses a campus.
           *
           * Moving a child between campuses is a *transfer* — its own screen,
           * its own fee split, its own record — so those sections are not
           * offered here at all rather than offered and then refused. The apply
           * route re-checks it with a 422; this is what stops the operator ever
           * reaching that.
           */
          (sendingGrade === null || section.branchId === sendingGrade.branchId),
      ),
    [sections, gradeId, toYear, sendingGrade],
  );

  const receivingYearName = useMemo(
    () => years.find((year) => year.id === toYear)?.name ?? null,
    [years, toYear],
  );

  /**
   * Why the destination list is empty, in the words the operator needs.
   *
   * ── This is the defect, not the dropdown ────────────────────────────────
   * The filter above was always correct: a receiving year with no sections has
   * no destinations. What was wrong is that the screen said *nothing*, so an
   * empty `<select>` read as a broken control — and the operator's next move
   * was to report a bug rather than to go and build next year's classes, which
   * is what they had actually come here to do.
   *
   * Three distinguishable states, because the answer to each is different:
   *   · `none` — the receiving year has no sections at all. Offer the copy.
   *   · `other-campus` — it has sections, but none at this class's campus.
   *     Copying would build the wrong campus's ladder, so it is not offered.
   *   · `null` — there are destinations, or nothing has been chosen yet.
   */
  const emptyReason = useMemo((): 'none' | 'other-campus' | null => {
    if (toYear === '' || destinations.length > 0) return null;

    const inYear = sections.filter(
      (section) => section.academicYearId === toYear && section.gradeId !== gradeId,
    );

    return inYear.length === 0 ? 'none' : 'other-campus';
  }, [sections, destinations, gradeId, toYear]);

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

  /**
   * Build the receiving year's classes from this year's — item 15b.
   *
   * ── Why this button is on the promotion screen at all ───────────────────
   * Because this is where the need is discovered. An operator finds out that
   * next year has no sections at the moment they try to promote into it, and
   * sending them to Grades & sections to create twelve classes by hand — then
   * back here to start again — is how a screen earns the reputation of being
   * broken. The link is still offered beside it, for the school that wants to
   * build them deliberately.
   *
   * A full reload rather than a refetch: sections are server props on this
   * page, and `router.refresh()` on a client component holding an open run
   * would leave the new sections invisible until something else re-rendered.
   * The copy is only ever pressed before a run is built, so there is nothing
   * unsaved to lose.
   */
  const copySections = useCallback(async () => {
    if (fromYear === '' || toYear === '') return;

    setCopying(true);
    setError(null);
    setNotice(null);

    try {
      const response = await fetch('/api/school/sections/copy', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          fromAcademicYearId: fromYear,
          toAcademicYearId: toYear,
          branchId: selectedBranchId,
        }),
      });

      const payload = (await response.json()) as {
        ok: boolean;
        data?: { created: number; skipped: number; toName: string };
        error?: { message: string };
      };

      if (!response.ok || payload.ok !== true || payload.data === undefined) {
        setError(payload.error?.message ?? 'Could not copy those sections.');
        return;
      }

      const { created, skipped, toName } = payload.data;
      setNotice(
        `${created} ${created === 1 ? 'section' : 'sections'} created in ${toName}` +
          (skipped === 0 ? '.' : `, ${skipped} already existed.`),
      );

      // The new sections are server props. See the docblock.
      router.refresh();
    } catch {
      setError('Could not copy those sections.');
    } finally {
      setCopying(false);
    }
  }, [fromYear, toYear, selectedBranchId, router]);

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

  /**
   * The explanation that used to be missing — item 15b.
   *
   * Named rather than hinted: "Nursery 2027-28 has no sections yet" is
   * something an operator can act on, and "no options" is not. The year is
   * spelled out because the receiving year is two dropdowns away from where
   * this appears, and the campus is spelled out in the other-campus case
   * because that is the fact the operator has not realised.
   */
  const destinationNotice =
    emptyReason === null ? null : (
      <div className="rounded-lg bg-status-warning-subtle px-3 py-2.5 text-sm text-status-warning-onSubtle">
        {emptyReason === 'none' ? (
          <>
            <p className="font-medium">
              {receivingYearName ?? 'The receiving year'} has no sections yet.
              Create them before promoting.
            </p>
            <p className="mt-1">
              Nothing is wrong with this screen — the school has not built next
              year&rsquo;s classes. Copy this year&rsquo;s across, or build them
              by hand.
            </p>
            <div className="mt-2 flex flex-wrap items-center gap-3">
              <Button
                size="sm"
                variant="secondary"
                isLoading={copying}
                disabled={fromYear === '' || toYear === ''}
                onClick={() => {
                  void copySections();
                }}
              >
                Copy this year&rsquo;s sections into{' '}
                {receivingYearName ?? 'that year'}
              </Button>
              <Link
                href="/dashboard/admissions/grades"
                className="text-sm font-medium underline"
              >
                Grades &amp; sections
              </Link>
            </div>
          </>
        ) : (
          <>
            <p className="font-medium">
              {receivingYearName ?? 'The receiving year'} has no sections at{' '}
              {sendingGrade?.branchName ?? 'this campus'}.
            </p>
            <p className="mt-1">
              A promotion stays inside one campus — moving a student between
              campuses is a transfer, which keeps its own record and splits the
              fees. Build this campus&rsquo;s classes for that year on{' '}
              <Link
                href="/dashboard/admissions/grades"
                className="font-medium underline"
              >
                Grades &amp; sections
              </Link>
              .
            </p>
          </>
        )}
      </div>
    );

  const banner = (
    <>
      {error !== null ? (
        <p role="alert" className="rounded-lg bg-status-danger-subtle px-3 py-2 text-sm text-status-danger-ink">
          {error}
        </p>
      ) : null}
      {notice !== null ? (
        <p role="status" className="rounded-lg bg-surface-sunken px-3 py-2 text-sm text-ink">
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
          <p className="mt-4 text-sm text-ink-muted">
            Last year&rsquo;s enrollments are still there and still say which
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

          {/*
            Said *before* the list is built, not after. An operator who reaches
            the review table and finds every "Goes to" empty has already spent
            the click; this is the same explanation, one step earlier, where it
            is still cheap to act on.
          */}
          {destinationNotice === null ? null : (
            <div className="mt-4">{destinationNotice}</div>
          )}

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

  const decisionColumns: Array<DataTableColumn<DecisionRow>> = [
    {
      id: 'student',
      header: 'Student',
      sortValue: (row) => row.name,
      searchValue: (row) => `${row.name} ${row.studentId}`,
      cell: (row) => (
        <>
          <span className="font-medium text-ink">{row.name}</span>
          <span className="block font-mono text-xs text-ink-muted">{row.studentId}</span>
        </>
      ),
    },
    {
      id: 'from',
      header: 'Now in',
      muted: true,
      sortValue: (row) => row.fromSectionName,
      searchValue: (row) => row.fromSectionName,
      cell: (row) => row.fromSectionName,
    },
    {
      id: 'decision',
      header: 'Decision',
      sortValue: (row) => DECISION_LABELS[row.decision],
      cell: (row) => (
        <select
          aria-label={`Decision for ${row.name}`}
          className="rounded-lg border border-line-strong px-2 py-1 text-sm"
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
      ),
    },
    {
      id: 'to',
      header: 'Goes to',
      cell: (row) =>
        row.decision === 'promote' && destinations.length === 0 ? (
          /*
            The empty dropdown, replaced by a sentence — item 15b.

            A `<select>` with one disabled "Choose…" option is what shipped, and
            it is indistinguishable from a control that has failed to load. The
            panel above this table carries the explanation and the fix; this
            cell only has to stop pretending there is a choice here.
          */
          <span className="text-xs text-status-warning-onSubtle">
            No class to move into
          </span>
        ) : row.decision === 'promote' ? (
          <select
            aria-label={`Class for ${row.name}`}
            className="rounded-lg border border-line-strong px-2 py-1 text-sm"
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
          <span className="text-ink-muted">
            {row.decision === 'retain' ? 'Stays put' : '—'}
          </span>
        ),
    },
    {
      id: 'note',
      header: 'Note',
      className: 'text-xs text-status-warning-onSubtle',
      sortValue: (row) => row.note,
      searchValue: (row) => row.note ?? '',
      cell: (row) => row.note ?? '',
    },
  ];

  return (
    <div className="space-y-4">
      {banner}

      {destinationNotice}

      {/*
        Sorted, filtered and paged in the browser and nowhere else: the draft is
        already in memory, and every decision on it is unsaved state. A page
        change that went back to the server would be a page change that threw
        away the decisions made on the page being left.

        Apply still acts on every row of the run, not on the page in view. The
        filter is there to *find* the twelve students with no class chosen among
        three hundred, which is the one thing this screen was hard to do.
      */}
      <DataTable
        caption="Students in this promotion"
        columns={decisionColumns}
        rows={rows}
        getRowKey={(row) => row.id}
        defaultSort={{ columnId: 'student', direction: 'asc' }}
        search={{ placeholder: 'Name or student ID' }}
        filters={[
          {
            id: 'decision',
            label: 'Decision',
            allLabel: 'Every decision',
            options: (['promote', 'retain', 'graduate'] as const).map((decision) => ({
              value: decision,
              label: DECISION_LABELS[decision],
            })),
            rowValue: (row) => row.decision,
          },
          {
            id: 'ready',
            label: 'Ready',
            allLabel: 'Everyone',
            options: [
              { value: 'incomplete', label: 'No class chosen' },
              { value: 'flagged', label: 'Has a note' },
              { value: 'ready', label: 'Ready to apply' },
            ],
            rowValue: (row) => {
              const flags: string[] = [];
              if (row.decision === 'promote' && row.toSectionId === null) {
                flags.push('incomplete');
              }
              if (row.note !== null && row.note !== '') flags.push('flagged');
              if (flags.length === 0) flags.push('ready');
              return flags;
            },
          },
        ]}
        itemNoun={{ singular: 'student', plural: 'students' }}
        emptyTitle="Nobody in this run"
        actions={
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

      {missingSection > 0 ? (
        <p className="rounded-lg bg-status-warning-subtle px-3 py-2 text-sm text-status-warning-onSubtle">
          {missingSection} student{missingSection === 1 ? ' has' : 's have'} no
          class chosen. Pick one for each, or change them to retain.
        </p>
      ) : null}

      <div className="flex flex-wrap items-center gap-3">
        {confirming ? (
          <>
            <span className="text-sm text-ink">
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
