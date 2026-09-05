'use client';

import { useCallback, useEffect, useState } from 'react';

import {
  HolidayCalendar,
  type CalendarHoliday,
} from '@/components/calendar/HolidayCalendar';
import { Button } from '@/components/ui/Button';
import { Card, CardTitle } from '@/components/ui/Card';
import { Input } from '@/components/ui/Input';
import { Modal } from '@/components/ui/Modal';
import { Select } from '@/components/ui/Select';
import { HOLIDAY_TYPES, HOLIDAY_TYPE_LABELS } from '@/db/schema/holidays';
import { formatDateOnly } from '@/lib/dates';
import { schoolErrorMessage, schoolFetch } from '@/lib/school-client';

/**
 * The admin calendar: the grid, plus adding, moving and removing a holiday.
 *
 * ── Why it refetches rather than mutating in place ───────────────────────
 * A holiday write can be refused by the two partial unique indexes, and it can
 * change a row the browser did not ask about — the seed writes twelve. Patching
 * local state after each call is how a screen comes to disagree with the
 * database, and this one is read by four portals. One refetch per write is a
 * round trip nobody notices on a screen somebody opens once a term.
 *
 * ── Every client fetch carries a visible pending state ───────────────────
 * CLAUDE.md's standing rule: `loading.tsx` covers the server render, and
 * anything fetched after mount carries its own. Each button here does.
 */

export interface CalendarManagerProps {
  canManage: boolean;
  /** The month drawn first, as `YYYY-MM`, resolved on the server. */
  initialMonth: string;
  saturdayOrdinals: readonly number[];
}

interface SeedRow {
  name: string;
  startsOn: string;
  endsOn: string;
  holidayType: string;
  isTentative: boolean;
}

/** Twelve months either side is what a school planning a year actually looks at. */
const WINDOW_MONTHS = 12;

function windowFor(month: string): { from: string; to: string } {
  const [yearRaw, monthRaw] = month.split('-');
  const year = Number(yearRaw);
  const index = Number(monthRaw) - 1;

  const from = new Date(Date.UTC(year, index - WINDOW_MONTHS, 1));
  const to = new Date(Date.UTC(year, index + WINDOW_MONTHS + 1, 0));

  return { from: from.toISOString().slice(0, 10), to: to.toISOString().slice(0, 10) };
}

