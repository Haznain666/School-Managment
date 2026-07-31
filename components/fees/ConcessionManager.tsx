'use client';

import { useCallback, useEffect, useState } from 'react';

import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card, CardTitle } from '@/components/ui/Card';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { Textarea } from '@/components/ui/Textarea';
import {
  DISCOUNT_TYPES,
  DISCOUNT_TYPE_LABELS,
  type DiscountType,
} from '@/db/schema/student-concessions';
import { formatPkr, parsePaise } from '@/lib/money';
import { schoolErrorMessage, schoolFetch } from '@/lib/school-client';

/**
 * Per-student concessions.
 *
 * Search first, because concessions are granted one family at a time — a list
 * of every discount in the school is not how anyone works with this.
 *
 * Ending a concession is done by dating it, not deleting it: challans already
 * raised keep the discount they were calculated with either way, but a dated
 * record explains why a family's bill changed in March.
 */

export interface ConcessionItem {
  id: string;
  concessionName: string;
  discountType: DiscountType;
  discountValue: string;
  appliesToFeeTypeId: string | null;
  appliesToFeeTypeName: string | null;
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

interface StudentOption {
  studentProfileId: string;
  studentId: string;
  name: string;
  gradeName: string;
  sectionName: string;
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

/** Is this concession in force today? */
function isActive(concession: ConcessionItem): boolean {
  const today = todayIso();
  if (concession.validFrom > today) return false;
  if (concession.validUntil !== null && concession.validUntil < today) return false;
  return true;
}

function describeDiscount(concession: ConcessionItem): string {
  return concession.discountType === 'percentage'
    ? `${Number(concession.discountValue)}%`
    : `PKR ${formatPkr(parsePaise(concession.discountValue) ?? 0)}`;
}

export function ConcessionManager({ feeTypes, canEdit }: ConcessionManagerProps) {
  const [search, setSearch] = useState('');
  const [students, setStudents] = useState<StudentOption[]>([]);
  const [selected, setSelected] = useState<StudentOption | null>(null);

  const [concessions, setConcessions] = useState<ConcessionItem[]>([]);
  const [isAdding, setIsAdding] = useState(false);

  const [name, setName] = useState('Sibling Discount');
  const [discountType, setDiscountType] = useState<DiscountType>('percentage');
  const [discountValue, setDiscountValue] = useState('');
  const [appliesTo, setAppliesTo] = useState('');
  const [validFrom, setValidFrom] = useState(todayIso());
  const [validUntil, setValidUntil] = useState('');
  const [notes, setNotes] = useState('');

  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (search.trim().length < 2) {
      setStudents([]);
      return;
    }

    const controller = new AbortController();
    const timer = setTimeout(() => {
      const query = new URLSearchParams({ search: search.trim(), limit: '10' });

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
  }, [search]);

  const loadConcessions = useCallback(async (studentProfileId: string) => {
    try {
      const payload = await schoolFetch<{ concessions: ConcessionItem[] }>(
        `/api/school/fees/concessions?studentProfileId=${encodeURIComponent(studentProfileId)}`,
      );
      setConcessions(payload.concessions);
      setError(null);
    } catch (caught) {
      setError(schoolErrorMessage(caught, 'Could not load concessions.'));
    }
  }, []);

  const pick = (student: StudentOption): void => {
    setSelected(student);
    setStudents([]);
    setSearch('');
    void loadConcessions(student.studentProfileId);
  };

  const add = async (): Promise<void> => {
    if (selected === null) return;

    setBusy('add');
    setError(null);

    try {
      await schoolFetch('/api/school/fees/concessions', {
        method: 'POST',
        body: JSON.stringify({
          studentProfileId: selected.studentProfileId,
          concessionName: name,
          discountType,
          discountValue,
          appliesToFeeTypeId: appliesTo === '' ? null : appliesTo,
          validFrom,
          validUntil: validUntil === '' ? null : validUntil,
          notes,
        }),
      });

      setIsAdding(false);
      setDiscountValue('');
      setNotes('');
      await loadConcessions(selected.studentProfileId);
    } catch (caught) {
      setError(schoolErrorMessage(caught, 'Could not add the concession.'));
    } finally {
      setBusy(null);
    }
  };

  const endToday = async (concession: ConcessionItem): Promise<void> => {
    if (selected === null) return;

    setBusy(concession.id);
    setError(null);

    try {
      await schoolFetch(`/api/school/fees/concessions/${concession.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ validUntil: todayIso() }),
      });
      await loadConcessions(selected.studentProfileId);
    } catch (caught) {
      setError(schoolErrorMessage(caught, 'Could not end the concession.'));
    } finally {
      setBusy(null);
    }
  };

  const remove = async (concession: ConcessionItem): Promise<void> => {
    if (selected === null) return;

    setBusy(concession.id);
    setError(null);

    try {
      await schoolFetch(`/api/school/fees/concessions/${concession.id}`, {
        method: 'DELETE',
      });
      await loadConcessions(selected.studentProfileId);
    } catch (caught) {
      setError(schoolErrorMessage(caught, 'Could not remove the concession.'));
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="space-y-4">
      <Card header={<CardTitle title="Find a student" />}>
        <Input
          label="Search"
          hideLabel
          placeholder="Name or student ID"
          value={search}
          onChange={(event) => {
            setSearch(event.target.value);
          }}
        />

        {students.length > 0 ? (
          <ul className="mt-3 divide-y divide-slate-100 rounded-lg border border-slate-200">
            {students.map((student) => (
              <li key={student.studentProfileId}>
                <button
                  type="button"
                  onClick={() => {
                    pick(student);
                  }}
                  className="flex w-full items-center justify-between px-4 py-2 text-left text-sm hover:bg-slate-50"
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
      </Card>

      {error !== null ? (
        <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </p>
      ) : null}

      {selected !== null ? (
        <Card
          header={
            <CardTitle
              title={selected.name}
              description={`${selected.studentId} · ${selected.gradeName} ${selected.sectionName}`}
              action={
                canEdit && !isAdding ? (
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => {
                      setIsAdding(true);
                    }}
                  >
                    Add concession
                  </Button>
                ) : undefined
              }
            />
          }
        >
          {concessions.length === 0 ? (
            <p className="text-sm text-slate-600">
              No concessions recorded for this student.
            </p>
          ) : (
            <ul className="divide-y divide-slate-100">
              {concessions.map((concession) => (
                <li
                  key={concession.id}
                  className="flex flex-wrap items-start justify-between gap-3 py-3"
                >
                  <div>
                    <p className="font-medium text-slate-900">
                      {concession.concessionName}{' '}
                      <span className="font-normal text-slate-600">
                        · {describeDiscount(concession)} off{' '}
                        {concession.appliesToFeeTypeName ?? 'tuition'}
                      </span>
                    </p>
                    <p className="mt-0.5 text-xs text-slate-500">
                      From {concession.validFrom}
                      {concession.validUntil === null
                        ? ' · no end date'
                        : ` until ${concession.validUntil}`}
                    </p>
                    {concession.notes === null ? null : (
                      <p className="mt-1 text-xs text-slate-500">{concession.notes}</p>
                    )}
                    <Badge
                      className="mt-2"
                      variant={isActive(concession) ? 'success' : 'neutral'}
                    >
                      {isActive(concession) ? 'Active' : 'Not in force'}
                    </Badge>
                  </div>

                  {canEdit ? (
                    <div className="flex gap-2">
                      {concession.validUntil === null ? (
                        <Button
                          size="sm"
                          variant="ghost"
                          isLoading={busy === concession.id}
                          onClick={() => {
                            void endToday(concession);
                          }}
                        >
                          End today
                        </Button>
                      ) : null}
                      <Button
                        size="sm"
                        variant="ghost"
                        isLoading={busy === concession.id}
                        onClick={() => {
                          void remove(concession);
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

          {isAdding ? (
            <div className="mt-4 grid gap-4 border-t border-slate-200 pt-4 sm:grid-cols-2">
              <Input
                label="Name"
                required
                value={name}
                disabled={busy === 'add'}
                onChange={(event) => {
                  setName(event.target.value);
                }}
              />
              <Select
                label="Type"
                options={DISCOUNT_TYPES.map((value) => ({
                  value,
                  label: DISCOUNT_TYPE_LABELS[value],
                }))}
                value={discountType}
                disabled={busy === 'add'}
                onChange={(event) => {
                  setDiscountType(event.target.value as DiscountType);
                }}
              />
              <Input
                label={discountType === 'percentage' ? 'Percentage (0-100)' : 'Amount (PKR)'}
                required
                inputMode="decimal"
                value={discountValue}
                disabled={busy === 'add'}
                onChange={(event) => {
                  setDiscountValue(event.target.value);
                }}
              />
              <Select
                label="Applies to"
                options={[
                  { value: '', label: 'Tuition only (default)' },
                  ...feeTypes.map((feeType) => ({
                    value: feeType.id,
                    label: feeType.name,
                  })),
                ]}
                value={appliesTo}
                disabled={busy === 'add'}
                onChange={(event) => {
                  setAppliesTo(event.target.value);
                }}
              />
              <Input
                label="Valid from"
                type="date"
                value={validFrom}
                disabled={busy === 'add'}
                hint="Challans for months before this keep their original amount."
                onChange={(event) => {
                  setValidFrom(event.target.value);
                }}
              />
              <Input
                label="Valid until"
                type="date"
                value={validUntil}
                disabled={busy === 'add'}
                hint="Leave blank for no end date."
                onChange={(event) => {
                  setValidUntil(event.target.value);
                }}
              />
              <div className="sm:col-span-2">
                <Textarea
                  label="Notes"
                  value={notes}
                  disabled={busy === 'add'}
                  onChange={(event) => {
                    setNotes(event.target.value);
                  }}
                />
              </div>
              <div className="flex gap-3 sm:col-span-2">
                <Button
                  isLoading={busy === 'add'}
                  disabled={name.trim() === '' || discountValue.trim() === ''}
                  onClick={() => {
                    void add();
                  }}
                >
                  Add concession
                </Button>
                <Button
                  variant="secondary"
                  disabled={busy === 'add'}
                  onClick={() => {
                    setIsAdding(false);
                  }}
                >
                  Cancel
                </Button>
              </div>
            </div>
          ) : null}
        </Card>
      ) : null}
    </div>
  );
}
