'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';

import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card, CardTitle } from '@/components/ui/Card';
import { Input } from '@/components/ui/Input';
import { formatTimeOfDay, slotTimeProblem } from '@/db/schema/timetable-slots';
import { schoolErrorMessage, schoolFetch } from '@/lib/school-client';

/**
 * Period schedules — the named bell schedules, their periods, and the grades on
 * each.
 *
 * ── What this replaces, and why it grew ──────────────────────────────────
 * `SlotManager` edited one flat list of periods per school, and its own comment
 * explained the placement: it lives beside the builder because an admin comes
 * here when a period is missing from the week they are trying to fill. That is
 * still true, and it is why this is still on the timetable page rather than
 * promoted to a settings screen of its own.
 *
 * What changed is that a school has more than one of these. A school teaching
 * Pre-Nursery and Class 10 on one campus keeps two different days, and the flat
 * list could hold only one of them.
 *
 * ── The screen a one-bell school sees ────────────────────────────────────
 * Almost exactly the old one. A school with a single schedule sees a single
 * card with its periods in it; the grade assignment reads "Every grade" and
 * needs no attention, because an unassigned grade falls back to the default.
 * The second schedule is opt-in, and nothing about the first one asks a
 * question until somebody adds it.
 */

interface StructureRow {
  id: string;
  name: string;
  description: string | null;
  isDefault: boolean;
  isActive: boolean;
}

interface SlotRow {
  id: string;
  periodStructureId: string;
  name: string;
  startTime: string;
  endTime: string;
  isBreak: boolean;
  orderIndex: number;
  isActive: boolean;
}

interface AssignmentRow {
  gradeId: string;
  periodStructureId: string;
}

export interface PeriodStructureGradeOption {
  id: string;
  label: string;
  branchName: string | null;
}

export interface PeriodStructureManagerProps {
  canEdit: boolean;
  grades: readonly PeriodStructureGradeOption[];
  /** Refreshes the builder above when the schedule underneath it changes. */
  onChanged?: (() => void) | undefined;
}

interface SlotDraft {
  id: string | null;
  structureId: string;
  name: string;
  startTime: string;
  endTime: string;
  isBreak: boolean;
  orderIndex: string;
}

interface StructureDraft {
  id: string | null;
  name: string;
  description: string;
}

interface Payload {
  structures: StructureRow[];
  slots: SlotRow[];
  assignments: AssignmentRow[];
}

