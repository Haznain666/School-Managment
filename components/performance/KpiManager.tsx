'use client';

import { useState } from 'react';

import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card, CardTitle } from '@/components/ui/Card';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import {
  Table,
  TableBody,
  TableCell,
  TableEmptyRow,
  TableHead,
  TableHeaderCell,
  TableRow,
} from '@/components/ui/Table';
import { Textarea } from '@/components/ui/Textarea';
import type { KpiRow } from '@/lib/kpi-access';
import {
  KPI_PERIOD_LABELS,
  MAX_KPI_DESCRIPTION_LENGTH,
  MAX_KPI_NAME_LENGTH,
  kpiNameProblem,
  type StaffKpiPeriod,
  type StaffKpiTargetRole,
} from '@/lib/kpis';
import { schoolErrorMessage, schoolFetch } from '@/lib/school-client';
import { ROLE_LABELS } from '@/types/school-auth';

/**
 * Defining KPIs — Sprint 32.
 *
 * ── The list is replaced from the response ───────────────────────────────
 * Every save and delete answers with the whole list, read by the same
 * `listKpis` the page rendered, and the table is set from it. §5ca's
 * acceptance is "a saved KPI appears without a reload, on a hard-loaded page"
 * — which `router.refresh()` alone never delivered anywhere in this product.
 *
 * ── The role dropdown is a courtesy ──────────────────────────────────────
 * It offers only the roles this creator may define for (rule 3). The route
 * refuses the others whatever the form sends.
 */

interface Draft {
  id: string | null;
  name: string;
  description: string;
  targetRole: StaffKpiTargetRole | '';
  period: StaffKpiPeriod;
  branchId: string;
}

const EMPTY: Draft = {
  id: null,
  name: '',
  description: '',
  targetRole: '',
  period: 'monthly',
  branchId: '',
};

export interface KpiManagerProps {
  initial: readonly KpiRow[];
  definableRoles: readonly StaffKpiTargetRole[];
  canCreate: boolean;
  canDelete: boolean;
  /** Campuses to file a KPI under. Empty when there is nothing to choose. */
  branchOptions: ReadonlyArray<{ id: string; name: string }>;
  /** Whether "Every campus" is on offer — a school-wide caller only. */
  allowShared: boolean;
}

