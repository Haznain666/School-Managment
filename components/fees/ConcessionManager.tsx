'use client';

import { useCallback, useEffect, useState } from 'react';

import { StudentPicker, type PickedStudent } from '@/components/fees/StudentPicker';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card, CardTitle } from '@/components/ui/Card';
import { Input } from '@/components/ui/Input';
import { MultiSelect } from '@/components/ui/MultiSelect';
import { Select } from '@/components/ui/Select';
import { Textarea } from '@/components/ui/Textarea';
import {
  DISCOUNT_TYPES,
  DISCOUNT_TYPE_LABELS,
  type DiscountType,
} from '@/db/schema/student-concessions';
import { formatDateOnly } from '@/lib/dates';
import { formatPkr } from '@/lib/money';
import { schoolErrorMessage, schoolFetch } from '@/lib/school-client';

/**
 * Concessions for one student.
 *
 * A concession is never deleted when it lapses — an end date closes it going
 * forwards, and the challans it already discounted stay explainable. Removing
 * one outright is for the genuine mistake, so it sits behind a confirmation.
 */

interface ConcessionRow {
  id: string;
  concessionName: string;
  discountType: DiscountType;
  discountValue: string;
  appliesToFeeTypeId: string | null;
  appliesToFeeTypeName: string | null;
  /** The Sprint 18 head set by name. Empty, with a null legacy id, is every head. */
  appliesToFeeTypeNames?: string[];
  /** The scheme this grant came from, when it came from one. Provenance only. */
  schemeName?: string | null;
  validFrom: string;
  validUntil: string | null;
  notes: string | null;
}

export interface FeeTypeOption {
  id: string;
  name: string;
}

export interface ConcessionManagerProps {
  feeTypes: readonly FeeTypeOption[];
  canEdit: boolean;
}

const DISCOUNT_OPTIONS = DISCOUNT_TYPES.map((value) => ({
  value,
  label: DISCOUNT_TYPE_LABELS[value],
}));

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

interface DraftConcession {
  concessionName: string;
  discountType: DiscountType;
  discountValue: string;
  /** Empty means every fee head, of every category. See `concessionHeads`. */
  feeTypeIds: string[];
  validFrom: string;
  validUntil: string;
  notes: string;
}

function emptyDraft(): DraftConcession {
  return {
    concessionName: '',
    discountType: 'percentage',
    discountValue: '',
    feeTypeIds: [],
    validFrom: today(),
    validUntil: '',
    notes: '',
  };
}

/** In force when today falls inside the window; an open end never expires. */
function isActive(row: ConcessionRow): boolean {
  const now = today();
  return row.validFrom <= now && (row.validUntil === null || row.validUntil >= now);
}

function describeDiscount(row: ConcessionRow): string {
  /*
   * The head *set* first, then the legacy single-head column, then "every".
   *
   * "every fee head", not "all monthly fees" — the label was describing the
   * pre-Sprint-17 behaviour, which is the behaviour the bug had. And a grant
   * made through the Sprint 18 multi-select leaves the legacy column null, so
   * reading only that column described a Tuition-only discount as applying to
   * every head — wider than what was granted, with nothing to signal it.
   */
  const named = row.appliesToFeeTypeNames ?? [];
  const scope =
    named.length > 0
      ? named.join(', ')
      : row.appliesToFeeTypeName === null
        ? 'every fee head'
        : row.appliesToFeeTypeName;

  return row.discountType === 'percentage'
    ? `${Number(row.discountValue)}% off ${scope}`
    : `${formatPkr(row.discountValue)} off ${scope}`;
}

