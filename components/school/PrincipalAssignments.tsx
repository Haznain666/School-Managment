'use client';

import { useEffect, useMemo, useState } from 'react';

import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card, CardTitle } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/EmptyState';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { Toggle } from '@/components/ui/Toggle';
import { PRINCIPAL_MODEL_LABELS, type PrincipalModel } from '@/db/schema';
import { schoolErrorMessage, schoolFetch } from '@/lib/school-client';

/**
 * BR4's one screen — who runs which campus or division.
 *
 * ── It opens closed ──────────────────────────────────────────────────────
 * A school on the `single` model sees the switch and a sentence, and nothing
 * else. The assignment list is not rendered at all, rather than rendered
 * disabled: a school with one head has no arrangement to configure, and a
 * greyed-out list of controls invites the question "what am I missing?".
 *
 * ── The empty division is stated, not hidden ─────────────────────────────
 * A division with no classes reaches no students. That is a legal state — it is
 * what a division looks like the moment it is named — and the row says
 * "no classes yet" in words rather than showing a blank cell, because the head
 * assigned to it will otherwise see an empty school with no explanation.
 *
 * ── It lives on the campus now, not in Settings (Sprint 19a, item 10) ────
 * The question this screen answers is "who runs *this* campus", and it was
 * being asked on a page about the school's logo and address. Settings lost the
 * card; the component did not move house so much as find the room it belonged
 * in. `onlyBranchId` is what makes that work: the campus page passes its own
 * id, the list shows that campus's heads and nobody else's, and the new-
 * assignment form has its campus answered already.
 *
 * With no `onlyBranchId` it behaves exactly as it always has — school-wide,
 * every campus — which is what the Super Admin surface and any future
 * whole-school screen still want.
 */

interface AssignmentRow {
  id: string;
  schoolUserId: string;
  principalName: string;
  principalEmail: string | null;
  branchId: string | null;
  branchName: string | null;
  divisionName: string | null;
  gradeIds: string[];
  startsOn: string;
  endsOn: string | null;
}

interface PrincipalOption {
  id: string;
  name: string;
  email: string | null;
}

interface GradeOption {
  id: string;
  name: string;
}

interface BranchOption {
  id: string;
  name: string;
}

/** One grade already held by one head, under an assignment in force today. */
interface GradeClaim {
  gradeId: string;
  schoolUserId: string;
  assignmentId: string;
  principalName: string;
}