export function KpiManager({
  initial,
  definableRoles,
  canCreate,
  canDelete,
  branchOptions,
  allowShared,
}: KpiManagerProps) {
  const [kpis, setKpis] = useState<readonly KpiRow[]>(initial);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [saving, setSaving] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [nameError, setNameError] = useState<string | undefined>(undefined);

  const canTouch = (row: KpiRow): boolean => definableRoles.includes(row.targetRole);

  const save = async (): Promise<void> => {
    if (draft === null) return;
    const problem = kpiNameProblem(draft.name);
    setNameError(problem ?? undefined);
    if (problem !== null) return;
    if (draft.targetRole === '') {
      setError('Choose the role this KPI is for.');
      return;
    }

    setSaving(true);
    setError(null);
    setNotice(null);

    try {
      const payload = await schoolFetch<{ kpis: KpiRow[] }>(
        draft.id === null ? '/api/school/kpis' : `/api/school/kpis/${draft.id}`,
        {
          method: draft.id === null ? 'POST' : 'PATCH',
          body: JSON.stringify({
            name: draft.name,
            description: draft.description,
            targetRole: draft.targetRole,
            period: draft.period,
            branchId: draft.branchId === '' ? null : draft.branchId,
          }),
        },
      );
      setKpis(payload.kpis);
      setNotice(
        draft.id === null
          ? `“${draft.name.trim()}” is now a KPI for ${ROLE_LABELS[draft.targetRole]}.`
          : `“${draft.name.trim()}” saved.`,
      );
      setDraft(null);
    } catch (caught) {
      setError(schoolErrorMessage(caught, 'The KPI could not be saved.'));
    } finally {
      setSaving(false);
    }
  };

  const remove = async (row: KpiRow): Promise<void> => {
    if (
      !window.confirm(
        `Delete “${row.name}”? Nobody will be rated on it again. Ratings already entered are kept.`,
      )
    ) {
      return;
    }

    setBusyId(row.id);
    setError(null);
    setNotice(null);

    try {
      const payload = await schoolFetch<{ kpis: KpiRow[] }>(`/api/school/kpis/${row.id}`, {
        method: 'DELETE',
      });
      setKpis(payload.kpis);
      setNotice(`“${row.name}” deleted.`);
    } catch (caught) {
      setError(schoolErrorMessage(caught, 'The KPI could not be deleted.'));
    } finally {
      setBusyId(null);
    }
  };

  const showCampus = branchOptions.length > 0 || kpis.some((row) => row.branchId !== null);

  return (
    <Card
      header={
        <CardTitle
          title="KPIs"
          description="Written expectations for each role. Monthly KPIs are rated every month and annual ones once a year, all out of 10."
          action={
            canCreate && definableRoles.length > 0 && draft === null ? (
              <Button
                onClick={() => {
                  setDraft({
                    ...EMPTY,
                    branchId: allowShared ? '' : (branchOptions[0]?.id ?? ''),
                  });
                  setError(null);
                  setNotice(null);
                }}
              >
                Add a KPI
              </Button>
            ) : undefined
          }
        />
      }
    >
      {error === null ? null : (
        <p className="mb-4 rounded-control border border-status-danger-line bg-status-danger-surface px-3 py-2 text-sm text-status-danger-ink">
          {error}
        </p>
      )}
      {notice === null ? null : (
        <p
          role="status"
          className="mb-4 rounded-control bg-status-success-subtle px-3 py-2 text-sm text-status-success-ink"
        >
          {notice}
        </p>
      )}

      {draft === null ? null : (
        <div className="mb-6 space-y-4 rounded-card border border-line bg-surface-sunken p-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <Input
              label="Name"
              value={draft.name}
              maxLength={MAX_KPI_NAME_LENGTH}
              placeholder="Punctuality"
              error={nameError}
              onChange={(event) => setDraft({ ...draft, name: event.target.value })}
            />
            <Select
              label="For which role"
              value={draft.targetRole}
              placeholder="Choose a role"
              options={definableRoles.map((role) => ({ value: role, label: ROLE_LABELS[role] }))}
              onChange={(event) =>
                setDraft({ ...draft, targetRole: event.target.value as StaffKpiTargetRole })
              }
            />
            <Select
              label="How often it is rated"
              value={draft.period}
              options={[
                { value: 'monthly', label: 'Monthly — once a month' },
                { value: 'annual', label: 'Annual — once a year' },
              ]}
              onChange={(event) =>
                setDraft({ ...draft, period: event.target.value as StaffKpiPeriod })
              }
            />
            {branchOptions.length > 0 && draft.id === null ? (
              <Select
                label="Campus"
                value={draft.branchId}
                options={[
                  ...(allowShared ? [{ value: '', label: 'Every campus' }] : []),
                  ...branchOptions.map((branch) => ({ value: branch.id, label: branch.name })),
                ]}
                onChange={(event) => setDraft({ ...draft, branchId: event.target.value })}
              />
            ) : null}
          </div>
          <Textarea
            label="What good looks like"
            rows={3}
            value={draft.description}
            maxLength={MAX_KPI_DESCRIPTION_LENGTH}
            hint="Optional. What a 10 means, so two raters score the same thing."
            onChange={(event) => setDraft({ ...draft, description: event.target.value })}
          />
          <div className="flex flex-wrap justify-end gap-2">
            <Button variant="secondary" disabled={saving} onClick={() => setDraft(null)}>
              Cancel
            </Button>
            <Button isLoading={saving} onClick={() => void save()}>
              {draft.id === null ? 'Add KPI' : 'Save KPI'}
            </Button>
          </div>
        </div>
      )}

      <Table caption="KPIs">
        <TableHead>
          <TableRow>
            <TableHeaderCell>KPI</TableHeaderCell>
            <TableHeaderCell>Role</TableHeaderCell>
            <TableHeaderCell>Period</TableHeaderCell>
            {showCampus ? <TableHeaderCell>Campus</TableHeaderCell> : null}
            <TableHeaderCell align="end">
              <span className="sr-only">Actions</span>
            </TableHeaderCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {kpis.length === 0 ? (
            <TableEmptyRow colSpan={showCampus ? 5 : 4}>
              No KPIs yet. Add the first one — for example Punctuality, for Teacher, monthly.
            </TableEmptyRow>
          ) : (
            kpis.map((row) => (
              <TableRow key={row.id}>
                <TableCell>
                  <p className="font-medium text-ink">{row.name}</p>
                  {row.description === null ? null : (
                    <p className="mt-0.5 text-sm text-ink-muted">{row.description}</p>
                  )}
                </TableCell>
                <TableCell>{ROLE_LABELS[row.targetRole]}</TableCell>
                <TableCell>
                  <Badge variant={row.period === 'monthly' ? 'info' : 'neutral'}>
                    {KPI_PERIOD_LABELS[row.period]}
                  </Badge>
                </TableCell>
                {showCampus ? <TableCell>{row.branchName ?? 'Every campus'}</TableCell> : null}
                <TableCell align="end">
                  <div className="flex justify-end gap-2">
                    {canCreate && canTouch(row) ? (
                      <Button
                        size="sm"
                        variant="secondary"
                        disabled={saving || busyId !== null}
                        onClick={() => {
                          setDraft({
                            id: row.id,
                            name: row.name,
                            description: row.description ?? '',
                            targetRole: row.targetRole,
                            period: row.period,
                            branchId: row.branchId ?? '',
                          });
                          setError(null);
                          setNotice(null);
                        }}
                      >
                        Edit
                      </Button>
                    ) : null}
                    {canDelete && canTouch(row) ? (
                      <Button
                        size="sm"
                        variant="ghost"
                        isLoading={busyId === row.id}
                        disabled={saving || (busyId !== null && busyId !== row.id)}
                        onClick={() => void remove(row)}
                      >
                        Delete
                      </Button>
                    ) : null}
                  </div>
                </TableCell>
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>
    </Card>
  );
}
