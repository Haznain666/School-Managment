'use client';

import { useCallback, useEffect, useState } from 'react';

import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card, CardTitle } from '@/components/ui/Card';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { DataTable, type DataTableColumn } from '@/components/ui/DataTable';
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
        <p className="text-sm text-ink-muted">Loading fee types…</p>
      </Card>
    );
  }

  const nextSortOrder =
    feeTypes.reduce((highest, row) => Math.max(highest, row.sortOrder), 0) + 1;

  const feeTypeColumns: Array<DataTableColumn<FeeTypeRow>> = [
    {
      id: 'name',
      header: 'Name',
      sortValue: (row) => row.name,
      searchValue: (row) => `${row.name} ${row.description ?? ''}`,
      cell: (row) => (
        <>
          <p className="font-medium text-ink">{row.name}</p>
          {row.description === null || row.description === '' ? null : (
            <p className="text-xs text-ink-muted">{row.description}</p>
          )}
        </>
      ),
    },
    {
      id: 'category',
      header: 'Category',
      muted: true,
      sortValue: (row) => FEE_CATEGORY_LABELS[row.feeCategory],
      cell: (row) => FEE_CATEGORY_LABELS[row.feeCategory],
    },
    {
      id: 'order',
      header: 'Order',
      kind: 'number',
      muted: true,
      // The order a head is billed in is the order this list defaults to, so
      // the column that decides it is the one the table opens sorted by.
      sortValue: (row) => row.sortOrder,
      cell: (row) => row.sortOrder,
    },
    {
      id: 'status',
      header: 'Status',
      sortValue: (row) => (row.isActive ? 0 : 1),
      cell: (row) => (
        <Badge variant={row.isActive ? 'success' : 'neutral'}>
          {row.isActive ? 'Active' : 'Retired'}
        </Badge>
      ),
    },
  ];

  if (canEdit) {
    feeTypeColumns.push({
      id: 'actions',
      header: <span className="sr-only">Actions</span>,
      align: 'end',
      cell: (row) => (
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
      ),
    });
  }

  return (
    <div className="space-y-4">
      {error !== null ? (
        <p
          role="alert"
          className="rounded-lg bg-status-danger-subtle px-3 py-2 text-sm text-status-danger-ink"
        >
          {error}
        </p>
      ) : null}

      {feeTypes.length === 0 ? (
        <Card>
          <h3 className="text-base font-semibold text-ink">Setup required</h3>
          <p className="mt-1 text-sm text-ink-muted">
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
          <div className="p-5">
            <DataTable
              caption="Fee types"
              columns={feeTypeColumns}
              rows={feeTypes}
              getRowKey={(row) => row.id}
              defaultSort={{ columnId: 'order', direction: 'asc' }}
              search={{ placeholder: 'Head name or description' }}
              filters={[
                {
                  id: 'category',
                  label: 'Category',
                  allLabel: 'Every category',
                  options: CATEGORY_OPTIONS,
                  rowValue: (row) => row.feeCategory,
                },
                {
                  id: 'status',
                  label: 'Status',
                  allLabel: 'Active and retired',
                  options: [
                    { value: 'active', label: 'Active' },
                    { value: 'retired', label: 'Retired' },
                  ],
                  rowValue: (row) => (row.isActive ? 'active' : 'retired'),
                },
              ]}
              itemNoun={{ singular: 'fee head', plural: 'fee heads' }}
              emptyTitle="No fee heads yet"
              noResultTitle="No fee heads match those filters"
              noResultDescription="Widen the category or clear the search."
            />
          </div>
        </Card>
      )}
    </div>
  );
}