interface Payload {
  principalModel: PrincipalModel;
  /** Sprint 23, item 2. Set in Settings; the picker only reports it. */
  allowSharedGrades: boolean;
  assignments: AssignmentRow[];
  principals: PrincipalOption[];
  grades: GradeOption[];
  claimedGrades: GradeClaim[];
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

/** Current if it has started and has not ended. Mirrors the resolver's filter. */
function isCurrent(row: AssignmentRow): boolean {
  const now = todayIso();
  if (row.startsOn > now) return false;
  return row.endsOn === null || row.endsOn >= now;
}

export function PrincipalAssignments({
  branches,
  canEdit,
  onlyBranchId,
}: {
  branches: readonly BranchOption[];
  canEdit: boolean;
  /**
   * Narrow the whole card to one campus.
   *
   * A school-wide assignment — `branch_id IS NULL`, the head who runs
   * everything — is **included**, and that is deliberate: it is in force at
   * this campus, and a screen that omitted it would answer "who runs this
   * campus" with a name that is not the whole answer.
   */
  onlyBranchId?: string;
}) {
  const [payload, setPayload] = useState<Payload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [newPrincipal, setNewPrincipal] = useState('');
  const [newBranch, setNewBranch] = useState('');
  const [newDivision, setNewDivision] = useState('');
  const [newGrades, setNewGrades] = useState<string[]>([]);
  const [newStart, setNewStart] = useState(todayIso());

  const load = async (): Promise<void> => {
    try {
      setPayload(await schoolFetch<Payload>('/api/school/principals'));
    } catch (caught) {
      setError(schoolErrorMessage(caught, 'Could not load principal assignments.'));
    }
  };

  useEffect(() => {
    // Loaded once on mount; every mutation below refreshes it explicitly.
    void load();
  }, []);

  const gradeNames = useMemo(
    () => new Map((payload?.grades ?? []).map((grade) => [grade.id, grade.name])),
    [payload],
  );

  /*
   * Which grades are spoken for, and by whom — Sprint 23, item 2.
   *
   * Keyed by grade so the picker can answer "taken, by X" in one lookup per
   * chip. Claims held by the principal *currently selected in the form* are
   * dropped: a person does not clash with themselves, and greying out the
   * grades somebody already holds would make it impossible to add a second
   * assignment to the same head.
   */
  const takenBy = useMemo(() => {
    const map = new Map<string, string>();
    for (const claim of payload?.claimedGrades ?? []) {
      if (claim.schoolUserId === newPrincipal) continue;
      if (!map.has(claim.gradeId)) map.set(claim.gradeId, claim.principalName);
    }
    return map;
  }, [payload, newPrincipal]);

  /** Everyone else in force on a grade this row holds. The warning chip. */
  const overlapsFor = (row: AssignmentRow): string[] => [
    ...new Set(
      (payload?.claimedGrades ?? [])
        .filter(
          (claim) =>
            claim.schoolUserId !== row.schoolUserId &&
            row.gradeIds.includes(claim.gradeId),
        )
        .map((claim) => claim.principalName),
    ),
  ];

  const setModel = async (model: PrincipalModel): Promise<void> => {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await schoolFetch('/api/school/principals', {
        method: 'PATCH',
        body: JSON.stringify({ principalModel: model }),
      });
      setNotice(
        model === 'multiple'
          ? 'Your school now runs separate principals. Assign each one below.'
          : 'Your school is back to one principal. Existing assignments are kept but ignored.',
      );
      await load();
    } catch (caught) {
      setError(schoolErrorMessage(caught, 'Could not change the principal model.'));
    } finally {
      setBusy(false);
    }
  };