export function CalendarManager({
  canManage,
  initialMonth,
  saturdayOrdinals,
}: CalendarManagerProps) {
  const [holidays, setHolidays] = useState<CalendarHoliday[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const { from, to } = windowFor(initialMonth);

    try {
      const payload = await schoolFetch<{ holidays: CalendarHoliday[] }>(
        `/api/school/holidays?from=${from}&to=${to}`,
      );
      setHolidays(payload.holidays);
      setError(null);
    } catch (caught) {
      setHolidays([]);
      setError(schoolErrorMessage(caught, 'Could not read the calendar.'));
    }
  }, [initialMonth]);

  useEffect(() => {
    void load();
  }, [load]);

  /* ------------------------------------------------------------ add / edit */
  const [editing, setEditing] = useState<CalendarHoliday | null>(null);
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');
  const [startsOn, setStartsOn] = useState('');
  const [endsOn, setEndsOn] = useState('');
  const [holidayType, setHolidayType] = useState<string>('school');

  const openAdd = (): void => {
    setEditing(null);
    setAdding(true);
    setName('');
    setStartsOn('');
    setEndsOn('');
    setHolidayType('school');
    setNotice(null);
  };

  const openEdit = (holiday: CalendarHoliday): void => {
    setAdding(false);
    setEditing(holiday);
    setName(holiday.name);
    setStartsOn(holiday.startsOn);
    setEndsOn(holiday.endsOn);
    setHolidayType(holiday.holidayType);
    setNotice(null);
  };

  const save = async (): Promise<void> => {
    setBusy(true);
    setError(null);

    // A one-day holiday sends the same date twice. The column is NOT NULL and
    // the range check is what makes expanding it safe to loop over.
    const body = JSON.stringify({
      name,
      startsOn,
      endsOn: endsOn === '' ? startsOn : endsOn,
      holidayType,
    });

    try {
      if (editing === null) {
        await schoolFetch('/api/school/holidays', { method: 'POST', body });
        setNotice(`${name} added.`);
      } else {
        await schoolFetch(`/api/school/holidays/${editing.id}`, {
          method: 'PATCH',
          body,
        });
        setNotice(
          editing.isTentative && (startsOn !== editing.startsOn || endsOn !== editing.endsOn)
            ? `${name} moved, and is no longer marked tentative.`
            : `${name} saved.`,
        );
      }

      setAdding(false);
      setEditing(null);
      await load();
    } catch (caught) {
      setError(schoolErrorMessage(caught, 'Could not save that holiday.'));
    } finally {
      setBusy(false);
    }
  };

  const remove = async (holiday: CalendarHoliday): Promise<void> => {
    setBusy(true);
    setError(null);

    try {
      await schoolFetch(`/api/school/holidays/${holiday.id}`, { method: 'DELETE' });
      setNotice(`${holiday.name} removed.`);
      await load();
    } catch (caught) {
      setError(schoolErrorMessage(caught, 'Could not remove that holiday.'));
    } finally {
      setBusy(false);
    }
  };

  /* ----------------------------------------------------------------- seed */
  const [seedYear, setSeedYear] = useState(String(new Date().getFullYear()));
  const [seedRows, setSeedRows] = useState<SeedRow[] | null>(null);
  const [seeding, setSeeding] = useState(false);

  const previewSeed = async (): Promise<void> => {
    setSeeding(true);
    setError(null);

    try {
      const payload = await schoolFetch<{ rows: SeedRow[] }>(
        `/api/school/holidays/seed?year=${seedYear}`,
      );
      setSeedRows(payload.rows);
    } catch (caught) {
      setError(schoolErrorMessage(caught, 'Could not read that year’s holidays.'));
    } finally {
      setSeeding(false);
    }
  };

  const applySeed = async (): Promise<void> => {
    setSeeding(true);
    setError(null);

    try {
      const payload = await schoolFetch<{ created: number; alreadyPresent: number }>(
        '/api/school/holidays/seed',
        { method: 'POST', body: JSON.stringify({ year: Number(seedYear) }) },
      );

      setNotice(
        `${String(payload.created)} added, ${String(payload.alreadyPresent)} already on the calendar.`,
      );
      setSeedRows(null);
      await load();
    } catch (caught) {
      setError(schoolErrorMessage(caught, 'Could not load those holidays.'));
    } finally {
      setSeeding(false);
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

      {canManage ? (
        <div className="flex flex-wrap items-end gap-3">
          <Button onClick={openAdd}>Add a holiday</Button>

          <div className="w-32">
            <Input
              label="Year"
              type="number"
              min={2000}
              max={2100}
              value={seedYear}
              onChange={(event) => {
                setSeedYear(event.target.value);
              }}
            />
          </div>

          <Button
            variant="secondary"
            isLoading={seeding}
            onClick={() => {
              void previewSeed();
            }}
          >
            Load public holidays
          </Button>
        </div>
      ) : null}

      <HolidayCalendar
        holidays={holidays ?? []}
        initialMonth={initialMonth}
        saturdayOrdinals={saturdayOrdinals}
      >
        {canManage && holidays !== null && holidays.length > 0 ? (
          <Card
            className="p-0"
            header={
              <CardTitle
                title="Every holiday on the calendar"
                description="Twelve months either side of today. Editing a date confirms it."
              />
            }
          >
            <ul className="divide-y divide-line px-5 pb-4">
              {holidays.map((holiday) => (
                <li
                  key={holiday.id}
                  className="flex flex-wrap items-center justify-between gap-2 py-3"
                >
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-ink">{holiday.name}</p>
                    <p className="text-xs text-ink-muted">
                      {holiday.startsOn === holiday.endsOn
                        ? formatDateOnly(holiday.startsOn)
                        : `${formatDateOnly(holiday.startsOn)} – ${formatDateOnly(holiday.endsOn)}`}
                      {holiday.isTentative ? ' · Tentative — confirm the date' : ''}
                    </p>
                  </div>

                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      variant="secondary"
                      disabled={busy}
                      onClick={() => {
                        openEdit(holiday);
                      }}
                    >
                      Edit
                    </Button>
                    <Button
                      size="sm"
                      variant="danger"
                      disabled={busy}
                      onClick={() => {
                        void remove(holiday);
                      }}
                    >
                      Remove
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          </Card>
        ) : null}
      </HolidayCalendar>

      <Modal
        open={adding || editing !== null}
        title={editing === null ? 'Add a holiday' : `Edit ${editing.name}`}
        description="A holiday is one row however many days it runs. Moving a date marks it confirmed."
        onClose={() => {
          setAdding(false);
          setEditing(null);
        }}
      >
        <div className="space-y-4">
          <Input
            label="Name"
            value={name}
            onChange={(event) => {
              setName(event.target.value);
            }}
          />

          <div className="grid gap-4 sm:grid-cols-2">
            <Input
              label="First day"
              type="date"
              value={startsOn}
              onChange={(event) => {
                setStartsOn(event.target.value);
              }}
            />
            <Input
              label="Last day"
              type="date"
              value={endsOn}
              hint="Leave blank for a one-day holiday."
              onChange={(event) => {
                setEndsOn(event.target.value);
              }}
            />
          </div>

          <Select
            label="Kind"
            options={HOLIDAY_TYPES.map((type) => ({
              value: type,
              label: HOLIDAY_TYPE_LABELS[type],
            }))}
            value={holidayType}
            onChange={(event) => {
              setHolidayType(event.target.value);
            }}
          />

          <div className="flex justify-end gap-2">
            <Button
              variant="secondary"
              disabled={busy}
              onClick={() => {
                setAdding(false);
                setEditing(null);
              }}
            >
              Cancel
            </Button>
            <Button
              isLoading={busy}
              disabled={name.trim() === '' || startsOn === ''}
              onClick={() => {
                void save();
              }}
            >
              Save
            </Button>
          </div>
        </div>
      </Modal>

      <Modal
        open={seedRows !== null}
        title={`Pakistan's public holidays for ${seedYear}`}
        description="Anything already on your calendar is skipped. Nothing you have edited is overwritten."
        onClose={() => {
          setSeedRows(null);
        }}
      >
        <div className="space-y-4">
          <p className="rounded-lg bg-status-warning-subtle px-3 py-2 text-sm text-status-warning-onSubtle">
            Every Islamic date below is <strong>tentative</strong>. They are worked
            out arithmetically; the real dates are decided by moon sighting and
            usually land within a day either side. Move them once your school knows,
            and the tentative mark comes off.
          </p>

          <ul className="max-h-72 divide-y divide-line overflow-y-auto text-sm">
            {(seedRows ?? []).map((row) => (
              <li
                key={`${row.name}-${row.startsOn}`}
                className="flex items-center justify-between gap-2 py-2"
              >
                <span className="text-ink">{row.name}</span>
                <span className="text-xs text-ink-muted">
                  {row.startsOn === row.endsOn
                    ? formatDateOnly(row.startsOn)
                    : `${formatDateOnly(row.startsOn)} – ${formatDateOnly(row.endsOn)}`}
                  {row.isTentative ? ' · tentative' : ''}
                </span>
              </li>
            ))}
          </ul>

          <div className="flex justify-end gap-2">
            <Button
              variant="secondary"
              disabled={seeding}
              onClick={() => {
                setSeedRows(null);
              }}
            >
              Cancel
            </Button>
            <Button
              isLoading={seeding}
              onClick={() => {
                void applySeed();
              }}
            >
              Add them
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
