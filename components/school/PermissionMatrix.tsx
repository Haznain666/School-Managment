'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';

import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card, CardTitle } from '@/components/ui/Card';
import {
  CONFIGURABLE_ROLES,
  PERMISSION_DESCRIPTIONS,
  PERMISSION_GROUPS,
  PERMISSION_LABELS,
  UNREVOKABLE,
  type Permission,
} from '@/lib/permissions';
import { cn } from '@/lib/utils';
import { schoolErrorMessage, schoolFetch } from '@/lib/school-client';
import { ROLE_DESCRIPTIONS, ROLE_LABELS, type UserRole } from '@/types/school-auth';

/**
 * Who may do what, at this school.
 *
 * ── Why the changed cells are marked ─────────────────────────────────────
 * Every cell shows its current answer, but a cell the school has moved away
 * from the platform default carries a dot. Without it an administrator has no
 * way to tell "we decided this" from "this is how it shipped", and a year later
 * nobody can say whether an odd-looking grant was deliberate.
 *
 * ── Why nothing saves until you press Save ───────────────────────────────
 * Access control edited one auto-saving toggle at a time passes through states
 * nobody chose — revoke-then-grant briefly locks someone out mid-edit. Changes
 * are staged locally and sent as one batch, and the count is shown so the
 * administrator knows exactly how much is pending.
 */

interface MatrixResponse {
  matrix: Record<UserRole, Permission[]>;
  defaults: Record<UserRole, Permission[]>;
}

export interface PermissionMatrixProps {
  canEdit: boolean;
}

type CellKey = `${UserRole}:${Permission}`;

function keyOf(role: UserRole, permission: Permission): CellKey {
  return `${role}:${permission}`;
}