export function ConcessionManager({ feeTypes, canEdit }: ConcessionManagerProps) {
  const [student, setStudent] = useState<PickedStudent | null>(null);
  const [concessions, setConcessions] = useState<ConcessionRow[] | null>(null);
  const [draft, setDraft] = useState<DraftConcession | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const studentProfileId = student?.studentProfileId ?? null;

  const load = useCallback(async () => {
    if (studentProfileId === null) {
      setConcessions(null);
      return;
    }

    try {
      const payload = await schoolFetch<{ concessions: ConcessionRow[] }>(
        `/api/school/fees/concessions?studentProfileId=${encodeURIComponent(studentProfileId)}`,
      );
      setConcessions(payload.concessions);
      setError(null);
    } catch (caught) {
      setError(schoolErrorMessage(caught, 'Could not load this student’s concessions.'));
    }
  }, [studentProfileId]);

  useEffect(() => {
    void load();
  }, [load]);

  const create = async (): Promise<void> => {
    if (draft === null || studentProfileId === null) return;

    if (draft.concessionName.trim() === '') {
      setError('Give the concession a name, e.g. "Sibling discount".');
      return;
    }

    const value = Number(draft.discountValue);
    if (!Number.isFinite(value) || value <= 0) {
      setError('Enter a discount greater than zero.');
      return;
    }

    setBusy('create');
    setError(null);

    try {
      await schoolFetch('/api/school/fees/concessions', {
        method: 'POST',
        body: JSON.stringify({
          studentProfileId,
          concessionName: draft.concessionName.trim(),
          discountType: draft.discountType,
          discountValue: value,
          // An empty list is legal and means every head — the wide case, not
          // the empty one. STATE.md §5be records what reading it the other way
          // cost the last time this decision was made.
          feeTypeIds: draft.feeTypeIds,
          validFrom: draft.validFrom,
          validUntil: draft.validUntil === '' ? null : draft.validUntil,
          notes: draft.notes.trim(),
        }),
      });

      setDraft(null);
      await load();
    } catch (caught) {
      setError(schoolErrorMessage(caught, 'Could not add the concession.'));
    } finally {
      setBusy(null);
    }
  };

  const endToday = async (concessionId: string): Promise<void> => {
    setBusy(concessionId);
    setError(null);

    try {
      await schoolFetch(`/api/school/fees/concessions/${concessionId}`, {
        method: 'PATCH',
        body: JSON.stringify({ validUntil: today() }),
      });
      await load();
    } catch (caught) {
      setError(schoolErrorMessage(caught, 'Could not end the concession.'));
    } finally {
      setBusy(null);
    }
  };

  const remove = async (concessionId: string): Promise<void> => {
    setBusy(concessionId);
    setError(null);

    try {
      await schoolFetch(`/api/school/fees/concessions/${concessionId}`, {
        method: 'DELETE',
      });
      await load();
    } catch (caught) {
      setError(schoolErrorMessage(caught, 'Could not remove the concession.'));
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="space-y-4">
      <Card header={<CardTitle title="Student" />}>
        <StudentPicker
          selected={student}
          onSelect={(next) => {
            setStudent(next);
            setDraft(null);
            setError(null);
          }}
        />
      </Card>

      {error !== null ? (
        <p role="alert" className="rounded-lg bg-status-danger-subtle px-3 py-2 text-sm text-status-danger-ink">
          {error}
        </p>
      ) : null}

      {student === null ? (
        <Card>
          <p className="text-sm text-ink-muted">
            Search for a student to see and manage their concessions.
          </p>
        </Card>
      ) : (
        <Card
          header={
            <CardTitle
              title="Concessions"
              description={`Discounts granted to ${student.name}.`}
              action={
                canEdit && draft === null ? (
                  <Button
                    size="sm"
                    onClick={() => {
                      setDraft(emptyDraft());
                    }}
                  >
                    Add concession
                  </Button>
                ) : undefined
              }
            />
          }
        >
          {concessions === null ? (
            <p className="text-sm text-ink-muted">Loading…</p>
          ) : concessions.length === 0 ? (
            <p className="text-sm text-ink-muted">
              {student.name} has no concessions. Their vouchers are billed at the
              full rate for their grade.
            </p>
          ) : (
            <ul className="divide-y divide-line">
              {concessions.map((row) => (
                <li
                  key={row.id}
                  className="flex flex-wrap items-start justify-between gap-3 py-3"
                >
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="font-medium text-ink">{row.concessionName}</p>
                      <Badge variant={isActive(row) ? 'success' : 'neutral'}>
                        {isActive(row) ? 'In force' : 'Not in force'}
                      </Badge>
                    </div>
                    <p className="mt-0.5 text-sm text-ink-muted">
                      {describeDiscount(row)}
                    </p>
                    <p className="text-xs text-ink-muted">
                      From {formatDateOnly(row.validFrom)}
                      {row.validUntil === null
                        ? ' · no end date'
                        : ` to ${formatDateOnly(row.validUntil)}`}
                    </p>
                    {row.notes === null || row.notes === '' ? null : (
                      <p className="mt-1 text-xs text-ink-muted">{row.notes}</p>
                    )}
                  </div>

                  {canEdit ? (
                    <div className="flex gap-2">
                      {isActive(row) ? (
                        <Button
                          size="sm"
                          variant="secondary"
                          isLoading={busy === row.id}
                          onClick={() => {
                            void endToday(row.id);
                          }}
                        >
                          End today
                        </Button>
                      ) : null}
                      <Button
                        size="sm"
                        variant="ghost"
                        isLoading={busy === row.id}
                        onClick={() => {
                          if (
                            window.confirm(
                              'Remove this concession entirely? Use "End today" instead if it simply no longer applies.',
                            )
                          ) {
                            void remove(row.id);
                          }
                        }}
                      >
                        Remove
                      </Button>
                    </div>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </Card>
      )}

      {draft !== null && student !== null ? (
        <Card
          header={
            <CardTitle
              title="New concession"
              description={`Applied to ${student.name}'s vouchers from the start date onwards.`}
            />
          }
        >
          <div className="grid gap-4 sm:grid-cols-2">
            <Input
              label="Name"
              value={draft.concessionName}
              maxLength={80}
              placeholder="Sibling discount"
              onChange={(event) => {
                setDraft({ ...draft, concessionName: event.target.value });
              }}
            />

            <Select
              label="Discount type"
              options={DISCOUNT_OPTIONS}
              value={draft.discountType}
              onChange={(event) => {
                setDraft({
                  ...draft,
                  discountType: event.target.value as DiscountType,
                });
              }}
            />

            <Input
              label={draft.discountType === 'percentage' ? 'Percentage' : 'Amount (PKR)'}
              type="number"
              min={0}
              max={draft.discountType === 'percentage' ? 100 : undefined}
              step="0.01"
              value={draft.discountValue}
              onChange={(event) => {
                setDraft({ ...draft, discountValue: event.target.value });
              }}
            />

            {/*
              A multi-select, not a single head, and empty means **every** head.

              A school granting "20% off her fees" means every fee the child is
              charged. Until Sprint 17 the unqualified case was read as monthly
              heads only, so the commonest discount in Pakistani schooling
              silently never reached an admission, annual or examination fee —
              and a discount that does not apply looks exactly like one the
              school never granted. Leaving this empty is the wide case.
            */}
            <div className="sm:col-span-2">
              <MultiSelect
                label="Applies to"
                options={feeTypes.map((feeType) => ({
                  value: feeType.id,
                  label: feeType.name,
                }))}
                value={draft.feeTypeIds}
                hint="Leave every box unticked for a discount on every fee head."
                emptyMessage="This school has no fee heads yet."
                onChange={(next) => {
                  setDraft({ ...draft, feeTypeIds: next });
                }}
              />
            </div>

            <Input
              label="Valid from"
              type="date"
              value={draft.validFrom}
              onChange={(event) => {
                setDraft({ ...draft, validFrom: event.target.value });
              }}
            />

            <Input
              label="Valid until"
              type="date"
              value={draft.validUntil}
              hint="Leave blank for an open-ended concession."
              onChange={(event) => {
                setDraft({ ...draft, validUntil: event.target.value });
              }}
            />

            <div className="sm:col-span-2">
              <Textarea
                label="Notes"
                rows={2}
                value={draft.notes}
                onChange={(event) => {
                  setDraft({ ...draft, notes: event.target.value });
                }}
              />
            </div>
          </div>

          <div className="mt-4 flex gap-3">
            <Button
              isLoading={busy === 'create'}
              onClick={() => {
                void create();
              }}
            >
              Grant concession
            </Button>
            <Button
              variant="ghost"
              onClick={() => {
                setDraft(null);
                setError(null);
              }}
            >
              Cancel
            </Button>
          </div>
        </Card>
      ) : null}
    </div>
  );
}
