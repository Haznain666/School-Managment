'use client';

import { useCallback, useEffect, useState } from 'react';

import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card, CardTitle } from '@/components/ui/Card';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { Textarea } from '@/components/ui/Textarea';
import {
  FEE_CATEGORIES,
  FEE_CATEGORY_LABELS,
  type FeeCategory,
} from '@/db/schema/fee-types';
import { schoolErrorMessage, schoolFetch } from '@/lib/school-client';

/**
 * Fee heads — the list a school bills under.
 *
 * A school with no heads cannot price anything, so the empty state is not a
 * shrug: it offers to seed the five heads every Pakistani school uses, which
 * takes them from nothing to a working price list in one click.
 */

interface FeeTypeRow {
  id: string;
  name: string;
  description: string | null;
  feeCategory: FeeCategory;
  isActive: boolean;
  sortOrder: number;
}

export interface FeeTypeManagerProps {
  canEdit: boolean;
}

const CATEGORY_OPTIONS = FEE_CATEGORIES.map((value) => ({
  value,
  label: FEE_CATEGORY_LABELS[value],
}));

const CATEGORY_HINT: Record<FeeCategory, string> = {
  monthly: 'Billed on every monthly challan.',
  one_time: 'Billed once, when the student joins.',
  annual: 'Billed once a year.',
};

interface DraftFeeType {
  id: string | null;
  name: string;
  description: string;
  feeCategory: FeeCategory;
  isActive: boolean;
  sortOrder: string;
}

function emptyDraft(nextSortOrder: number): DraftFeeType {
  return {
    id: null,
    name: '',
    description: '',
    feeCategory: 'monthly',
    isActive: true,
    sortOrder: String(nextSortOrder),
  };
}