export function PermissionMatrix({ canEdit }: PermissionMatrixProps) {
  const [data, setData] = useState<MatrixResponse | null>(null);
  const [staged, setStaged] = useState<Map<CellKey, boolean>>(new Map());
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const payload = await schoolFetch<MatrixResponse>('/api/school/permissions');
      setData(payload);
      setStaged(new Map());
      setError(null);
    } catch (caught) {
      setError(schoolErrorMessage(caught, 'Could not load the permissions.'));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  /** The value a cell currently shows: staged edit if any, else what is saved. */
  const valueOf = useCallback(
    (role: UserRole, permission: Permission): boolean => {
      const stagedValue = staged.get(keyOf(role, permission));
      if (stagedValue !== undefined) return stagedValue;

      return data?.matrix[role].includes(permission) ?? false;
    },
    [data, staged],
  );

  const isDefault = useCallback(
    (role: UserRole, permission: Permission): boolean =>
      valueOf(role, permission) === (data?.defaults[role].includes(permission) ?? false),
    [data, valueOf],
  );

  const toggle = (role: UserRole, permission: Permission): void => {
    if (!canEdit) return;
    if (role === UNREVOKABLE.role && permission === UNREVOKABLE.permission) return;

    const next = new Map(staged);
    const key = keyOf(role, permission);
    const saved = data?.matrix[role].includes(permission) ?? false;
    const wanted = !valueOf(role, permission);

    // Toggling back to the saved value un-stages the change rather than
    // recording a no-op, so the pending count stays honest.
    if (wanted === saved) next.delete(key);
    else next.set(key, wanted);

    setStaged(next);
    setNotice(null);
  };

  const save = async (): Promise<void> => {
    if (staged.size === 0) return;

    setBusy(true);
    setError(null);
    setNotice(null);

    const changes = [...staged.entries()].map(([key, isGranted]) => {
      const [role, permission] = key.split(':') as [UserRole, Permission];
      return { role, permission, isGranted };
    });

    try {
      const payload = await schoolFetch<{ matrix: Record<UserRole, Permission[]>; changed: number }>(
        '/api/school/permissions',
        { method: 'PATCH', body: JSON.stringify({ changes }) },
      );

      setData((current) =>
        current === null ? current : { ...current, matrix: payload.matrix },
      );
      setStaged(new Map());
      setNotice(
        `Saved ${payload.changed} change${payload.changed === 1 ? '' : 's'}. People already signed in pick this up on their next page load.`,
      );
    } catch (caught) {
      setError(schoolErrorMessage(caught, 'Could not save the permissions.'));
    } finally {
      setBusy(false);
    }
  };

  const changedFromDefault = useMemo(() => {
    if (data === null) return 0;

    let count = 0;
    for (const role of CONFIGURABLE_ROLES) {
      for (const group of PERMISSION_GROUPS) {
        for (const permission of group.permissions) {
          if (!isDefault(role, permission)) count += 1;
        }
      }
    }
    return count;
  }, [data, isDefault]);

  if (data === null) {
    return (
      <Card>
        <p className="text-sm text-ink-muted">{error ?? 'Loading permissions…'}</p>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      {error !== null ? (
        <p role="alert" className="rounded-lg bg-status-danger-subtle px-3 py-2 text-sm text-status-danger-ink">
          {error}
        </p>
      ) : null}

      {notice !== null ? (
        <p className="rounded-lg bg-status-success-subtle px-3 py-2 text-sm text-status-success-ink">
          {notice}
        </p>
      ) : null}

      <Card>
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <p className="text-sm text-ink-muted">
              {changedFromDefault === 0
                ? 'Every permission is at the platform default.'
                : `${changedFromDefault} permission${changedFromDefault === 1 ? '' : 's'} differ from the platform default, marked with a dot.`}
            </p>
            {staged.size > 0 ? (
              <p className="mt-1 text-sm font-medium text-status-warning-onSubtle">
                {staged.size} unsaved change{staged.size === 1 ? '' : 's'}.
              </p>
            ) : null}
          </div>

          {canEdit ? (
            <div className="flex gap-3">
              <Button
                isLoading={busy}
                disabled={staged.size === 0}
                onClick={() => {
                  void save();
                }}
              >
                Save changes
              </Button>
              <Button
                variant="ghost"
                disabled={staged.size === 0}
                onClick={() => {
                  setStaged(new Map());
                  setNotice(null);
                }}
              >
                Discard
              </Button>
            </div>
          ) : null}
        </div>
      </Card>

      {PERMISSION_GROUPS.map((group) => (
        <Card
          key={group.key}
          header={<CardTitle title={group.label} />}
          className="p-0"
        >
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-line text-xs uppercase tracking-wide text-ink-muted">
                <tr>
                  <th scope="col" className="px-5 py-3 font-medium">Permission</th>
                  {CONFIGURABLE_ROLES.map((role) => (
                    <th
                      key={role}
                      scope="col"
                      className="px-3 py-3 text-center font-medium"
                      title={ROLE_DESCRIPTIONS[role]}
                    >
                      {ROLE_LABELS[role]}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {group.permissions.map((permission) => (
                  <tr key={permission}>
                    <th scope="row" className="px-5 py-3 text-left font-normal">
                      <span className="font-medium text-ink">
                        {PERMISSION_LABELS[permission]}
                      </span>
                      {PERMISSION_DESCRIPTIONS[permission] === undefined ? null : (
                        <span className="block text-xs text-ink-muted">
                          {PERMISSION_DESCRIPTIONS[permission]}
                        </span>
                      )}
                    </th>

                    {CONFIGURABLE_ROLES.map((role) => {
                      const granted = valueOf(role, permission);
                      const locked =
                        role === UNREVOKABLE.role &&
                        permission === UNREVOKABLE.permission;
                      const moved = !isDefault(role, permission);

                      return (
                        <td key={role} className="px-3 py-3 text-center">
                          <button
                            type="button"
                            role="switch"
                            aria-checked={granted}
                            aria-label={`${PERMISSION_LABELS[permission]} for ${ROLE_LABELS[role]}`}
                            disabled={!canEdit || locked}
                            title={
                              locked
                                ? 'A School Administrator always keeps this.'
                                : undefined
                            }
                            onClick={() => {
                              toggle(role, permission);
                            }}
                            className={cn(
                              'relative inline-flex h-7 w-7 items-center justify-center rounded-full text-sm font-semibold transition',
                              'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-primary',
                              'disabled:cursor-not-allowed disabled:opacity-60',
                              granted
                                ? 'bg-status-success text-status-success-on'
                                : 'bg-surface-sunken text-ink-muted hover:bg-line',
                            )}
                          >
                            {granted ? '✓' : '—'}
                            {moved ? (
                              <span
                                aria-hidden="true"
                                title="Changed from the platform default"
                                className="absolute -right-0.5 -top-0.5 h-2 w-2 rounded-full bg-amber-500 ring-2 ring-white"
                              />
                            ) : null}
                          </button>
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      ))}

      <Card header={<CardTitle title="What each role is for" />}>
        <dl className="grid gap-3 sm:grid-cols-2">
          {CONFIGURABLE_ROLES.map((role) => (
            <div key={role}>
              <dt className="text-sm font-medium text-ink">
                {ROLE_LABELS[role]}
                {role === UNREVOKABLE.role ? (
                  <Badge className="ml-2" variant="neutral">
                    Always manages permissions
                  </Badge>
                ) : null}
              </dt>
              <dd className="text-sm text-ink-muted">{ROLE_DESCRIPTIONS[role]}</dd>
            </div>
          ))}
        </dl>
      </Card>
    </div>
  );
}
