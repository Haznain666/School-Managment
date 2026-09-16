'use client';

import { useState } from 'react';

import { Button } from '@/components/ui/Button';
import { Card, CardTitle } from '@/components/ui/Card';
import { Input } from '@/components/ui/Input';
import { Toggle } from '@/components/ui/Toggle';
import { MAX_PROBATION_DAYS } from '@/db/schema/staff';
import { probationEndDate, probationProblem } from '@/lib/probation';
import { schoolErrorMessage, schoolFetch } from '@/lib/school-client';

/**
 * Probation and "permanent from", on an existing staff record. Sprint 33b, QA
 * round 1 (F4).
 *
 * The API accepted `probationExtendedDays` and refused 120 + 61, and nothing on
 * screen could send it: the only probation fields were on the *create* form,
 * and an extension is by its nature something decided months after the record
 * was made. So this card is where probation is kept.
 *
 * ── The allowance is shown, not discovered ───────────────────────────────
 * The extension field says how many days are left up to 180 — calendar days,
 * holidays included (decision 4) — and the error under it comes from
 * `probationProblem`, the function the route refuses with. The route is still
 * the rule; this is the sentence before it.
 *
 * ── Saved as one answer ──────────────────────────────────────────────────
 * `PATCH /api/school/hr/staff/[staffId]` takes the probation fields together
 * and computes the end date from them, so this sends all four every time.
 */

export interface ProbationValues {
  permanentFrom: string | null;
  isOnProbation: boolean;
  probationDays: number | null;
  probationStartedOn: string | null;
  probationEndsOn: string | null;
  probationExtendedDays: number;
}

export interface ProbationCardProps {
  staffId: string;
  initial: ProbationValues;
  canEdit: boolean;
}

interface Draft {
  permanentFrom: string;
  isOnProbation: boolean;
  startedOn: string;
  days: string;
  extendedDays: string;
}

function toDraft(values: ProbationValues): Draft {
  return {
    permanentFrom: values.permanentFrom ?? '',
    isOnProbation: values.isOnProbation,
    startedOn: values.probationStartedOn ?? '',
    days: values.probationDays === null ? '90' : String(values.probationDays),
    extendedDays: String(values.probationExtendedDays),
  };
}

export function ProbationCard({ staffId, initial, canEdit }: ProbationCardProps) {
  const [saved, setSaved] = useState<ProbationValues>(initial);
  const [draft, setDraft] = useState<Draft>(toDraft(initial));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const days = draft.days === '' ? null : Number(draft.days);
  const extended = draft.extendedDays === '' ? 0 : Number(draft.extendedDays);
  const allowance = Math.max(0, MAX_PROBATION_DAYS - (days ?? 0));

  const problem = probationProblem({
    isOnProbation: draft.isOnProbation,
    startedOn: draft.startedOn === '' ? null : draft.startedOn,
    days,
    extendedDays: extended,
  });

  const endsOn =
    draft.isOnProbation && draft.startedOn !== '' && days !== null
      ? probationEndDate(draft.startedOn, days, extended)
      : null;

  const save = async (): Promise<void> => {
    if (problem !== null) {
      setError(problem);
      return;
    }

    setBusy(true);
    setError(null);
    setNotice(null);

    try {
      const payload = await schoolFetch<{ staff: ProbationValues }>(`/api/school/hr/staff/${staffId}`, {
        method: 'PATCH',
        body: JSON.stringify({
          permanentFrom: draft.permanentFrom === '' ? null : draft.permanentFrom,
          isOnProbation: draft.isOnProbation,
          probationStartedOn: draft.startedOn === '' ? null : draft.startedOn,
          probationDays: days,
          probationExtendedDays: extended,
        }),
      });

      setSaved(payload.staff);
      setDraft(toDraft(payload.staff));
      setNotice(
        payload.staff.isOnProbation
          ? `Saved. Probation ends ${payload.staff.probationEndsOn ?? '—'}, and HR is emailed that day.`
          : 'Saved.',
      );
    } catch (caught) {
      setError(schoolErrorMessage(caught, 'Could not save probation.'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card
      header={
        <CardTitle
          title="Probation and leave entitlement"
          description={`Probation runs at most ${String(MAX_PROBATION_DAYS)} calendar days in total, holidays and any extension included. Leave accrues from the date they became permanent.`}
        />
      }
    >
      {error !== null ? (
        <p role="alert" className="mb-3 rounded-lg bg-status-danger-subtle px-3 py-2 text-sm text-status-danger-ink">
          {error}
        </p>
      ) : null}
      {notice !== null ? (
        <p className="mb-3 rounded-lg bg-status-success-subtle px-3 py-2 text-sm text-status-success-ink">
          {notice}
        </p>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-2">
        <Input
          label="Permanent from"
          type="date"
          disabled={!canEdit}
          value={draft.permanentFrom}
          hint="Blank means the whole year's entitlement."
          onChange={(event) => {
            setDraft({ ...draft, permanentFrom: event.target.value });
          }}
        />
        <div className="flex items-end">
          <Toggle
            label="On probation"
            disabled={!canEdit}
            checked={draft.isOnProbation}
            onChange={(next) => {
              setDraft({ ...draft, isOnProbation: next });
            }}
          />
        </div>

        {draft.isOnProbation ? (
          <>
            <Input
              label="Probation started"
              type="date"
              disabled={!canEdit}
              value={draft.startedOn}
              onChange={(event) => {
                setDraft({ ...draft, startedOn: event.target.value });
              }}
            />
            <Input
              label="Probation days"
              type="number"
              min={1}
              max={MAX_PROBATION_DAYS}
              disabled={!canEdit}
              value={draft.days}
              onChange={(event) => {
                setDraft({ ...draft, days: event.target.value });
              }}
            />
            <Input
              label="Extended by"
              type="number"
              min={0}
              max={allowance}
              disabled={!canEdit}
              value={draft.extendedDays}
              error={problem ?? undefined}
              hint={`Up to ${String(allowance)} more day${allowance === 1 ? '' : 's'} — ${String(MAX_PROBATION_DAYS)} in total.`}
              onChange={(event) => {
                setDraft({ ...draft, extendedDays: event.target.value });
              }}
            />
            <p className="self-end text-sm text-ink-muted">
              {endsOn === null ? 'Enter the start and the length.' : `Ends ${endsOn}.`}
              {saved.probationEndsOn !== null && saved.probationEndsOn !== endsOn
                ? ` Currently recorded as ${saved.probationEndsOn}.`
                : ''}
            </p>
          </>
        ) : null}
      </div>

      {canEdit ? (
        <div className="mt-4">
          <Button
            isLoading={busy}
            onClick={() => {
              void save();
            }}
          >
            Save probation
          </Button>
        </div>
      ) : null}
    </Card>
  );
}
