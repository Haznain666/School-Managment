'use client';

import { useCallback, useEffect, useState } from 'react';

import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card, CardTitle } from '@/components/ui/Card';
import { Input } from '@/components/ui/Input';
import { MultiSelect } from '@/components/ui/MultiSelect';
import { Select } from '@/components/ui/Select';
import { SkeletonForm } from '@/components/ui/Skeleton';
import { Toggle } from '@/components/ui/Toggle';
import {
  HOLIDAY_SPAN_LABELS,
  HOLIDAY_SPANS,
  type HolidaySpan,
} from '@/db/schema/branch-leave-settings';
import {
  STAFF_CALENDAR_CATEGORY_LABELS,
  type StaffCalendarCategory,
} from '@/db/schema/staff-calendars';
import { schoolErrorMessage, schoolFetch } from '@/lib/school-client';
import { ROLE_LABELS, USER_ROLES, type UserRole } from '@/types/school-auth';

/**
 * The two staff calendars, and the one rule that decides what a leave day costs.
 *
 * ── A calendar is a filter over the school's holidays ────────────────────
 * Gazetted holidays arrive on both calendars automatically — that is
 * `lib/pakistan-holidays.ts` and the seed the Calendar screen already runs, and
 * nothing here duplicates them. What this screen writes is the exceptions: a
 * holiday that does **not** apply to these people, one that applies on
 * different dates, or a closure only one calendar gets. *June and July off for
 * teaching staff* is the last of those, and it is one row.
 *
 * ── Notify is the announcement path that already exists ──────────────────
 * The button posts to `POST /api/school/holidays/[holidayId]/notify`, which
 * builds an announcement with `audience: { kind: 'roles', roles }` and sends it
 * through `sendAnnouncement` — resolving the audience, the campus scope, the
 * notice and bell rows, and every email preference on the way. Nothing here
 * sends anything itself. A second delivery path would be a second place all of
 * that is decided, and the first time the two disagreed somebody who had opted
 * out would get mail.
 */

const STAFF_ROLE_OPTIONS = USER_ROLES.filter(
  (role) => role !== 'student' && role !== 'parent',
).map((role) => ({ value: role, label: ROLE_LABELS[role] }));

interface CalendarRow {
  id: string;
  branchId: string | null;
  branchName: string | null;
  category: StaffCalendarCategory;
  name: string;
  overrideCount: number;
}

interface OverrideRow {
  id: string;
  holidayId: string;
  holidayName: string;
  startsOn: string;
  endsOn: string;
  appliesToRoles: string[];
  isCancelled: boolean;
  movedStartsOn: string | null;
  movedEndsOn: string | null;
  notify: boolean;
  notifiedAt: string | null;
}

interface SettingRow {
  branchId: string | null;
  branchName: string | null;
  holidaySpan: HolidaySpan;
  isOwn: boolean;
}

interface Draft {
  mode: 'cancel' | 'move' | 'add';
  holidayId: string;
  name: string;
  startsOn: string;
  endsOn: string;
  movedStartsOn: string;
  movedEndsOn: string;
  roles: string[];
  notify: boolean;
}

const EMPTY_DRAFT: Draft = {
  mode: 'add',
  holidayId: '',
  name: '',
  startsOn: '',
  endsOn: '',
  movedStartsOn: '',
  movedEndsOn: '',
  roles: [],
  notify: false,
};

/** A year either side is what somebody planning a school year looks at. */
function holidayWindow(): { from: string; to: string } {
  const now = new Date();
  const from = new Date(Date.UTC(now.getUTCFullYear() - 1, now.getUTCMonth(), 1));
  const to = new Date(Date.UTC(now.getUTCFullYear() + 1, now.getUTCMonth(), 1));
  return { from: from.toISOString().slice(0, 10), to: to.toISOString().slice(0, 10) };
}

export interface StaffCalendarManagerProps {
  canEdit: boolean;
}

