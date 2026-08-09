'use client';

import { useCallback, useEffect, useState } from 'react';

import { Button } from '@/components/ui/Button';
import { Card, CardTitle } from '@/components/ui/Card';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';

export interface TransferSectionOption {
  id: string;
  branchId: string;
  /** Sections exist once per academic year — see `destinations`. */
  academicYearId: string;
  label: string;
}

export interface TransferPanelProps {
  studentProfileId: string;
  studentName: string;
  sections: readonly TransferSectionOption[];
}

interface Current {
  branchId: string;
  branchName: string;
  gradeName: string;
  sectionName: string;
  academicYearId: string;
}

interface Quote {
  period: string;
  daysInMonth: number;
  daysBefore: number;
  daysAfter: number;
  monthlyTotal: string;
  credit: string;
  charge: string;
  challanIds: string[];
}

/**
 * Move one student to another campus, with the month's fees split.
 *
 * The quote is fetched rather than computed here: it reads the student's open
 * challans, and the figure on screen must be the figure that gets stored. It
 * is refetched whenever the date changes, because the split is by day and the
 * date is the whole input.
 */
export function TransferPanel({
  studentProfileId,
  studentName,
  sections,
}: TransferPanelProps) {
  const [current, setCurrent] = useState<Current | null>(null);
  const [toSectionId, setToSectionId] = useState('');
  const [effectiveDate, setEffectiveDate] = useState(
    () => new Date().toISOString().slice(0, 10),
  );
  const [reason, setReason] = useState('');

  const [quote, setQuote] = useState<Quote | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);

  useEffect(() => {
    const controller = new AbortController();

    const run = async () => {
      const query = new URLSearchParams({ studentProfileId, effectiveDate });
      try {
        const response = await fetch(`/api/school/transfers?${query.toString()}`, {
          signal: controller.signal,
        });
        const payload = (await response.json()) as {
          ok: boolean;
          data?: { current: Current; quote: Quote | null };
          error?: { message: string };
        };

        if (payload.ok === true && payload.data !== undefined) {
          setCurrent(payload.data.current);
          setQuote(payload.data.quote);
          setError(null);
        } else {
          setError(payload.error?.message ?? 'Could not read that student.');
        }
      } catch (caught) {
        if (caught instanceof DOMException && caught.name === 'AbortError') return;
        setError('Could not read that student.');
      }
    };

    void run();
    return () => {
      controller.abort();
    };
  }, [studentProfileId, effectiveDate]);

  const submit = useCallback(async () => {
    setBusy(true);
    setError(null);

    try {
      const response = await fetch('/api/school/transfers', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          studentProfileId,
          toSectionId,
          effectiveDate,
          reason: reason.trim() === '' ? undefined : reason.trim(),
        }),
      });

      const payload = (await response.json()) as {
        ok: boolean;
        data?: {
          result: {
            fromBranchName: string;
            toBranchName: string;
            credit: string;
            charge: string;
            cancelledChallans: number;
          };
        };
        error?: { message: string };
      };

      if (!response.ok || payload.ok !== true || payload.data === undefined) {
        setError(payload.error?.message ?? 'Could not transfer that student.');
        setConfirming(false);
        return;
      }

      const result = payload.data.result;
      setDone(
        `${studentName} moved from ${result.fromBranchName} to ${result.toBranchName}. ` +
          `${result.fromBranchName} credits PKR ${result.credit}; ${result.toBranchName} bills PKR ${result.charge} on its next run.` +
          (result.cancelledChallans > 0
            ? ` ${result.cancelledChallans} open challan${result.cancelledChallans === 1 ? ' was' : 's were'} cancelled.`
            : ''),
      );
    } catch {
      setError('Could not transfer that student.');
    } finally {
      setBusy(false);
    }
  }, [studentProfileId, toSectionId, effectiveDate, reason, studentName]);

  if (done !== null) {
    return (
      <Card header={<CardTitle title="Transferred" />}>
        <p className="text-sm text-slate-700">{done}</p>
        <p className="mt-3 text-sm text-slate-600">
          Their old enrolment is closed as transferred, not deleted — it still
          says which campus and section they were in, and when.
        </p>
      </Card>
    );
  }

  /*
   * Where this student could go.
   *
   * Two filters, and both are load-bearing:
   *
   *   - **A different campus.** A move within one branch is a section change,
   *     which the student profile already does, and offering it here would
   *     produce a transfer record with nothing to explain. The route refuses
   *     it too.
   *   - **The same academic year.** A section exists once per year, so an
   *     unfiltered list showed "Grade 5 — A" three times with nothing to tell
   *     them apart and two of the three refused by the route. The same defect
   *     the promotion picker had, found the same way — worth noting that it
   *     was written twice before it was seen once.
   */
  const destinations =
    current === null
      ? []
      : sections.filter(
          (section) =>
            section.branchId !== current.branchId &&
            section.academicYearId === current.academicYearId,
        );

  return (
    <div className="space-y-4">
      {error !== null ? (
        <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </p>
      ) : null}

      <Card
        header={
          <CardTitle
            title="Transfer to another campus"
            description={
              current === null
                ? 'Loading…'
                : `Currently ${current.gradeName} ${current.sectionName} at ${current.branchName}.`
            }
          />
        }
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <Select
            label="Moving to"
            options={[
              { value: '', label: 'Choose a class…' },
              ...destinations.map((section) => ({
                value: section.id,
                label: section.label,
              })),
            ]}
            value={toSectionId}
            onChange={(event) => {
              setToSectionId(event.target.value);
              setConfirming(false);
            }}
          />
          <Input
            label="Takes effect"
            type="date"
            value={effectiveDate}
            hint="Their first day at the new campus. The month's fees split on this date."
            onChange={(event) => {
              setEffectiveDate(event.target.value);
              setConfirming(false);
            }}
          />
        </div>

        <div className="mt-4">
          <Input
            label="Reason (optional)"
            value={reason}
            placeholder="Family moved to Johar Town"
            onChange={(event) => {
              setReason(event.target.value);
            }}
          />
        </div>
      </Card>

      {quote !== null ? (
        <Card header={<CardTitle title={`Fees for ${quote.period}`} />}>
          {Number(quote.monthlyTotal) === 0 ? (
            <p className="text-sm text-slate-600">
              Nothing is outstanding for this month, so there is nothing to
              split. The new campus bills them from its next run.
            </p>
          ) : (
            <>
              <dl className="grid gap-4 sm:grid-cols-3">
                <div>
                  <dt className="text-xs uppercase tracking-wide text-slate-500">
                    Outstanding this month
                  </dt>
                  <dd className="mt-1 font-mono text-sm text-slate-900">
                    PKR {quote.monthlyTotal}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs uppercase tracking-wide text-slate-500">
                    {current?.branchName ?? 'Leaving campus'} credits
                  </dt>
                  <dd className="mt-1 font-mono text-sm text-slate-900">
                    PKR {quote.credit}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs uppercase tracking-wide text-slate-500">
                    New campus bills
                  </dt>
                  <dd className="mt-1 font-mono text-sm text-slate-900">
                    PKR {quote.charge}
                  </dd>
                </div>
              </dl>

              <p className="mt-4 text-sm text-slate-600">
                {quote.daysBefore} of {quote.daysInMonth} days at the old
                campus, {quote.daysAfter} at the new one. The parent&rsquo;s
                total for the month does not change — the money moves between
                campuses.
              </p>

              {quote.challanIds.length > 0 ? (
                <p className="mt-2 text-sm text-amber-800">
                  {quote.challanIds.length} open challan
                  {quote.challanIds.length === 1 ? '' : 's'} for this month will
                  be cancelled. A challan already paid is not touched — refunds
                  are handled at the counter.
                </p>
              ) : null}
            </>
          )}
        </Card>
      ) : null}

      <div className="flex flex-wrap items-center gap-3">
        {confirming ? (
          <>
            <span className="text-sm text-slate-700">
              Move {studentName} on {effectiveDate}?
            </span>
            <Button
              isLoading={busy}
              onClick={() => {
                void submit();
              }}
            >
              Transfer
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
          <Button
            disabled={toSectionId === '' || current === null}
            onClick={() => {
              setConfirming(true);
              setError(null);
            }}
          >
            Transfer student
          </Button>
        )}
      </div>
    </div>
  );
}