export function FeeTypeManager({ canEdit }: FeeTypeManagerProps) {
  const [feeTypes, setFeeTypes] = useState<FeeTypeRow[] | null>(null);
  const [draft, setDraft] = useState<DraftFeeType | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const payload = await schoolFetch<{ feeTypes: FeeTypeRow[] }>(
        '/api/school/fees/types',
      );
      setFeeTypes(payload.feeTypes);
      setError(null);
    } catch (caught) {
      setError(schoolErrorMessage(caught, 'Could not load the fee types.'));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const seed = async (): Promise<void> => {
    setBusy('seed');
    setError(null);

    try {
      await schoolFetch('/api/school/fees/types/seed', { method: 'POST' });
      await load();
    } catch (caught) {
      setError(schoolErrorMessage(caught, 'Could not seed the default fee types.'));
    } finally {
      setBusy(null);
    }
  };

  const save = async (): Promise<void> => {
    if (draft === null) return;

    const name = draft.name.trim();
    if (name === '') {
      setError('Give the fee a name.');
      return;
    }

    setBusy('save');
    setError(null);

    const body = JSON.stringify({
      name,
      description: draft.description.trim(),
      feeCategory: draft.feeCategory,
      isActive: draft.isActive,
      sortOrder: Number(draft.sortOrder) || 0,
    });

    try {
      if (draft.id === null) {
        await schoolFetch('/api/school/fees/types', { method: 'POST', body });
      } else {
        await schoolFetch(`/api/school/fees/types/${draft.id}`, {
          method: 'PATCH',
          body,
        });
      }
      setDraft(null);
      await load();
    } catch (caught) {
      setError(schoolErrorMessage(caught, 'Could not save the fee type.'));
    } finally {
      setBusy(null);
    }
  };

  const toggleActive = async (row: FeeTypeRow): Promise<void> => {
    setBusy(row.id);
    setError(null);

    try {
      await schoolFetch(`/api/school/fees/types/${row.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ isActive: !row.isActive }),
      });
      await load();
    } catch (caught) {
      setError(schoolErrorMessage(caught, 'Could not update the fee type.'));
    } finally {
      setBusy(null);
    }
  };

  if (feeTypes === null) {
    return (
      <Card>
        <p className="text-sm text-slate-500">Loading fee types…</p>
      </Card>
    );
  }

  const nextSortOrder =
    feeTypes.reduce((highest, row) => Math.max(highest, row.sortOrder), 0) + 1;

  return (
    <div className="space-y-4">
      {error !== null ? (
        <p
          role="alert"
          className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700"
        >
          {error}
        </p>
      ) : null}

      {feeTypes.length === 0 ? (
        <Card>
          <h3 className="text-base font-semibold text-slate-900">Setup required</h3>
          <p className="mt-1 text-sm text-slate-600">
            Your school has no fee heads yet, so nothing can be priced or billed.
            Seeding creates the five most schools use — Tuition Fee (monthly),
            Admission Fee (one time), and Annual Charges, Library Fee and
            Examination Fee (annual). You can rename, recategorise or retire any
            of them afterwards.
          </p>
          {canEdit ? (
            <Button
              className="mt-4"
              isLoading={busy === 'seed'}
              onClick={() => {
                void seed();
              }}
            >
              Seed default types
            </Button>
          ) : null}
        </Card>
      ) : null}

      {draft !== null ? (
        <Card
          header={
            <CardTitle
              title={draft.id === null ? 'New fee type' : 'Edit fee type'}
              description="The category decides when this head is billed."
            />
          }
        >
          <div className="grid gap-4 sm:grid-cols-2">
            <Input
              label="Name"
              value={draft.name}
              maxLength={80}
              placeholder="Tuition Fee"
              onChange={(event) => {
                setDraft({ ...draft, name: event.target.value });
              }}
            />

            <Select
              label="Category"
              options={CATEGORY_OPTIONS}
              value={draft.feeCategory}
              hint={CATEGORY_HINT[draft.feeCategory]}
              onChange={(event) => {
                const next = event.target.value as FeeCategory;
                setDraft({ ...draft, feeCategory: next });
              }}
            />

            <Input
              label="Display order"
              type="number"
              min={0}
              max={999}
              value={draft.sortOrder}
              hint="Lower numbers appear first on the challan."
              onChange={(event) => {
                setDraft({ ...draft, sortOrder: event.target.value });
              }}
            />

            <div className="sm:col-span-2">
              <Textarea
                label="Description"
                rows={2}
                value={draft.description}
                onChange={(event) => {
                  setDraft({ ...draft, description: event.target.value });
                }}
              />
            </div>
          </div>

          <div className="mt-4 flex gap-3">
            <Button
              isLoading={busy === 'save'}
              onClick={() => {
                void save();
              }}
            >
              Save
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

      {feeTypes.length === 0 ? null : (
        <Card
          header={
            <CardTitle
              title="Fee types"
              description={`${feeTypes.length} head${feeTypes.length === 1 ? '' : 's'} defined.`}
              action={
                canEdit && draft === null ? (
                  <Button
                    size="sm"
                    onClick={() => {
                      setDraft(emptyDraft(nextSortOrder));
                    }}
                  >
                    Add fee type
                  </Button>
                ) : undefined
              }
            />
          }
          className="p-0"
        >
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th scope="col" className="px-5 py-3 font-medium">Name</th>
                  <th scope="col" className="px-5 py-3 font-medium">Category</th>
                  <th scope="col" className="px-5 py-3 font-medium">Order</th>
                  <th scope="col" className="px-5 py-3 font-medium">Status</th>
                  {canEdit ? (
                    <th scope="col" className="px-5 py-3 font-medium">
                      <span className="sr-only">Actions</span>
                    </th>
                  ) : null}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {feeTypes.map((row) => (
                  <tr key={row.id}>
                    <td className="px-5 py-3">
                      <p className="font-medium text-slate-900">{row.name}</p>
                      {row.description === null || row.description === '' ? null : (
                        <p className="text-xs text-slate-500">{row.description}</p>
                      )}
                    </td>
                    <td className="px-5 py-3 text-slate-600">
                      {FEE_CATEGORY_LABELS[row.feeCategory]}
                    </td>
                    <td className="px-5 py-3 text-slate-600">{row.sortOrder}</td>
                    <td className="px-5 py-3">
                      <Badge variant={row.isActive ? 'success' : 'neutral'}>
                        {row.isActive ? 'Active' : 'Retired'}
                      </Badge>
                    </td>
                    {canEdit ? (
                      <td className="px-5 py-3">
                        <div className="flex justify-end gap-2">
                          <Button
                            size="sm"
                            variant="secondary"
                            onClick={() => {
                              setDraft({
                                id: row.id,
                                name: row.name,
                                description: row.description ?? '',
                                feeCategory: row.feeCategory,
                                isActive: row.isActive,
                                sortOrder: String(row.sortOrder),
                              });
                            }}
                          >
                            Edit
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            isLoading={busy === row.id}
                            onClick={() => {
                              void toggleActive(row);
                            }}
                          >
                            {row.isActive ? 'Retire' : 'Restore'}
                          </Button>
                        </div>
                      </td>
                    ) : null}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  );
}
