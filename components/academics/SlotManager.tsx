'use client';

import { useCallback, useEffect, useState } from 'react';

import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card, CardTitle } from '@/components/ui/Card';
import { Input } from '@/components/ui/Input';
import { formatTimeOfDay, slotTimeProblem } from '@/db/schema/timetable-slots';
import { schoolErrorMessage, schoolFetch } from '@/lib/school-client';

/**
 * The school's bell schedule — the rows every timetable is laid out against.
 *
 * It lives beside the builder rather than on a screen of its own because it is
 * only ever edited in service of the grid: an admin comes here when a period is
 * missing from the week they are trying to fill.
 *
 * Breaks are ordinary rows with `isBreak` set. They occupy a position in the
 * day so the schedule reads correctly, and the API refuses to put a lesson in
 * one.
 */

interface SlotRow {
  id: string;
  name: string;
  startTime: string;
  endTime: string;
  isBreak: boolean;
  orderIndex: number;
  isActive: boolean;
}

interface DraftSlot {
  id: string | null;
  name: string;
  startTime: string;
  endTime: string;
  isBreak: boolean;
  orderIndex: string;
}

export interface SlotManagerProps {
  canEdit: boolean;
}

function emptyDraft(nextIndex: number, startTime: string): DraftSlot {
  return {
    id: null,
    name: `Period ${nextIndex + 1}`,
    startTime,
    endTime: '',
    isBreak: false,
    orderIndex: String(nextIndex),
  };
}

export function SlotManager({ canEdit }: SlotManagerProps) {
  const [slots, setSlots] = useState<SlotRow[] | null>(null);
  const [draft, setDraft] = useState<DraftSlot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const payload = await schoolFetch<{ slots: SlotRow[] }>(
        '/api/school/timetable/slots',
      );
      setSlots(payload.slots);
      setError(null);
    } catch (caught) {
      setError(schoolErrorMessage(caught, 'Could not load the bell schedule.'));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const save = async (): Promise<void> => {
    if (draft === null) return;

    const name = draft.name.trim();
    if (name === '') {
      setError('Give the period a name.');
      return;
    }

    const timeProblem = slotTimeProblem(draft.startTime, draft.endTime);
    if (timeProblem !== null) {
      setError(timeProblem);
      return;
    }

    setBusy('save');
    setError(null);

    const body = JSON.stringify({
      name,
      startTime: draft.startTime,
      endTime: draft.endTime,
      isBreak: draft.isBreak,
      orderIndex: Number(draft.orderIndex),
    });

    try {
      if (draft.id === null) {
        await schoolFetch('/api/school/timetable/slots', { method: 'POST', body });
      } else {
        await schoolFetch(`/api/school/timetable/slots/${draft.id}`, {
          method: 'PUT',
          body,
        });
      }

      setDraft(null);
      await load();
    } catch (caught) {
      setError(schoolErrorMessage(caught, 'Could not save the period.'));
    } finally {
      setBusy(null);
    }
  };

  const setActive = async (row: SlotRow, isActive: boolean): Promise<void> => {
    setBusy(row.id);
    setError(null);

    try {
      if (isActive) {
        await schoolFetch(`/api/school/timetable/slots/${row.id}`, {
          method: 'PUT',
          body: JSON.stringify({ isActive: true }),
        });
      } else {
        await schoolFetch(`/api/school/timetable/slots/${row.id}`, { method: 'DELETE' });
      }
      await load();
    } catch (caught) {
      setError(schoolErrorMessage(caught, 'Could not update the period.'));
    } finally {
      setBusy(null);
    }
  };

  if (slots === null) {
    return (
      <Card>
        <p className="text-sm text-ink-muted">Loading the bell schedule…</p>
      </Card>
    );
  }

  const nextIndex = slots.reduce((highest, row) => Math.max(highest, row.orderIndex + 1), 0);
  const lastEnd = slots[slots.length - 1]?.endTime ?? '08:00';

  return (
    <Card
      header={
        <CardTitle
          title="Bell schedule"
          description="The periods and breaks every timetable is laid out against."
          action={
            canEdit && draft === null ? (
              <Button
                size="sm"
                onClick={() => {
                  setDraft(emptyDraft(nextIndex, lastEnd));
                }}
              >
                Add period
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

      {draft !== null ? (
        <div className="mb-4 rounded-lg border border-line p-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <Input
              label="Name"
              value={draft.name}
              maxLength={60}
              placeholder="Period 1"
              onChange={(event) => {
                setDraft({ ...draft, name: event.target.value });
              }}
            />
            <Input
              label="Position in the day"
              type="number"
              min={0}
              max={99}
              value={draft.orderIndex}
              hint="Lower numbers come first."
              onChange={(event) => {
                setDraft({ ...draft, orderIndex: event.target.value });
              }}
            />
            <Input
              label="Starts"
              type="time"
              value={draft.startTime}
              onChange={(event) => {
                setDraft({ ...draft, startTime: event.target.value });
              }}
            />
            <Input
              label="Ends"
              type="time"
              value={draft.endTime}
              onChange={(event) => {
                setDraft({ ...draft, endTime: event.target.value });
              }}
            />

            <label className="flex items-start gap-2 text-sm text-ink sm:col-span-2">
              <input
                type="checkbox"
                className="mt-0.5 h-4 w-4"
                checked={draft.isBreak}
                onChange={(event) => {
                  setDraft({ ...draft, isBreak: event.target.checked });
                }}
              />
              <span>
                This is a break
                <span className="block text-xs text-ink-muted">
                  Assembly, the interval, prayer. It spans the whole week in the
                  grid and no lesson can be placed in it.
                </span>
              </span>
            </label>
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
        </div>
      ) : null}

      {slots.length === 0 ? (
        <p className="text-sm text-ink-muted">
          No periods yet. The timetable grid has no rows until the school&rsquo;s
          bell schedule is entered.
        </p>
      ) : (
        <ul className="divide-y divide-line">
          {slots.map((row) => (
            <li
              key={row.id}
              className="flex flex-wrap items-center justify-between gap-3 py-3"
            >
              <div className="min-w-0">
                <p className="font-medium text-ink">
                  {row.name}{' '}
                  {row.isBreak ? <Badge variant="neutral">Break</Badge> : null}
                  {row.isActive ? null : <Badge variant="neutral">Retired</Badge>}
                </p>
                <p className="text-xs text-ink-muted">
                  {formatTimeOfDay(row.startTime)} – {formatTimeOfDay(row.endTime)} ·
                  position {row.orderIndex}
                </p>
              </div>

              {canEdit ? (
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => {
                      setDraft({
                        id: row.id,
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
                      void setActive(row, !row.isActive);
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
    </Card>
  );
}
