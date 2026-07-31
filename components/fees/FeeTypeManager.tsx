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
  FEE_CATEGORY_DESCRIPTIONS,
  FEE_CATEGORY_LABELS,
  type FeeCategory,
} from '@/db/schema/fee-types';
import { schoolErrorMessage, schoolFetch } from '@/lib/school-client';

/**
 * Fee head management.
 *
 * A school with none cannot bill anything, so an empty list leads with the
 * seed button rather than an empty table. Categories are fixed at creation —
 * see the API route for why changing one after challans exist is refused.
 */

export interface FeeTypeItem {
  id: string;
  name: string;
  description: string | null;
  feeCategory: FeeCategory;
  isActive: boolean;
  sortOrder: number;
}

export interface FeeTypeManagerProps {
  initialFeeTypes: readonly FeeTypeItem[];
  canEdit: boolean;
}

const CATEGORY_OPTIONS = FEE_CATEGORIES.map((value) => ({
  value,
  label: `${FEE_CATEGORY_LABELS[value]} — ${FEE_CATEGORY_DESCRIPTIONS[value]}`,
}));

export function FeeTypeManager({ initialFeeTypes, canEdit }: FeeTypeManagerProps) {
  const [feeTypes, setFeeTypes] = useState<FeeTypeItem[]>([...initialFeeTypes]);
  const [isCreating, setIsCreating] = useState(false);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [category, setCategory] = useState<FeeCategory>('monthly');

  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const reload = useCallback(async () => {
    try {
      const payload = await schoolFetch<{ feeTypes: FeeTypeItem[] }>(
        '/api/school/fees/types',
      );
      setFeeTypes(payload.feeTypes);
    } catch (caught) {
      setError(schoolErrorMessage(caught, 'Could not load fee heads.'));
    }
  }, []);

  useEffect(() => {
    setFeeTypes([...initialFeeTypes]);
  }, [initialFeeTypes]);

  const seed = async (): Promise<void> => {
    setBusy('seed');
    setError(null);
    setNotice(null);

    try {
      const result = await schoolFetch<{ seeded: number; total: number }>(
        '/api/school/fees/types/seed',
        { method: 'POST' },
      );

      setNotice(
        result.seeded === 0
          ? 'Nothing to add — the default fee heads already exist.'
          : `Added ${result.seeded} of ${result.total} default fee heads.`,
      );
      await reload();
    } catch (caught) {
      setError(schoolErrorMessage(caught, 'Could not seed the default fee heads.'));
    } finally {
      setBusy(null);
    }
  };

  const create = async (): Promise<void> => {
    setBusy('create');
    setError(null);

    try {
      await schoolFetch('/api/school/fees/types', {
        method: 'POST',
        body: JSON.stringify({
          name,
          feeCategory: category,
          description,
          sortOrder: feeTypes.length + 1,
        }),
      });

      setName('');
      setDescription('');
      setIsCreating(false);
      await reload();
    } catch (caught) {
      setError(schoolErrorMessage(caught, 'Could not create the fee head.'));
    } finally {
      setBusy(null);
    }
  };

  const toggleActive = async (feeType: FeeTypeItem): Promise<void> => {
    setBusy(feeType.id);
    setError(null);

    try {
      await schoolFetch(`/api/school/fees/types/${feeType.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ isActive: !feeType.isActive }),
      });
      await reload();
    } catch (caught) {
      setError(schoolErrorMessage(caught, 'Could not update the fee head.'));
    } finally {
      setBusy(null);
    }
  };

  const rename = async (feeType: FeeTypeItem, nextName: string): Promise<void> => {
    setBusy(feeType.id);
    setError(null);

    try {
      await schoolFetch(`/api/school/fees/types/${feeType.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ name: nextName }),
      });
      await reload();
    } catch (caught) {
      setError(schoolErrorMessage(caught, 'Could not rename the fee head.'));
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="space-y-4">
      {feeTypes.length === 0 ? (
        <Card>
          <h3 className="text-base font-semibold text-slate-900">Setup required</h3>
          <p className="mt-1 text-sm text-slate-600">
            This school has no fee heads, so nothing can be billed yet. Seeding
            adds the five most schools use — Tuition, Admission, Annual Charges,
            Library and Examination. Rename or switch off whatever does not fit.
          </p>
          {canEdit ? (
            <Button
              className="mt-4"
              isLoading={busy === 'seed'}
              onClick={() => {
                void seed();
              }}
            >
              Seed default fee heads
            </Button>
          ) : null}
        </Card>
      ) : null}

      {error !== null ? (
        <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </p>
      ) : null}

      {notice !== null ? (
        <p className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
          {notice}
        </p>
      ) : null}

      {feeTypes.length > 0 ? (
        <Card
          className="p-0"
          header={
            <CardTitle
              title="Fee heads"
              description="What this school bills for. The order here is the order on a printed challan."
              action={
                canEdit && !isCreating ? (
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => {
                      setIsCreating(true);
                    }}
                  >
                    Add fee head
                  </Button>
                ) : undefined
              }
            />
          }
        >
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th scope="col" className="px-5 py-3 font-medium">Name</th>
                  <th scope="col" className="px-5 py-3 font-medium">Charged</th>
                  <th scope="col" className="px-5 py-3 font-medium">Status</th>
                  <th scope="col" className="px-5 py-3 font-medium">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {feeTypes.map((feeType) => (
                  <FeeTypeRow
                    key={feeType.id}
                    feeType={feeType}
                    canEdit={canEdit}
                    busy={busy === feeType.id}
                    onRename={rename}
                    onToggle={toggleActive}
                  />
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      ) : null}

      {isCreating ? (
        <Card header={<CardTitle title="New fee head" />}>
          <div className="grid gap-4 sm:grid-cols-2">
            <Input
              label="Name"
              required
              placeholder="e.g. Transport Fee"
              value={name}
              disabled={busy === 'create'}
              onChange={(event) => {
                setName(event.target.value);
              }}
            />
            <Select
              label="Charged"
              options={CATEGORY_OPTIONS}
              value={category}
              disabled={busy === 'create'}
              hint="Cannot be changed later — past challans depend on it."
              onChange={(event) => {
                setCategory(event.target.value as FeeCategory);
              }}
            />
            <div className="sm:col-span-2">
              <Textarea
                label="Description"
                value={description}
                disabled={busy === 'create'}
                onChange={(event) => {
                  setDescription(event.target.value);
                }}
              />
            </div>
            <div className="flex gap-3 sm:col-span-2">
              <Button
                isLoading={busy === 'create'}
                disabled={name.trim() === ''}
                onClick={() => {
                  void create();
                }}
              >
                Create
              </Button>
              <Button
                variant="secondary"
                disabled={busy === 'create'}
                onClick={() => {
                  setIsCreating(false);
                }}
              >
                Cancel
              </Button>
            </div>
          </div>
        </Card>
      ) : null}
    </div>
  );
}

interface FeeTypeRowProps {
  feeType: FeeTypeItem;
  canEdit: boolean;
  busy: boolean;
  onRename: (feeType: FeeTypeItem, name: string) => Promise<void>;
  onToggle: (feeType: FeeTypeItem) => Promise<void>;
}

function FeeTypeRow({ feeType, canEdit, busy, onRename, onToggle }: FeeTypeRowProps) {
  const [name, setName] = useState(feeType.name);

  useEffect(() => {
    setName(feeType.name);
  }, [feeType.name]);

  return (
    <tr>
      <td className="px-5 py-3">
        {canEdit ? (
          <div className="flex items-center gap-2">
            <Input
              label="Name"
              hideLabel
              value={name}
              disabled={busy}
              onChange={(event) => {
                setName(event.target.value);
              }}
            />
            {name !== feeType.name && name.trim() !== '' ? (
              <Button
                size="sm"
                variant="secondary"
                isLoading={busy}
                onClick={() => {
                  void onRename(feeType, name.trim());
                }}
              >
                Save
              </Button>
            ) : null}
          </div>
        ) : (
          <span className="font-medium text-slate-900">{feeType.name}</span>
        )}
        {feeType.description === null ? null : (
          <p className="mt-1 text-xs text-slate-500">{feeType.description}</p>
        )}
      </td>
      <td className="px-5 py-3 text-slate-600">
        {FEE_CATEGORY_LABELS[feeType.feeCategory]}
      </td>
      <td className="px-5 py-3">
        <Badge variant={feeType.isActive ? 'success' : 'neutral'}>
          {feeType.isActive ? 'Active' : 'Inactive'}
        </Badge>
      </td>
      <td className="px-5 py-3">
        {canEdit ? (
          <Button
            size="sm"
            variant="ghost"
            isLoading={busy}
            onClick={() => {
              void onToggle(feeType);
            }}
          >
            {feeType.isActive ? 'Deactivate' : 'Reactivate'}
          </Button>
        ) : null}
      </td>
    </tr>
  );
}
