'use client';

import { useCallback, useEffect, useState } from 'react';

import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card, CardTitle } from '@/components/ui/Card';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { Textarea } from '@/components/ui/Textarea';
import { Toggle } from '@/components/ui/Toggle';
import { DataTable, type DataTableColumn } from '@/components/ui/DataTable';
import {
  COMPONENT_CALCULATION_LABELS,
  COMPONENT_CALCULATIONS,
  COMPONENT_KIND_LABELS,
  COMPONENT_KINDS,
  type ComponentCalculation,
  type ComponentKind,
} from '@/db/schema/salary-components';
import { schoolErrorMessage, schoolFetch } from '@/lib/school-client';

/**
 * Salary components — the heads a school pays and deducts under.
 *
 * A school with no components cannot run payroll at all, so the empty state is
 * not a shrug: it offers to seed the seven most Pakistani schools use, which
 * takes them from nothing to a workable payslip structure in one click.
 *
 * Percentages are entered as percent and stored as basis points, so 45 on the
 * screen is 4500 in the database. Doing the conversion here rather than in the
 * API keeps the stored value integral — a rate that round-trips through a float
 * pays the wrong allowance.
 */

interface ComponentRow {
  id: string;
  name: string;
  description: string | null;
  kind: ComponentKind;
  calculation: ComponentCalculation;
  defaultPercentBasisPoints: number | null;
  isBasic: boolean;
  proratedByAttendance: boolean;
  isActive: boolean;
  sortOrder: number;
}

export interface SalaryComponentManagerProps {
  canEdit: boolean;
}

const KIND_OPTIONS = COMPONENT_KINDS.map((value) => ({
  value,
  label: COMPONENT_KIND_LABELS[value],
}));

const CALCULATION_OPTIONS = COMPONENT_CALCULATIONS.map((value) => ({
  value,
  label: COMPONENT_CALCULATION_LABELS[value],
}));

interface Draft {
  id: string | null;
  name: string;
  description: string;
  kind: ComponentKind;
  calculation: ComponentCalculation;
  percent: string;
  isBasic: boolean;
  proratedByAttendance: boolean;
  isActive: boolean;
  sortOrder: string;
}

function emptyDraft(nextSortOrder: number): Draft {
  return {
    id: null,
    name: '',
    description: '',
    kind: 'earning',
    calculation: 'fixed',
    percent: '0',
    isBasic: false,
    proratedByAttendance: true,
    isActive: true,
    sortOrder: String(nextSortOrder),
  };
}

/** 4500 basis points -> "45". */
function pointsToPercent(points: number | null): string {
  return points === null ? '0' : String(points / 100);
}

