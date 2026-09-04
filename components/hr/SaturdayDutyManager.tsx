'use client';

import { useCallback, useEffect, useState } from 'react';

import { Button } from '@/components/ui/Button';
import { Card, CardTitle } from '@/components/ui/Card';
import { schoolErrorMessage, schoolFetch } from '@/lib/school-client';
import { cn } from '@/lib/utils';
import { CONFIGURABLE_ROLES } from '@/lib/permissions';
import { ROLE_LABELS, type UserRole } from '@/types/school-auth';

/**
 * Who comes in on which Saturday.
 *
 * ── Two levels, because the requirement has two ──────────────────────────
 * *"Teachers and coordinators are called every Saturday while the principal
 * comes in on 2"* is a **role** rule. *"Four coordinators each come on one
 * distinct Saturday"* is a **person** rule, and the second contradicts the
 * first on purpose. So the screen has both: a row of five checkboxes per role,
 * and a table where one person can be given their own answer.
 *
 * ── "Use the role policy" is a state, not an empty selection ─────────────
 * `staff.saturday_ordinals` distinguishes **null** — no override — from **`[]`**,
 * an override meaning *no Saturdays*. They are one character apart in the
 * database and opposite in meaning, so the table says which one a person is on
 * and gives a way back: *Use role policy* clears the override, and un-ticking
 * every box sets an empty one. A screen that could not express both would make
 * it impossible to excuse one coordinator from a rota her colleagues are on.
 */

const ORDINALS = [1, 2, 3, 4, 5];
const ORDINAL_LABELS = ['1st', '2nd', '3rd', '4th', '5th'];

interface PolicyRow {
  role: string;
  ordinals: number[];
  isSet: boolean;
}

interface StaffRow {
  staffId: string;
  name: string;
  employeeCode: string;
  role: UserRole | null;
  designation: string | null;
  own: number[] | null;
  rolePolicy: number[] | null;
  effective: number[];
}

export interface SaturdayDutyManagerProps {
  canWrite: boolean;
}

/** The five boxes, shared by the role rows and the staff rows. */
function OrdinalBoxes({
  selected,
  disabled,
  onToggle,
}: {
  selected: readonly number[];
  disabled: boolean;
  onToggle: (ordinal: number) => void;
}) {
  return (
    <div className="flex gap-1">
      {ORDINALS.map((ordinal) => (
        <button
          key={ordinal}
          type="button"
          disabled={disabled}
          aria-pressed={selected.includes(ordinal)}
          aria-label={`${ORDINAL_LABELS[ordinal - 1] ?? String(ordinal)} Saturday`}
          className={cn(
            'h-8 w-10 rounded-lg border text-xs font-medium transition-colors',
            selected.includes(ordinal)
              ? 'border-brand bg-brand text-brand-on'
              : 'border-line bg-surface text-ink-muted hover:bg-surface-subtle',
            disabled && 'cursor-not-allowed opacity-60',
          )}
          onClick={() => {
            onToggle(ordinal);
          }}
        >
          {ORDINAL_LABELS[ordinal - 1]}
        </button>
      ))}
    </div>
  );
}