export function StaffCalendarManager({ canEdit }: StaffCalendarManagerProps) {
  const [calendars, setCalendars] = useState<CalendarRow[] | null>(null);
  const [settings, setSettings] = useState<SettingRow[]>([]);
  const [holidays, setHolidays] = useState<Array<{ id: string; name: string; startsOn: string }>>([]);
  const [calendarId, setCalendarId] = useState('');
  const [overrides, setOverrides] = useState<OverrideRow[]>([]);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [pending, setPending] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    setPending(true);
    try {
      const window = holidayWindow();
      const [calendarPayload, settingPayload, holidayPayload] = await Promise.all([
        schoolFetch<{ calendars: CalendarRow[] }>('/api/school/staff-calendars'),
        schoolFetch<{ settings: SettingRow[] }>('/api/school/leave/settings'),
        schoolFetch<{ holidays: Array<{ id: string; name: string; startsOn: string }> }>(
          `/api/school/holidays?from=${window.from}&to=${window.to}`,
        ),
      ]);

      setCalendars(calendarPayload.calendars);
      setSettings(settingPayload.settings);
      setHolidays(holidayPayload.holidays);
      setCalendarId((held) =>
        held === '' ? (calendarPayload.calendars[0]?.id ?? '') : held,
      );
      setError(null);
    } catch (caught) {
      setError(schoolErrorMessage(caught, 'Could not load the staff calendars.'));
    } finally {
      setPending(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const loadOverrides = useCallback(async (id: string) => {
    if (id === '') {
      setOverrides([]);
      return;
    }
    try {
      const payload = await schoolFetch<{ overrides: OverrideRow[] }>(
        `/api/school/staff-calendars/${id}/overrides`,
      );
      setOverrides(payload.overrides);
    } catch (caught) {
      setError(schoolErrorMessage(caught, 'Could not load this calendar.'));
    }
  }, []);

  useEffect(() => {
    void loadOverrides(calendarId);
  }, [calendarId, loadOverrides]);

  const calendar = (calendars ?? []).find((row) => row.id === calendarId) ?? null;

  const createCalendars = async (): Promise<void> => {
    setBusy('create');
    setError(null);
    try {
      const payload = await schoolFetch<{ calendars: CalendarRow[] }>(
        '/api/school/staff-calendars',
        { method: 'POST', body: JSON.stringify({}) },
      );
      setCalendars(payload.calendars);
      setCalendarId(payload.calendars[0]?.id ?? '');
      setNotice('Both calendars are ready. Gazetted holidays already appear on each.');
    } catch (caught) {
      setError(schoolErrorMessage(caught, 'Could not create the calendars.'));
    } finally {
      setBusy(null);
    }
  };

  const saveSetting = async (row: SettingRow, span: HolidaySpan): Promise<void> => {
    setBusy(`span-${row.branchId ?? 'school'}`);
    setError(null);
    try {
      const payload = await schoolFetch<{ settings: SettingRow[] }>('/api/school/leave/settings', {
        method: 'PUT',
        body: JSON.stringify({ branchId: row.branchId, holidaySpan: span }),
      });
      setSettings(payload.settings);
      setNotice(
        span === 'skip'
          ? 'A holiday inside a leave range will not be deducted there.'
          : 'A holiday inside a leave range counts as leave there.',
      );
    } catch (caught) {
      setError(schoolErrorMessage(caught, 'Could not save that setting.'));
    } finally {
      setBusy(null);
    }
  };

  const addOverride = async (): Promise<void> => {
    if (draft === null || calendar === null) return;

    setBusy('override');
    setError(null);
    setNotice(null);

    try {
      const body =
        draft.mode === 'add'
          ? {
              name: draft.name.trim(),
              startsOn: draft.startsOn,
              endsOn: draft.endsOn,
              appliesToRoles: draft.roles,
              notify: draft.notify,
            }
          : draft.mode === 'cancel'
            ? {
                holidayId: draft.holidayId,
                isCancelled: true,
                appliesToRoles: draft.roles,
                notify: draft.notify,
              }
            : {
                holidayId: draft.holidayId,
                movedStartsOn: draft.movedStartsOn,
                movedEndsOn: draft.movedEndsOn,
                appliesToRoles: draft.roles,
                notify: draft.notify,
              };

      const payload = await schoolFetch<{ overrides: OverrideRow[] }>(
        `/api/school/staff-calendars/${calendar.id}/overrides`,
        { method: 'POST', body: JSON.stringify(body) },
      );

      setOverrides(payload.overrides);
      setDraft(null);
      setNotice(
        draft.notify
          ? 'Saved. Press Notify on the row to tell the people it applies to.'
          : 'Saved.',
      );
      await load();
    } catch (caught) {
      setError(schoolErrorMessage(caught, 'Could not save that change.'));
    } finally {
      setBusy(null);
    }
  };

  const notifyOverride = async (row: OverrideRow): Promise<void> => {
    if (calendar === null) return;

    setBusy(row.id);
    setError(null);
    setNotice(null);

    try {
      /*
       * The announcement first, the bookkeeping second, and deliberately not
       * one call: a failed send must not leave a row claiming the school was
       * told, and a successful send must not be undone by a write that failed
       * after it.
       */
      await schoolFetch(`/api/school/holidays/${row.holidayId}/notify`, {
        method: 'POST',
        body: JSON.stringify({
          roles: row.appliesToRoles.length > 0 ? row.appliesToRoles : rolesOnCalendar(calendar),
          sendEmail: true,
        }),
      });

      const payload = await schoolFetch<{ overrides: OverrideRow[] }>(
        `/api/school/staff-calendars/${calendar.id}/overrides/${row.id}`,
        { method: 'PATCH', body: JSON.stringify({ markNotified: true }) },
      );

      setOverrides(payload.overrides);
      setNotice(`Told about ${row.holidayName}.`);
    } catch (caught) {
      setError(schoolErrorMessage(caught, 'Could not send the notice.'));
    } finally {
      setBusy(null);
    }
  };

  const removeOverride = async (row: OverrideRow): Promise<void> => {
    if (calendar === null) return;

    setBusy(row.id);
    setError(null);
    try {
      const payload = await schoolFetch<{ overrides: OverrideRow[] }>(
        `/api/school/staff-calendars/${calendar.id}/overrides/${row.id}`,
        { method: 'DELETE' },
      );
      setOverrides(payload.overrides);
      setNotice(`${row.holidayName} applies to this calendar again.`);
      await load();
    } catch (caught) {
      setError(schoolErrorMessage(caught, 'Could not remove that change.'));
    } finally {
      setBusy(null);
    }
  };

  if (pending && calendars === null) return <SkeletonForm fields={4} />;

  return (
    <div className="space-y-6">
      {error !== null ? (
        <p
          role="alert"
          className="rounded-lg bg-status-danger-subtle px-3 py-2 text-sm text-status-danger-ink"
        >
          {error}
        </p>
      ) : null}

      {notice !== null ? (
        <p className="rounded-lg bg-status-success-subtle px-3 py-2 text-sm text-status-success-ink">
          {notice}
        </p>
      ) : null}

      <Card
        header={
          <CardTitle
            title="A holiday inside a leave range"
            description="Whether it comes out of the person's entitlement. Per campus, and it applies to everybody there."
          />
        }
      >
        <ul className="space-y-3">
          {settings.map((row) => (
            <li
              key={row.branchId ?? 'school'}
              className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-line px-3 py-2"
            >
              <div>
                <p className="text-sm font-medium text-ink">
                  {row.branchName ?? 'Every campus (the school’s default)'}
                </p>
                <p className="text-xs text-ink-muted">
                  {HOLIDAY_SPAN_LABELS[row.holidaySpan]}
                  {row.isOwn ? '' : ' — inherited from the school'}
                </p>
              </div>
              <div className="w-full sm:w-64">
                <Select
                  label={`Rule for ${row.branchName ?? 'every campus'}`}
                  disabled={!canEdit || busy !== null}
                  value={row.holidaySpan}
                  options={HOLIDAY_SPANS.map((span) => ({
                    value: span,
                    label: HOLIDAY_SPAN_LABELS[span],
                  }))}
                  onChange={(event) => {
                    void saveSetting(row, event.target.value as HolidaySpan);
                  }}
                />
              </div>
            </li>
          ))}
        </ul>
      </Card>

      <Card
        header={
          <CardTitle
            title="Staff calendars"
            description="Teaching and non-teaching staff do not share a year. Gazetted holidays are on both automatically; what you set here are the exceptions."
            action={
              canEdit && (calendars?.length ?? 0) === 0 ? (
                <Button
                  size="sm"
                  isLoading={busy === 'create'}
                  onClick={() => {
                    void createCalendars();
                  }}
                >
                  Create both calendars
                </Button>
              ) : undefined
            }
          />
        }
      >
        {(calendars?.length ?? 0) === 0 ? (
          <p className="text-sm text-ink-muted">
            None yet, and nothing is broken without them: leave is counted against the
            school&rsquo;s own holidays until a calendar says otherwise.
          </p>
        ) : (
          <div className="space-y-4">
            <Select
              label="Calendar"
              value={calendarId}
              options={(calendars ?? []).map((row) => ({
                value: row.id,
                label: `${STAFF_CALENDAR_CATEGORY_LABELS[row.category]}${row.branchName === null ? ' — every campus' : ` — ${row.branchName}`}`,
              }))}
              onChange={(event) => {
                setCalendarId(event.target.value);
                setDraft(null);
              }}
            />

            {overrides.length === 0 ? (
              <p className="text-sm text-ink-muted">
                This calendar follows the school&rsquo;s holidays exactly.
              </p>
            ) : (
              <ul className="divide-y divide-line rounded-lg border border-line">
                {overrides.map((row) => (
                  <li key={row.id} className="flex flex-wrap items-start justify-between gap-3 px-3 py-3">
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-ink">
                        {row.holidayName}
                        {row.isCancelled ? (
                          <Badge className="ml-2" variant="danger">
                            Does not apply
                          </Badge>
                        ) : row.movedStartsOn === null ? null : (
                          <Badge className="ml-2" variant="warning">
                            Moved
                          </Badge>
                        )}
                      </p>
                      <p className="text-xs text-ink-muted">
                        {row.startsOn} → {row.endsOn}
                        {row.movedStartsOn === null
                          ? ''
                          : ` · now ${row.movedStartsOn} → ${row.movedEndsOn ?? row.movedStartsOn}`}
                        {' · '}
                        {row.appliesToRoles.length === 0
                          ? 'everybody on this calendar'
                          : row.appliesToRoles
                              .map((role) => ROLE_LABELS[role as UserRole] ?? role)
                              .join(', ')}
                      </p>
                    </div>

                    {canEdit ? (
                      <div className="flex gap-2">
                        <Button
                          size="sm"
                          variant="secondary"
                          isLoading={busy === row.id}
                          onClick={() => {
                            void notifyOverride(row);
                          }}
                        >
                          {row.notifiedAt === null ? 'Notify' : 'Notify again'}
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => {
                            void removeOverride(row);
                          }}
                        >
                          Remove
                        </Button>
                      </div>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}

            {canEdit && draft === null ? (
              <Button
                variant="secondary"
                onClick={() => {
                  setDraft(EMPTY_DRAFT);
                }}
              >
                Change a holiday for this calendar
              </Button>
            ) : null}

            {draft === null ? null : (
              <div className="space-y-4 rounded-lg border border-line p-4">
                <Select
                  label="What is changing"
                  value={draft.mode}
                  options={[
                    { value: 'add', label: 'A closure only these people get' },
                    { value: 'cancel', label: 'A holiday that does not apply to them' },
                    { value: 'move', label: 'A holiday they take on different dates' },
                  ]}
                  onChange={(event) => {
                    setDraft({ ...draft, mode: event.target.value as Draft['mode'] });
                  }}
                />

                {draft.mode === 'add' ? (
                  <div className="grid gap-4 sm:grid-cols-3">
                    <Input
                      label="Name"
                      value={draft.name}
                      placeholder="Summer break"
                      onChange={(event) => {
                        setDraft({ ...draft, name: event.target.value });
                      }}
                    />
                    <Input
                      label="From"
                      type="date"
                      value={draft.startsOn}
                      onChange={(event) => {
                        setDraft({ ...draft, startsOn: event.target.value });
                      }}
                    />
                    <Input
                      label="To"
                      type="date"
                      value={draft.endsOn}
                      onChange={(event) => {
                        setDraft({ ...draft, endsOn: event.target.value });
                      }}
                    />
                  </div>
                ) : (
                  <div className="grid gap-4 sm:grid-cols-3">
                    <Select
                      label="Holiday"
                      placeholder="Choose one"
                      value={draft.holidayId}
                      options={holidays.map((row) => ({
                        value: row.id,
                        label: `${row.name} (${row.startsOn})`,
                      }))}
                      onChange={(event) => {
                        setDraft({ ...draft, holidayId: event.target.value });
                      }}
                    />
                    {draft.mode === 'move' ? (
                      <>
                        <Input
                          label="New from"
                          type="date"
                          value={draft.movedStartsOn}
                          onChange={(event) => {
                            setDraft({ ...draft, movedStartsOn: event.target.value });
                          }}
                        />
                        <Input
                          label="New to"
                          type="date"
                          value={draft.movedEndsOn}
                          onChange={(event) => {
                            setDraft({ ...draft, movedEndsOn: event.target.value });
                          }}
                        />
                      </>
                    ) : null}
                  </div>
                )}

                <MultiSelect
                  label="Who it applies to"
                  hint="Leave empty for everybody on this calendar."
                  value={draft.roles}
                  options={STAFF_ROLE_OPTIONS}
                  onChange={(roles) => {
                    setDraft({ ...draft, roles });
                  }}
                />

                <Toggle
                  label="Tell them about it"
                  description="Sends the school's usual announcement — notice board, bell and email — to the roles above."
                  checked={draft.notify}
                  onChange={(next) => {
                    setDraft({ ...draft, notify: next });
                  }}
                />

                <div className="flex gap-3">
                  <Button
                    isLoading={busy === 'override'}
                    onClick={() => {
                      void addOverride();
                    }}
                  >
                    Save
                  </Button>
                  <Button
                    variant="ghost"
                    onClick={() => {
                      setDraft(null);
                    }}
                  >
                    Cancel
                  </Button>
                </div>
              </div>
            )}
          </div>
        )}
      </Card>
    </div>
  );
}

/**
 * Every role on a calendar, for an override that names none.
 *
 * The notify route needs an explicit audience — it will not send to "everybody
 * on the teaching calendar", because that is a concept only this module has.
 */
function rolesOnCalendar(calendar: CalendarRow): UserRole[] {
  return calendar.category === 'teaching'
    ? ['principal', 'vice_principal', 'section_head', 'coordinator', 'teacher']
    : ['school_admin', 'branch_admin', 'accountant', 'hr_manager', 'marketing'];
}