export function SalaryComponentManager({ canEdit }: SalaryComponentManagerProps) {
  const [components, setComponents] = useState<ComponentRow[] | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const payload = await schoolFetch<{ components: ComponentRow[] }>(
        '/api/school/hr/salary-components',
      );
      setComponents(payload.components);
      setError(null);
    } catch (caught) {
      setError(schoolErrorMessage(caught, 'Could not load the salary components.'));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const seed = async (): Promise<void> => {
    setBusy('seed');
    setError(null);

    try {
      await schoolFetch('/api/school/hr/salary-components/seed', { method: 'POST' });
      await load();
    } catch (caught) {
      setError(schoolErrorMessage(caught, 'Could not seed the default components.'));
    } finally {
      setBusy(null);
    }
  };

  const save = async (): Promise<void> => {
    if (draft === null) return;

    const name = draft.name.trim();
    if (name === '') {
      setError('Give the component a name.');
      return;
    }

    const percent = Number(draft.percent);
    if (draft.calculation === 'percent_of_basic' && !Number.isFinite(percent)) {
      setError('Enter the percentage as a number.');
      return;
    }

    setBusy('save');
    setError(null);

    const body = JSON.stringify({
      name,
      description: draft.description.trim(),
      kind: draft.kind,
      calculation: draft.calculation,
      // Percent on screen, basis points in the database.
      defaultPercentBasisPoints:
        draft.calculation === 'percent_of_basic' ? Math.round(percent * 100) : null,
      isBasic: draft.isBasic,
      proratedByAttendance: draft.proratedByAttendance,
      isActive: draft.isActive,
      sortOrder: Number(draft.sortOrder) || 0,
    });

    try {
      if (draft.id === null) {
        await schoolFetch('/api/school/hr/salary-components', { method: 'POST', body });
      } else {
        await schoolFetch(`/api/school/hr/salary-components/${draft.id}`, {
          method: 'PATCH',
          body,
        });
      }
      setDraft(null);
      await load();
    } catch (caught) {
      setError(schoolErrorMessage(caught, 'Could not save the component.'));
    } finally {
      setBusy(null);
    }
  };

  const toggleActive = async (row: ComponentRow): Promise<void> => {
    setBusy(row.id);
    setError(null);

    try {
      await schoolFetch(`/api/school/hr/salary-components/${row.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ isActive: !row.isActive }),
      });
      await load();
    } catch (caught) {
      setError(schoolErrorMessage(caught, 'Could not update the component.'));
    } finally {
      setBusy(null);
    }
  };

  if (components === null) {
    return (
      <Card>
        <p className="text-sm text-ink-muted">Loading salary components…</p>
      </Card>
    );
  }

  const nextSortOrder =
    components.reduce((highest, row) => Math.max(highest, row.sortOrder), 0) + 1;

  const hasBasic = components.some((row) => row.isBasic && row.isActive);

  const componentColumns: Array<DataTableColumn<ComponentRow>> = [
    {
      id: 'name',
      header: 'Name',
      sortValue: (row) => row.name,
      searchValue: (row) => `${row.name} ${row.description ?? ''}`,
      cell: (row) => (
        <>
          <p className="font-medium text-ink">
            {row.name}
            {row.isBasic ? (
              <Badge className="ml-2" variant="success">
                Basic
              </Badge>
            ) : null}
          </p>
          {row.description === null || row.description === '' ? null : (
            <p className="text-xs text-ink-muted">{row.description}</p>
          )}
        </>
      ),
    },
    {
      id: 'kind',
      header: 'Type',
      muted: true,
      sortValue: (row) => COMPONENT_KIND_LABELS[row.kind],
      cell: (row) => COMPONENT_KIND_LABELS[row.kind],
    },
    {
      id: 'calculation',
      header: 'Calculation',
      muted: true,
      // Percentages sort by their size, not by the sentence describing them:
      // "10% of basic" before "5% of basic" is what sorting the label gives.
      sortValue: (row) =>
        row.calculation === 'percent_of_basic' ? row.defaultPercentBasisPoints : -1,
      cell: (row) => (
        <>
          {row.calculation === 'percent_of_basic'
            ? `${pointsToPercent(row.defaultPercentBasisPoints)}% of basic`
            : 'Fixed amount'}
          {row.proratedByAttendance ? null : (
            <span className="block text-xs text-ink-muted">
              Not reduced by unpaid days
            </span>
          )}
        </>
      ),
    },
    {
      id: 'order',
      header: 'Order',
      kind: 'number',
      muted: true,
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
    componentColumns.push({
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
                kind: row.kind,
                calculation: row.calculation,
                percent: pointsToPercent(row.defaultPercentBasisPoints),
                isBasic: row.isBasic,
                proratedByAttendance: row.proratedByAttendance,
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
        <p role="alert" className="rounded-lg bg-status-danger-subtle px-3 py-2 text-sm text-status-danger-ink">
          {error}
        </p>
      ) : null}

      {components.length === 0 ? (
        <Card>
          <h3 className="text-base font-semibold text-ink">Setup required</h3>
          <p className="mt-1 text-sm text-ink-muted">
            Your school has no salary components yet, so no payslip can be
            computed. Seeding creates the seven most schools use — Basic Salary,
            House Rent (45% of basic), Medical (10%), Conveyance, and the EOBI,
            income tax and provident fund deductions. You can rename, retune or
            retire any of them afterwards.
          </p>
          {canEdit ? (
            <Button
              className="mt-4"
              isLoading={busy === 'seed'}
              onClick={() => {
                void seed();
              }}
            >
              Seed default components
            </Button>
          ) : null}
        </Card>
      ) : null}

      {components.length > 0 && !hasBasic ? (
        <p
          role="alert"
          className="rounded-lg bg-status-warning-subtle px-3 py-2 text-sm text-status-warning-onSubtle"
        >
          No component is marked as the basic salary. Every percentage head will
          compute to zero until one is.
        </p>
      ) : null}

      {draft !== null ? (
        <Card
          header={
            <CardTitle
              title={draft.id === null ? 'New component' : 'Edit component'}
              description="Earnings add to the payslip; deductions come off it."
            />
          }
        >
          <div className="grid gap-4 sm:grid-cols-2">
            <Input
              label="Name"
              value={draft.name}
              maxLength={80}
              placeholder="House Rent Allowance"
              onChange={(event) => {
                setDraft({ ...draft, name: event.target.value });
              }}
            />

            <Select
              label="Type"
              options={KIND_OPTIONS}
              value={draft.kind}
              disabled={draft.id !== null}
              hint={
                draft.id === null
                  ? undefined
                  : 'Fixed once created — changing it would invert every existing structure.'
              }
              onChange={(event) => {
                setDraft({ ...draft, kind: event.target.value as ComponentKind });
              }}
            />

            <Select
              label="Calculation"
              options={CALCULATION_OPTIONS}
              value={draft.calculation}
              onChange={(event) => {
                setDraft({
                  ...draft,
                  calculation: event.target.value as ComponentCalculation,
                });
              }}
            />

            {draft.calculation === 'percent_of_basic' ? (
              <Input
                label="Default percentage"
                type="number"
                min={0}
                max={1000}
                step={0.01}
                value={draft.percent}
                hint="Of the basic salary. Can be overridden per staff member."
                onChange={(event) => {
                  setDraft({ ...draft, percent: event.target.value });
                }}
              />
            ) : (
              <Input
                label="Display order"
                type="number"
                min={0}
                max={999}
                value={draft.sortOrder}
                hint="Lower numbers appear first on the payslip."
                onChange={(event) => {
                  setDraft({ ...draft, sortOrder: event.target.value });
                }}
              />
            )}

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

            <Toggle
              label="This is the basic salary"
              description="Every percentage head is measured against it. Only one per school."
              checked={draft.isBasic}
              disabled={draft.kind === 'deduction'}
              onChange={(checked) => {
                setDraft({ ...draft, isBasic: checked });
              }}
            />

            <Toggle
              label="Reduced by unpaid days"
              description="Off for a reimbursement or a statutory deduction that is paid regardless."
              checked={draft.proratedByAttendance}
              onChange={(checked) => {
                setDraft({ ...draft, proratedByAttendance: checked });
              }}
            />
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

      {components.length === 0 ? null : (
        <Card
          header={
            <CardTitle
              title="Salary components"
              description={`${components.length} head${components.length === 1 ? '' : 's'} defined.`}
              action={
                canEdit && draft === null ? (
                  <Button
                    size="sm"
                    onClick={() => {
                      setDraft(emptyDraft(nextSortOrder));
                    }}
                  >
                    Add component
                  </Button>
                ) : undefined
              }
            />
          }
          className="p-0"
        >
          <div className="p-5">
            <DataTable
              caption="Salary components"
              columns={componentColumns}
              rows={components}
              getRowKey={(row) => row.id}
              defaultSort={{ columnId: 'order', direction: 'asc' }}
              search={{ placeholder: 'Component name or description' }}
              filters={[
                {
                  id: 'kind',
                  label: 'Type',
                  allLabel: 'Every type',
                  options: KIND_OPTIONS,
                  rowValue: (row) => row.kind,
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
              itemNoun={{ singular: 'component', plural: 'components' }}
              emptyTitle="No salary components yet"
              noResultTitle="No components match those filters"
              noResultDescription="Widen the type, or clear the search."
            />
          </div>
        </Card>
      )}
    </div>
  );
}