export function SaturdayDutyManager({ canWrite }: SaturdayDutyManagerProps) {
  const [policies, setPolicies] = useState<PolicyRow[] | null>(null);
  const [staff, setStaff] = useState<StaffRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [busyStaffId, setBusyStaffId] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const payload = await schoolFetch<{ policies: PolicyRow[]; staff: StaffRow[] }>(
        '/api/school/hr/saturday-duty',
      );
      // Only the roles a school can configure. A toggle against `student` or
      // `parent` would be a control that does nothing, which is the worst kind
      // to put in front of an administrator — the same reasoning
      // `CONFIGURABLE_ROLES` exists for on the permissions screen.
      setPolicies(
        payload.policies.filter((row) =>
          (CONFIGURABLE_ROLES as readonly string[]).includes(row.role),
        ),
      );
      setStaff(payload.staff);
      setError(null);
    } catch (caught) {
      setPolicies([]);
      setError(schoolErrorMessage(caught, 'Could not read the Saturday roster.'));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const togglePolicy = (role: string, ordinal: number): void => {
    setPolicies((current) =>
      (current ?? []).map((row) =>
        row.role === role
          ? {
              ...row,
              isSet: true,
              ordinals: row.ordinals.includes(ordinal)
                ? row.ordinals.filter((value) => value !== ordinal)
                : [...row.ordinals, ordinal].sort((left, right) => left - right),
            }
          : row,
      ),
    );
  };

  const savePolicies = async (): Promise<void> => {
    setSaving(true);
    setError(null);

    try {
      await schoolFetch('/api/school/hr/saturday-duty', {
        method: 'PATCH',
        body: JSON.stringify({
          policies: (policies ?? []).map((row) => ({
            role: row.role,
            ordinals: row.ordinals,
          })),
        }),
      });

      setNotice('Saturday roster saved.');
      await load();
    } catch (caught) {
      setError(schoolErrorMessage(caught, 'Could not save the roster.'));
    } finally {
      setSaving(false);
    }
  };

  const setOverride = async (
    row: StaffRow,
    ordinals: number[] | null,
  ): Promise<void> => {
    setBusyStaffId(row.staffId);
    setError(null);

    try {
      await schoolFetch('/api/school/hr/saturday-duty', {
        method: 'PATCH',
        body: JSON.stringify({ staffId: row.staffId, ordinals }),
      });

      setNotice(
        ordinals === null
          ? `${row.name} follows their role’s Saturdays again.`
          : `${row.name}’s Saturdays saved.`,
      );
      await load();
    } catch (caught) {
      setError(schoolErrorMessage(caught, 'Could not save that override.'));
    } finally {
      setBusyStaffId(null);
    }
  };

  return (
    <div className="space-y-4">
      {error === null ? null : (
        <p
          role="alert"
          className="rounded-lg bg-status-danger-subtle px-3 py-2 text-sm text-status-danger-ink"
        >
          {error}
        </p>
      )}

      {notice === null ? null : (
        <p
          role="status"
          className="rounded-lg bg-status-success-subtle px-3 py-2 text-sm text-status-success-onSubtle"
        >
          {notice}
        </p>
      )}

      <Card
        header={
          <CardTitle
            title="By role"
            description="The school's default. Which Saturday of the month each role is called in on — a month can have five."
          />
        }
      >
        {policies === null ? (
          <p className="text-sm text-ink-muted">Reading the roster…</p>
        ) : (
          <ul className="divide-y divide-line">
            {policies.map((row) => (
              <li
                key={row.role}
                className="flex flex-wrap items-center justify-between gap-3 py-3"
              >
                <div>
                  <p className="text-sm font-medium text-ink">
                    {ROLE_LABELS[row.role as UserRole] ?? row.role}
                  </p>
                  {row.isSet ? null : (
                    <p className="text-xs text-ink-muted">
                      Not set — nobody in this role is called in on a Saturday.
                    </p>
                  )}
                </div>

                <OrdinalBoxes
                  selected={row.ordinals}
                  disabled={!canWrite}
                  onToggle={(ordinal) => {
                    togglePolicy(row.role, ordinal);
                  }}
                />
              </li>
            ))}
          </ul>
        )}

        {canWrite ? (
          <div className="mt-4 flex justify-end">
            <Button
              isLoading={saving}
              onClick={() => {
                void savePolicies();
              }}
            >
              Save the roster
            </Button>
          </div>
        ) : null}
      </Card>

      <Card
        header={
          <CardTitle
            title="By person"
            description="An override for one member of staff. Four coordinators on four distinct Saturdays is what this is for."
          />
        }
      >
        {staff.length === 0 ? (
          <p className="text-sm text-ink-muted">No active staff to roster.</p>
        ) : (
          <ul className="divide-y divide-line">
            {staff.map((row) => (
              <li
                key={row.staffId}
                className="flex flex-wrap items-center justify-between gap-3 py-3"
              >
                <div className="min-w-0">
                  <p className="text-sm font-medium text-ink">{row.name}</p>
                  <p className="text-xs text-ink-muted">
                    {row.employeeCode}
                    {row.role === null ? '' : ` · ${ROLE_LABELS[row.role]}`}
                    {row.own === null ? ' · follows the role policy' : ' · own Saturdays'}
                  </p>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <OrdinalBoxes
                    selected={row.effective}
                    disabled={!canWrite || busyStaffId === row.staffId}
                    onToggle={(ordinal) => {
                      const next = row.effective.includes(ordinal)
                        ? row.effective.filter((value) => value !== ordinal)
                        : [...row.effective, ordinal].sort((left, right) => left - right);

                      void setOverride(row, next);
                    }}
                  />

                  {row.own === null ? null : (
                    <Button
                      size="sm"
                      variant="secondary"
                      disabled={!canWrite || busyStaffId === row.staffId}
                      onClick={() => {
                        void setOverride(row, null);
                      }}
                    >
                      Use role policy
                    </Button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