export function PeriodStructureManager({
  canEdit,
  grades,
  onChanged,
}: PeriodStructureManagerProps) {
  const [payload, setPayload] = useState<Payload | null>(null);
  const [slotDraft, setSlotDraft] = useState<SlotDraft | null>(null);
  const [structureDraft, setStructureDraft] = useState<StructureDraft | null>(null);
  const [assigning, setAssigning] = useState<{ id: string; gradeIds: string[] } | null>(
    null,
  );
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setPayload(await schoolFetch<Payload>('/api/school/timetable/structures'));
      setError(null);
    } catch (caught) {
      setError(schoolErrorMessage(caught, 'Could not load the period schedules.'));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const refresh = async (): Promise<void> => {
    await load();
    onChanged?.();
  };

  const slotsByStructure = useMemo(() => {
    const map = new Map<string, SlotRow[]>();
    for (const slot of payload?.slots ?? []) {
      const list = map.get(slot.periodStructureId) ?? [];
      list.push(slot);
      map.set(slot.periodStructureId, list);
    }
    for (const list of map.values()) {
      list.sort((left, right) => left.orderIndex - right.orderIndex);
    }
    return map;
  }, [payload]);

  const gradesByStructure = useMemo(() => {
    const byId = new Map(grades.map((grade) => [grade.id, grade]));
    const map = new Map<string, PeriodStructureGradeOption[]>();

    for (const assignment of payload?.assignments ?? []) {
      const grade = byId.get(assignment.gradeId);
      // A grade from another branch the caller cannot see: skip rather than
      // render a blank chip. A branch-scoped admin is not shown the whole
      // school's ladder, and an assignment they cannot see is not theirs to
      // reason about.
      if (grade === undefined) continue;

      const list = map.get(assignment.periodStructureId) ?? [];
      list.push(grade);
      map.set(assignment.periodStructureId, list);
    }
    return map;
  }, [payload, grades]);

  /** Grades explicitly assigned to some *other* structure. */
  const claimedElsewhere = useMemo(() => {
    const map = new Map<string, string>();
    for (const assignment of payload?.assignments ?? []) {
      map.set(assignment.gradeId, assignment.periodStructureId);
    }
    return map;
  }, [payload]);

  // ── Writes ──────────────────────────────────────────────────────────

  const saveStructure = async (): Promise<void> => {
    if (structureDraft === null) return;

    const name = structureDraft.name.trim();
    if (name === '') {
      setError('Give the schedule a name, for example “Junior school”.');
      return;
    }

    setBusy('structure');
    setError(null);

    const body = JSON.stringify({
      name,
      description: structureDraft.description.trim(),
    });

    try {
      if (structureDraft.id === null) {
        await schoolFetch('/api/school/timetable/structures', { method: 'POST', body });
      } else {
        await schoolFetch(`/api/school/timetable/structures/${structureDraft.id}`, {
          method: 'PUT',
          body,
        });
      }

      setStructureDraft(null);
      await refresh();
    } catch (caught) {
      setError(schoolErrorMessage(caught, 'Could not save the schedule.'));
    } finally {
      setBusy(null);
    }
  };

  const saveAssignment = async (): Promise<void> => {
    if (assigning === null) return;

    setBusy('assign');
    setError(null);

    try {
      await schoolFetch(`/api/school/timetable/structures/${assigning.id}`, {
        method: 'PUT',
        body: JSON.stringify({ gradeIds: assigning.gradeIds }),
      });

      setAssigning(null);
      await refresh();
    } catch (caught) {
      setError(schoolErrorMessage(caught, 'Could not save the grade assignment.'));
    } finally {
      setBusy(null);
    }
  };

  const setStructureFlag = async (
    structureId: string,
    patch: { isDefault?: boolean; isActive?: boolean },
  ): Promise<void> => {
    setBusy(structureId);
    setError(null);

    try {
      await schoolFetch(`/api/school/timetable/structures/${structureId}`, {
        method: 'PUT',
        body: JSON.stringify(patch),
      });
      await refresh();
    } catch (caught) {
      setError(schoolErrorMessage(caught, 'Could not update the schedule.'));
    } finally {
      setBusy(null);
    }
  };

  const retireStructure = async (structureId: string): Promise<void> => {
    setBusy(structureId);
    setError(null);

    try {
      await schoolFetch(`/api/school/timetable/structures/${structureId}`, {
        method: 'DELETE',
      });
      await refresh();
    } catch (caught) {
      setError(schoolErrorMessage(caught, 'Could not retire the schedule.'));
    } finally {
      setBusy(null);
    }
  };

  const saveSlot = async (): Promise<void> => {
    if (slotDraft === null) return;

    const name = slotDraft.name.trim();
    if (name === '') {
      setError('Give the period a name.');
      return;
    }

    const timeProblem = slotTimeProblem(slotDraft.startTime, slotDraft.endTime);
    if (timeProblem !== null) {
      setError(timeProblem);
      return;
    }

    setBusy('slot');
    setError(null);

    const body = JSON.stringify({
      periodStructureId: slotDraft.structureId,
      name,
      startTime: slotDraft.startTime,
      endTime: slotDraft.endTime,
      isBreak: slotDraft.isBreak,
      orderIndex: Number(slotDraft.orderIndex),
    });

    try {
      if (slotDraft.id === null) {
        await schoolFetch('/api/school/timetable/slots', { method: 'POST', body });
      } else {
        await schoolFetch(`/api/school/timetable/slots/${slotDraft.id}`, {
          method: 'PUT',
          body,
        });
      }

      setSlotDraft(null);
      await refresh();
    } catch (caught) {
      setError(schoolErrorMessage(caught, 'Could not save the period.'));
    } finally {
      setBusy(null);
    }
  };

  const setSlotActive = async (slot: SlotRow, isActive: boolean): Promise<void> => {
    setBusy(slot.id);
    setError(null);

    try {
      if (isActive) {
        await schoolFetch(`/api/school/timetable/slots/${slot.id}`, {
          method: 'PUT',
          body: JSON.stringify({ isActive: true }),
        });
      } else {
        await schoolFetch(`/api/school/timetable/slots/${slot.id}`, { method: 'DELETE' });
      }
      await refresh();
    } catch (caught) {
      setError(schoolErrorMessage(caught, 'Could not update the period.'));
    } finally {
      setBusy(null);
    }
  };

  // ── Render ──────────────────────────────────────────────────────────

  if (payload === null) {
    return (
      <Card>
        <p className="text-sm text-ink-muted">Loading the period schedules…</p>
      </Card>
    );
  }

  const visible = payload.structures.filter((one) => one.isActive);
  const retired = payload.structures.filter((one) => !one.isActive);

  return (
    <Card
      header={
        <CardTitle
          title="Period schedules"
          description="The rows every timetable is laid out against. Grades that keep different hours — an infant school that finishes at noon, a senior school that runs to four — get a schedule of their own."
          action={
            canEdit && structureDraft === null ? (
              <Button
                size="sm"
                onClick={() => {
                  setStructureDraft({ id: null, name: '', description: '' });
                }}
              >
                Add schedule
              </Button>
            ) : undefined
          }
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

      {structureDraft !== null ? (
        <div className="mb-4 rounded-lg border border-line p-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <Input
              label="Schedule name"
              value={structureDraft.name}
              maxLength={60}
              placeholder="Junior school"
              onChange={(event) => {
                setStructureDraft({ ...structureDraft, name: event.target.value });
              }}
            />
            <Input
              label="Description"
              value={structureDraft.description}
              maxLength={200}
              placeholder="Pre-Nursery to Class 2 — three long periods, home at noon."
              hint="Optional. Shown under the name on this screen."
              onChange={(event) => {
                setStructureDraft({
                  ...structureDraft,
                  description: event.target.value,
                });
              }}
            />
          </div>

          <div className="mt-4 flex gap-3">
            <Button
              isLoading={busy === 'structure'}
              onClick={() => {
                void saveStructure();
              }}
            >
              Save schedule
            </Button>
            <Button
              variant="ghost"
              onClick={() => {
                setStructureDraft(null);
                setError(null);
              }}
            >
              Cancel
            </Button>
          </div>
        </div>
      ) : null}

      {visible.length === 0 ? (
        <p className="text-sm text-ink-muted">
          No period schedules yet. The timetable grid has no rows until the
          school&rsquo;s bell schedule is entered.
        </p>
      ) : (
        <div className="space-y-4">
          {visible.map((structure) => {
            const slots = slotsByStructure.get(structure.id) ?? [];
            const assigned = gradesByStructure.get(structure.id) ?? [];
            const nextIndex = slots.reduce(
              (highest, row) => Math.max(highest, row.orderIndex + 1),
              0,
            );
            const lastEnd = slots[slots.length - 1]?.endTime ?? '08:00';

            return (
              <section
                key={structure.id}
                className="rounded-lg border border-line p-4"
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h4 className="font-medium text-ink">
                      {structure.name}{' '}
                      {structure.isDefault ? (
                        <Badge variant="success">Default</Badge>
                      ) : null}
                    </h4>
                    {structure.description === null ||
                    structure.description === '' ? null : (
                      <p className="mt-0.5 text-xs text-ink-muted">
                        {structure.description}
                      </p>
                    )}

                    <p className="mt-2 text-xs text-ink-muted">
                      {assigned.length > 0 ? (
                        <>Grades: {assigned.map((grade) => grade.label).join(', ')}</>
                      ) : structure.isDefault ? (
                        // Not "no grades". The default is what every grade
                        // nobody has assigned actually runs on, and saying
                        // otherwise would send an admin looking for a bug.
                        <>Every grade not assigned to another schedule</>
                      ) : (
                        <>No grades assigned — nothing runs on this schedule yet</>
                      )}
                    </p>
                  </div>

                  {canEdit ? (
                    <div className="flex flex-wrap gap-2">
                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={() => {
                          setAssigning({
                            id: structure.id,
                            gradeIds: assigned.map((grade) => grade.id),
                          });
                        }}
                      >
                        Assign grades
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => {
                          setStructureDraft({
                            id: structure.id,
                            name: structure.name,
                            description: structure.description ?? '',
                          });
                        }}
                      >
                        Rename
                      </Button>
                      {structure.isDefault ? null : (
                        <>
                          <Button
                            size="sm"
                            variant="ghost"
                            isLoading={busy === structure.id}
                            onClick={() => {
                              void setStructureFlag(structure.id, { isDefault: true });
                            }}
                          >
                            Make default
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            isLoading={busy === structure.id}
                            onClick={() => {
                              void retireStructure(structure.id);
                            }}
                          >
                            Retire
                          </Button>
                        </>
                      )}
                    </div>
                  ) : null}
                </div>

                {assigning !== null && assigning.id === structure.id ? (
                  <div className="mt-4 rounded-lg border border-line-strong bg-surface-sunken p-4">
                    <p className="text-sm font-medium text-ink">
                      Grades on {structure.name}
                    </p>
                    <p className="mt-0.5 mb-3 text-xs text-ink-muted">
                      A grade runs on one schedule. Ticking it here takes it off
                      whichever schedule it was on before.
                    </p>

                    {grades.length === 0 ? (
                      <p className="text-sm text-ink-muted">
                        This school has no grades yet.
                      </p>
                    ) : (
                      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                        {grades.map((grade) => {
                          const owner = claimedElsewhere.get(grade.id);
                          const elsewhere =
                            owner !== undefined && owner !== structure.id;

                          return (
                            <label
                              key={grade.id}
                              className="flex items-start gap-2 text-sm text-ink"
                            >
                              <input
                                type="checkbox"
                                className="mt-0.5 h-4 w-4"
                                checked={assigning.gradeIds.includes(grade.id)}
                                onChange={(event) => {
                                  setAssigning({
                                    ...assigning,
                                    gradeIds: event.target.checked
                                      ? [...assigning.gradeIds, grade.id]
                                      : assigning.gradeIds.filter(
                                          (one) => one !== grade.id,
                                        ),
                                  });
                                }}
                              />
                              <span>
                                {grade.label}
                                {grade.branchName === null ? null : (
                                  <span className="block text-xs text-ink-muted">
                                    {grade.branchName}
                                  </span>
                                )}
                                {elsewhere &&
                                !assigning.gradeIds.includes(grade.id) ? (
                                  <span className="block text-xs text-status-warning-ink">
                                    On another schedule
                                  </span>
                                ) : null}
                              </span>
                            </label>
                          );
                        })}
                      </div>
                    )}

                    <div className="mt-4 flex gap-3">
                      <Button
                        size="sm"
                        isLoading={busy === 'assign'}
                        onClick={() => {
                          void saveAssignment();
                        }}
                      >
                        Save grades
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => {
                          setAssigning(null);
                          setError(null);
                        }}
                      >
                        Cancel
                      </Button>
                    </div>
                  </div>
                ) : null}

                {slotDraft !== null && slotDraft.structureId === structure.id ? (
                  <div className="mt-4 rounded-lg border border-line-strong bg-surface-sunken p-4">
                    <div className="grid gap-4 sm:grid-cols-2">
                      <Input
                        label="Name"
                        value={slotDraft.name}
                        maxLength={60}
                        placeholder="Period 1"
                        onChange={(event) => {
                          setSlotDraft({ ...slotDraft, name: event.target.value });
                        }}
                      />
                      <Input
                        label="Position in the day"
                        type="number"
                        min={0}
                        max={99}
                        value={slotDraft.orderIndex}
                        hint="Lower numbers come first."
                        onChange={(event) => {
                          setSlotDraft({
                            ...slotDraft,
                            orderIndex: event.target.value,
                          });
                        }}
                      />
                      <Input
                        label="Starts"
                        type="time"
                        value={slotDraft.startTime}
                        onChange={(event) => {
                          setSlotDraft({ ...slotDraft, startTime: event.target.value });
                        }}
                      />
                      <Input
                        label="Ends"
                        type="time"
                        value={slotDraft.endTime}
                        onChange={(event) => {
                          setSlotDraft({ ...slotDraft, endTime: event.target.value });
                        }}
                      />

                      <label className="flex items-start gap-2 text-sm text-ink sm:col-span-2">
                        <input
                          type="checkbox"
                          className="mt-0.5 h-4 w-4"
                          checked={slotDraft.isBreak}
                          onChange={(event) => {
                            setSlotDraft({
                              ...slotDraft,
                              isBreak: event.target.checked,
                            });
                          }}
                        />
                        <span>
                          This is a break
                          <span className="block text-xs text-ink-muted">
                            Assembly, the interval, prayer. It spans the whole
                            week in the grid and no lesson can be placed in it.
                          </span>
                        </span>
                      </label>
                    </div>

                    <div className="mt-4 flex gap-3">
                      <Button
                        size="sm"
                        isLoading={busy === 'slot'}
                        onClick={() => {
                          void saveSlot();
                        }}
                      >
                        Save period
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => {
                          setSlotDraft(null);
                          setError(null);
                        }}
                      >
                        Cancel
                      </Button>
                    </div>
                  </div>
                ) : null}

                {slots.length === 0 ? (
                  <p className="mt-4 text-sm text-ink-muted">
                    No periods on this schedule yet.
                  </p>
                ) : (
                  <ul className="mt-2 divide-y divide-line">
                    {slots.map((row) => (
                      <li
                        key={row.id}
                        className="flex flex-wrap items-center justify-between gap-3 py-2.5"
                      >
                        <div className="min-w-0">
                          <p className="text-sm font-medium text-ink">
                            {row.name}{' '}
                            {row.isBreak ? (
                              <Badge variant="neutral">Break</Badge>
                            ) : null}
                            {row.isActive ? null : (
                              <Badge variant="neutral">Retired</Badge>
                            )}
                          </p>
                          <p className="text-xs text-ink-muted">
                            {formatTimeOfDay(row.startTime)} –{' '}
                            {formatTimeOfDay(row.endTime)} · position{' '}
                            {row.orderIndex}
                          </p>
                        </div>

                        {canEdit ? (
                          <div className="flex gap-2">
                            <Button
                              size="sm"
                              variant="secondary"
                              onClick={() => {
                                setSlotDraft({
                                  id: row.id,
                                  structureId: structure.id,
                                  name: row.name,
                                  startTime: row.startTime,
                                  endTime: row.endTime,
                                  isBreak: row.isBreak,
                                  orderIndex: String(row.orderIndex),
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
                                void setSlotActive(row, !row.isActive);
                              }}
                            >
                              {row.isActive ? 'Retire' : 'Restore'}
                            </Button>
                          </div>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                )}

                {canEdit && slotDraft === null ? (
                  <Button
                    className="mt-3"
                    size="sm"
                    variant="secondary"
                    onClick={() => {
                      setSlotDraft({
                        id: null,
                        structureId: structure.id,
                        name: `Period ${nextIndex + 1}`,
                        startTime: lastEnd,
                        endTime: '',
                        isBreak: false,
                        orderIndex: String(nextIndex),
                      });
                    }}
                  >
                    Add period
                  </Button>
                ) : null}
              </section>
            );
          })}
        </div>
      )}

      {retired.length === 0 ? null : (
        <div className="mt-4 border-t border-line pt-4">
          <p className="text-xs font-medium uppercase tracking-wide text-ink-muted">
            Retired schedules
          </p>
          <ul className="mt-2 space-y-2">
            {retired.map((structure) => (
              <li
                key={structure.id}
                className="flex flex-wrap items-center justify-between gap-3 text-sm"
              >
                <span className="text-ink-muted">{structure.name}</span>
                {canEdit ? (
                  <Button
                    size="sm"
                    variant="ghost"
                    isLoading={busy === structure.id}
                    onClick={() => {
                      void setStructureFlag(structure.id, { isActive: true });
                    }}
                  >
                    Restore
                  </Button>
                ) : null}
              </li>
            ))}
          </ul>
        </div>
      )}
    </Card>
  );
}