  const create = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await schoolFetch('/api/school/principals', {
        method: 'POST',
        body: JSON.stringify({
          schoolUserId: newPrincipal,
          branchId: newBranch === '' ? null : newBranch,
          divisionName: newDivision.trim() === '' ? null : newDivision.trim(),
          gradeIds: newGrades,
          startsOn: newStart,
        }),
      });
      setNotice('Assignment added.');
      setNewPrincipal('');
      setNewBranch('');
      setNewDivision('');
      setNewGrades([]);
      setNewStart(todayIso());
      await load();
    } catch (caught) {
      setError(schoolErrorMessage(caught, 'Could not add that assignment.'));
    } finally {
      setBusy(false);
    }
  };

  const end = async (row: AssignmentRow): Promise<void> => {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await schoolFetch(`/api/school/principals/${row.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ endsOn: todayIso() }),
      });
      setNotice(`${row.principalName}’s assignment ends today.`);
      await load();
    } catch (caught) {
      setError(schoolErrorMessage(caught, 'Could not end that assignment.'));
    } finally {
      setBusy(false);
    }
  };

  const remove = async (row: AssignmentRow): Promise<void> => {
    // Deleting drops the record of who ran what, so it is confirmed and the
    // confirmation says which of the two acts this is.
    if (
      !window.confirm(
        `Delete ${row.principalName}’s assignment entirely? If they simply left the post, end it instead — that keeps the record of who ran this division.`,
      )
    ) {
      return;
    }

    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await schoolFetch(`/api/school/principals/${row.id}`, { method: 'DELETE' });
      setNotice('Assignment deleted.');
      await load();
    } catch (caught) {
      setError(schoolErrorMessage(caught, 'Could not delete that assignment.'));
    } finally {
      setBusy(false);
    }
  };

  if (payload === null) {
    return (
      <Card header={<CardTitle title="Principals" />}>
        <p className="text-sm text-ink-muted">
          {error ?? 'Loading principal assignments…'}
        </p>
      </Card>
    );
  }

  const visible =
    onlyBranchId === undefined
      ? payload.assignments
      : payload.assignments.filter(
          (row) => row.branchId === onlyBranchId || row.branchId === null,
        );

  const current = visible.filter(isCurrent);
  const ended = visible.filter((row) => !isCurrent(row));
  const multiple = payload.principalModel === 'multiple';

  return (
    <Card
      header={
        <CardTitle
          title="Principals"
          description="Whether one head runs the whole school, or each campus and division has its own."
        />
      }
    >
      {error !== null ? (
        <p
          role="alert"
          className="mb-4 rounded-lg bg-status-danger-subtle px-3 py-2 text-sm text-status-danger-ink"
        >
          {error}
        </p>
      ) : null}

      {notice !== null ? (
        <p className="mb-4 rounded-lg bg-status-success-subtle px-3 py-2 text-sm text-status-success-ink">
          {notice}
        </p>
      ) : null}

      <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg bg-surface-sunken p-4">
        <div className="min-w-0">
          <p className="text-sm font-medium text-ink">
            {PRINCIPAL_MODEL_LABELS[payload.principalModel]}
          </p>
          <p className="mt-1 text-xs text-ink-muted">
            An assignment narrows what a head sees — their campus, their classes.
            It does not change what their role may do.
          </p>
        </div>
        <Toggle
          checked={multiple}
          onChange={(next) => void setModel(next ? 'multiple' : 'single')}
          disabled={!canEdit || busy}
          label="Separate principals"
        />
      </div>

      {!multiple ? (
        <p className="mt-4 text-sm text-ink-muted">
          One principal sees the whole school. Turn this on if your school runs
          O-Levels and Matric — or two campuses — under separate heads.
        </p>
      ) : (
        <div className="mt-6 space-y-6">
          {current.length === 0 ? (
            <EmptyState
              title="No principal is assigned"
              description="Until somebody is assigned, every principal at this school sees an empty school and is told to ask you."
            />
          ) : (
            <ul className="divide-y divide-line">
              {current.map((row) => (
                <li key={row.id} className="flex flex-wrap items-start justify-between gap-3 py-3">
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-ink">{row.principalName}</p>
                    <p className="mt-0.5 text-xs text-ink-muted">
                      {row.divisionName ?? 'Whole school'}
                      {' · '}
                      {row.branchName ?? 'Every campus'}
                      {' · from '}
                      {row.startsOn}
                      {row.endsOn === null ? '' : ` until ${row.endsOn}`}
                    </p>
                    <p className="mt-1 text-xs text-ink-muted">
                      {row.gradeIds.length === 0 ? (
                        row.divisionName === null ? (
                          'Every class.'
                        ) : (
                          <span className="text-status-warning-ink">
                            No classes yet — this head reaches no students until
                            you add some.
                          </span>
                        )
                      ) : (
                        row.gradeIds
                          .map((id) => gradeNames.get(id) ?? 'Unknown class')
                          .join(', ')
                      )}
                    </p>

                    {/*
                      Sprint 23, item 2 — the grandfathered overlap, stated.

                      A school may already have two heads on one class, and the
                      migration deliberately did not unassign either of them.
                      Shown as a chip rather than left to be discovered: an
                      administrator who turns the new rule on and then wonders
                      why it "did not work" is looking at rows that predate it.
                    */}
                    {overlapsFor(row).length > 0 ? (
                      <p className="mt-1">
                        <Badge variant="warning">
                          Also assigned to {overlapsFor(row).join(', ')}
                        </Badge>
                      </p>
                    ) : null}
                  </div>

                  {canEdit ? (
                    <div className="flex shrink-0 gap-2">
                      <Button
                        variant="secondary"
                        size="sm"
                        disabled={busy}
                        onClick={() => void end(row)}
                      >
                        End today
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        disabled={busy}
                        onClick={() => void remove(row)}
                      >
                        Delete
                      </Button>
                    </div>
                  ) : null}
                </li>
              ))}
            </ul>
          )}

          {ended.length > 0 ? (
            <details className="rounded-lg border border-line p-3">
              <summary className="cursor-pointer text-sm font-medium text-ink">
                Ended and future assignments ({ended.length})
              </summary>
              <ul className="mt-3 divide-y divide-line">
                {ended.map((row) => (
                  <li key={row.id} className="flex items-center justify-between gap-3 py-2">
                    <span className="text-sm text-ink-muted">
                      {row.principalName} — {row.divisionName ?? 'Whole school'},{' '}
                      {row.startsOn}
                      {row.endsOn === null ? '' : ` to ${row.endsOn}`}
                    </span>
                    <Badge variant="neutral">
                      {row.startsOn > todayIso() ? 'Starts later' : 'Ended'}
                    </Badge>
                  </li>
                ))}
              </ul>
            </details>
          ) : null}

          {canEdit ? (
            <div className="rounded-lg border border-line p-4">
              <h4 className="text-sm font-semibold text-ink">Assign a principal</h4>

              {payload.principals.length === 0 ? (
                <p className="mt-2 text-sm text-ink-muted">
                  Nobody at this school holds the Principal role yet. Add one on
                  the Users page first.
                </p>
              ) : (
                <div className="mt-3 grid gap-3 sm:grid-cols-2">
                  <Select
                    label="Principal"
                    placeholder="Choose…"
                    value={newPrincipal}
                    onChange={(event) => setNewPrincipal(event.target.value)}
                    options={payload.principals.map((principal) => ({
                      value: principal.id,
                      label:
                        principal.email === null
                          ? principal.name
                          : `${principal.name} — ${principal.email}`,
                    }))}
                  />

                  <Select
                    label="Campus"
                    value={newBranch}
                    onChange={(event) => setNewBranch(event.target.value)}
                    options={[
                      { value: '', label: 'Every campus' },
                      ...branches.map((branch) => ({
                        value: branch.id,
                        label: branch.name,
                      })),
                    ]}
                  />

                  <Input
                    label="Division"
                    placeholder="O-Levels, Matric, Girls' Wing…"
                    value={newDivision}
                    maxLength={60}
                    onChange={(event) => setNewDivision(event.target.value)}
                    hint="Leave blank if this head runs everything at the campus above."
                  />

                  <Input
                    label="Starts on"
                    type="date"
                    value={newStart}
                    onChange={(event) => setNewStart(event.target.value)}
                  />

                  <fieldset className="sm:col-span-2">
                    <legend className="text-sm font-medium text-ink">
                      Classes in this division
                    </legend>
                    <p className="mt-0.5 text-xs text-ink-muted">
                      Leave every box clear to give this head all of them.
                    </p>
                    <div className="mt-2 flex flex-wrap gap-2">
                      {payload.grades.map((grade) => {
                        const on = newGrades.includes(grade.id);
                        /*
                         * Sprint 23, item 2. A grade another head holds is
                         * offered disabled and *labelled with their name*,
                         * rather than being selectable and then refused. The
                         * server refuses regardless — this is the courtesy.
                         *
                         * With the school-wide setting on, nothing is greyed:
                         * sharing is what the school has asked for.
                         */
                        const heldBy = payload.allowSharedGrades
                          ? undefined
                          : takenBy.get(grade.id);
                        const blocked = heldBy !== undefined && !on;

                        return (
                          <button
                            key={grade.id}
                            type="button"
                            aria-pressed={on}
                            disabled={blocked}
                            title={
                              blocked
                                ? `Already assigned to ${heldBy}. Turn on “Allow a class to have more than one principal” in Settings, or remove it from their assignment first.`
                                : undefined
                            }
                            onClick={() =>
                              setNewGrades((prev) =>
                                on
                                  ? prev.filter((id) => id !== grade.id)
                                  : [...prev, grade.id],
                              )
                            }
                            className={
                              on
                                ? 'rounded-full bg-brand-primary px-3 py-1 text-xs font-medium text-brand-onPrimary'
                                : blocked
                                  ? 'cursor-not-allowed rounded-full bg-surface-sunken px-3 py-1 text-xs font-medium text-ink-faint'
                                  : 'rounded-full bg-surface-sunken px-3 py-1 text-xs font-medium text-ink-muted hover:bg-line'
                            }
                          >
                            {grade.name}
                            {blocked ? ` · ${heldBy}` : ''}
                          </button>
                        );
                      })}
                    </div>
                  </fieldset>

                  <div className="sm:col-span-2">
                    <Button
                      onClick={() => void create()}
                      isLoading={busy}
                      disabled={newPrincipal === '' || newStart === ''}
                    >
                      Add assignment
                    </Button>
                  </div>
                </div>
              )}
            </div>
          ) : null}
        </div>
      )}
    </Card>
  );
}
