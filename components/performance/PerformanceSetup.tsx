'use client';

import { useMemo, useState } from 'react';

import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card, CardTitle } from '@/components/ui/Card';
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
import { Toggle } from '@/components/ui/Toggle';
import { formatDateOnly } from '@/lib/dates';
import type { SetupData } from '@/lib/kpi-board';
import {
  BRANCH_ADMIN_RATER_OPTIONS,
  PRINCIPAL_RATER_OPTIONS,
  RATER_OPTION_LABELS,
  type KpiSettings,
} from '@/lib/kpis';
import { schoolErrorMessage, schoolFetch } from '@/lib/school-client';

/**
 * Staff performance → Setup — Sprint 32.
 *
 * Four things, each shown only to whoever may change it:
 *
 *   · rule 7's two settings — the School Administrator;
 *   · which principal each vice principal serves — the School Administrator,
 *     at a school with several principals;
 *   · which teachers each coordinator supervises — a Principal (rule 8);
 *   · every teacher's one principal, transfer requests, and the School
 *     Administrator settling a tie — at a school with several principals.
 *
 * Every save answers with the whole setup, read the way the page read it, and
 * the screen replaces its state from that. Nothing here calls
 * `router.refresh()`.
 */

const SOURCE_LABELS: Record<string, string> = {
  derived: 'Teaches most under them',
  transferred: 'Transferred',
  assigned: 'Set by the school',
  single: 'The school’s principal',
};

const REASON_LABELS: Record<string, string> = {
  tie: 'Equal periods under two principals — choose one',
  no_periods: 'No periods and no class — choose one',
};

export function PerformanceSetup({
  initial,
  canRequestTransfer,
}: {
  initial: SetupData;
  canRequestTransfer: boolean;
}) {
  const [setup, setSetup] = useState(initial);
  const [settings, setSettings] = useState<KpiSettings>(initial.settings);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const run = async (
    key: string,
    work: () => Promise<void>,
    fallback: string,
  ): Promise<void> => {
    setBusy(key);
    setError(null);
    setNotice(null);
    try {
      await work();
    } catch (caught) {
      setError(schoolErrorMessage(caught, fallback));
    } finally {
      setBusy(null);
    }
  };

  /* ------------------------------------------------------------ settings */
  const saveSettings = (): Promise<void> =>
    run(
      'settings',
      async () => {
        const payload = await schoolFetch<{ settings: KpiSettings }>('/api/school/kpis/settings', {
          method: 'PUT',
          body: JSON.stringify(settings),
        });
        setSettings(payload.settings);
        setSetup({ ...setup, settings: payload.settings });
        setNotice('Rating settings saved.');
      },
      'The settings could not be saved.',
    );

  const toggleRater = (
    field: 'principalRaters' | 'branchAdminRaters',
    value: string,
    checked: boolean,
  ): void => {
    const current = settings[field] as string[];
    const next = checked ? [...new Set([...current, value])] : current.filter((entry) => entry !== value);
    setSettings({ ...settings, [field]: next } as KpiSettings);
  };

  /* -------------------------------------------------------- coordinators */
  const [coordinatorId, setCoordinatorId] = useState(initial.coordinators[0]?.userId ?? '');
  const coordinator = setup.coordinators.find((row) => row.userId === coordinatorId) ?? null;
  const [picked, setPicked] = useState<string[]>(coordinator?.teacherUserIds ?? []);

  const campusTeachers = useMemo(
    () =>
      coordinator === null
        ? []
        : setup.teachers.filter((teacher) => teacher.branchId === coordinator.branchId),
    [coordinator, setup.teachers],
  );

  const chooseCoordinator = (id: string): void => {
    setCoordinatorId(id);
    setPicked(setup.coordinators.find((row) => row.userId === id)?.teacherUserIds ?? []);
  };

  const saveCoordinator = (): Promise<void> =>
    run(
      'coordinator',
      async () => {
        if (coordinator === null) return;
        const mine = picked.filter(
          (id) => campusTeachers.find((teacher) => teacher.userId === id)?.mine === true,
        );
        const payload = await schoolFetch<{ setup: SetupData }>('/api/school/kpis/coordinators', {
          method: 'PUT',
          body: JSON.stringify({ coordinatorUserId: coordinator.userId, teacherUserIds: mine }),
        });
        setSetup(payload.setup);
        setPicked(
          payload.setup.coordinators.find((row) => row.userId === coordinator.userId)
            ?.teacherUserIds ?? [],
        );
        setNotice(`${coordinator.name} now supervises ${String(mine.length)} of your teachers.`);
      },
      'The assignment could not be saved.',
    );

  /* -------------------------------------------------- principals, transfers */
  const post = (key: string, path: string, method: 'POST' | 'PUT' | 'PATCH', body: unknown, done: string) =>
    run(
      key,
      async () => {
        const payload = await schoolFetch<{ setup: SetupData }>(path, {
          method,
          body: JSON.stringify(body),
        });
        setSetup(payload.setup);
        setNotice(done);
      },
      'That could not be saved.',
    );

  const principalOptions = setup.principals.map((person) => ({
    value: person.userId,
    label: person.name,
  }));

  return (
    <div className="space-y-6">
      {error === null ? null : (
        <p className="rounded-control border border-status-danger-line bg-status-danger-surface px-3 py-2 text-sm text-status-danger-ink">
          {error}
        </p>
      )}
      {notice === null ? null : (
        <p
          role="status"
          className="rounded-control bg-status-success-subtle px-3 py-2 text-sm text-status-success-ink"
        >
          {notice}
        </p>
      )}

      {setup.canManageSettings ? (
        <Card
          header={
            <CardTitle
              title="Rating principals and branch admins"
              description="Who rates every other role is set in Settings → Roles and permissions, under Staff performance. These two are set here."
            />
          }
        >
          <div className="grid gap-6 md:grid-cols-2">
            <fieldset className="space-y-3">
              <Toggle
                label="Mark principals’ progress?"
                checked={settings.ratePrincipals}
                onChange={(next) => setSettings({ ...settings, ratePrincipals: next })}
                description="With No, principals carry no KPIs to rate. Nothing is deleted."
              />
              {settings.ratePrincipals ? (
                <div className="space-y-2 pl-1">
                  <p className="text-sm font-medium text-ink">Who rates them</p>
                  {PRINCIPAL_RATER_OPTIONS.map((option) => (
                    <label key={option} className="flex items-start gap-2 text-sm text-ink">
                      <input
                        type="checkbox"
                        className="mt-0.5 h-4 w-4"
                        checked={settings.principalRaters.includes(option)}
                        onChange={(event) =>
                          toggleRater('principalRaters', option, event.target.checked)
                        }
                      />
                      {option === 'self' ? 'The principal themselves' : RATER_OPTION_LABELS[option]}
                    </label>
                  ))}
                </div>
              ) : null}
            </fieldset>

            <fieldset className="space-y-3">
              <Toggle
                label="Mark branch admins’ progress?"
                checked={settings.rateBranchAdmins}
                onChange={(next) => setSettings({ ...settings, rateBranchAdmins: next })}
                description="With No, branch admins carry no KPIs to rate. Nothing is deleted."
              />
              {settings.rateBranchAdmins ? (
                <div className="space-y-2 pl-1">
                  <p className="text-sm font-medium text-ink">Who rates them</p>
                  {BRANCH_ADMIN_RATER_OPTIONS.map((option) => (
                    <label key={option} className="flex items-start gap-2 text-sm text-ink">
                      <input
                        type="checkbox"
                        className="mt-0.5 h-4 w-4"
                        checked={settings.branchAdminRaters.includes(option)}
                        onChange={(event) =>
                          toggleRater('branchAdminRaters', option, event.target.checked)
                        }
                      />
                      {option === 'self' ? 'The branch admin themselves' : RATER_OPTION_LABELS[option]}
                    </label>
                  ))}
                </div>
              ) : null}
            </fieldset>
          </div>
          <div className="mt-4 flex justify-end">
            <Button isLoading={busy === 'settings'} onClick={() => void saveSettings()}>
              Save rating settings
            </Button>
          </div>
        </Card>
      ) : null}

      {setup.model === 'multiple' && setup.canManageSettings && setup.vicePrincipals.length > 0 ? (
        <Card
          header={
            <CardTitle
              title="Vice principals"
              description="A vice principal reaches the teachers of the principal they serve."
            />
          }
        >
          <ul className="divide-y divide-line">
            {setup.vicePrincipals.map((deputy) => (
              <li key={deputy.userId} className="grid gap-3 py-3 sm:grid-cols-[1fr_16rem] sm:items-end">
                <p className="text-sm font-medium text-ink">{deputy.name}</p>
                <Select
                  label={`Principal ${deputy.name} serves`}
                  value={deputy.principalUserId ?? ''}
                  disabled={busy !== null}
                  options={[{ value: '', label: 'Not set' }, ...principalOptions]}
                  onChange={(event) =>
                    void post(
                      `vp-${deputy.userId}`,
                      '/api/school/kpis/vice-principals',
                      'PUT',
                      {
                        vicePrincipalUserId: deputy.userId,
                        principalUserId: event.target.value === '' ? null : event.target.value,
                      },
                      `${deputy.name}’s principal saved.`,
                    )
                  }
                />
              </li>
            ))}
          </ul>
        </Card>
      ) : null}

      <Card
        header={
          <CardTitle
            title="Coordinators and their teachers"
            description={
              setup.canAssignCoordinators
                ? 'Choose the teachers each coordinator supervises, teacher by teacher, at the coordinator’s own campus. They rate these teachers from their own portal.'
                : 'Which teachers each coordinator supervises. A principal makes these assignments.'
            }
          />
        }
      >
        {setup.coordinators.length === 0 ? (
          <p className="text-sm text-ink-muted">No coordinators are in your reach.</p>
        ) : (
          <div className="space-y-4">
            <Select
              label="Coordinator"
              value={coordinatorId}
              options={setup.coordinators.map((row) => ({
                value: row.userId,
                label: `${row.name}${row.branchName === null ? '' : ` · ${row.branchName}`}`,
              }))}
              onChange={(event) => chooseCoordinator(event.target.value)}
            />

            {coordinator === null ? null : coordinator.branchId === null ? (
              <p className="text-sm text-ink-muted">
                {coordinator.name} has no campus yet. Set it in Users &amp; Staff before assigning teachers.
              </p>
            ) : campusTeachers.length === 0 ? (
              <p className="text-sm text-ink-muted">No teachers at {coordinator.branchName ?? 'this campus'}.</p>
            ) : (
              <div className="grid gap-2 sm:grid-cols-2">
                {campusTeachers.map((teacher) => {
                  const editable = setup.canAssignCoordinators && teacher.mine;
                  return (
                    <label
                      key={teacher.userId}
                      className="flex items-start gap-2 rounded-control border border-line px-3 py-2 text-sm text-ink"
                    >
                      <input
                        type="checkbox"
                        className="mt-0.5 h-4 w-4"
                        disabled={!editable || busy !== null}
                        checked={picked.includes(teacher.userId)}
                        onChange={(event) =>
                          setPicked(
                            event.target.checked
                              ? [...picked, teacher.userId]
                              : picked.filter((id) => id !== teacher.userId),
                          )
                        }
                      />
                      <span>
                        {teacher.name}
                        {teacher.mine || teacher.principalName === null ? null : (
                          <span className="block text-xs text-ink-muted">
                            {teacher.principalName}’s teacher
                          </span>
                        )}
                      </span>
                    </label>
                  );
                })}
              </div>
            )}

            {setup.canAssignCoordinators && coordinator !== null && campusTeachers.length > 0 ? (
              <div className="flex justify-end">
                <Button isLoading={busy === 'coordinator'} onClick={() => void saveCoordinator()}>
                  Save {coordinator.name}’s teachers
                </Button>
              </div>
            ) : null}
          </div>
        )}
      </Card>

      {setup.model === 'multiple' ? (
        <>
          <Card
            header={
              <CardTitle
                title="Every teacher’s principal"
                description="Each teacher has exactly one principal: the one whose classes they teach most. A transfer is the only way to change it, and a timetable change does not undo one."
              />
            }
          >
            <Table caption="Teachers and their principals">
              <TableHead>
                <TableRow>
                  <TableHeaderCell>Teacher</TableHeaderCell>
                  <TableHeaderCell>Campus</TableHeaderCell>
                  <TableHeaderCell>Principal</TableHeaderCell>
                  <TableHeaderCell>How</TableHeaderCell>
                  <TableHeaderCell align="end">
                    <span className="sr-only">Actions</span>
                  </TableHeaderCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {setup.teachers.length === 0 ? (
                  <TableEmptyRow colSpan={5}>No teachers in your reach.</TableEmptyRow>
                ) : (
                  setup.teachers.map((teacher) => (
                    <TableRow key={teacher.userId}>
                      <TableCell>{teacher.name}</TableCell>
                      <TableCell>{teacher.branchName ?? '—'}</TableCell>
                      <TableCell>
                        {teacher.principalName ?? (
                          <Badge variant="warning">Unassigned</Badge>
                        )}
                      </TableCell>
                      <TableCell>
                        <span className="text-sm text-ink-muted">
                          {teacher.principalUserId === null
                            ? (REASON_LABELS[teacher.reason ?? ''] ?? '—')
                            : (SOURCE_LABELS[teacher.source ?? ''] ?? '—')}
                          {teacher.candidateNames.length > 0
                            ? ` (${teacher.candidateNames.join(', ')})`
                            : ''}
                        </span>
                      </TableCell>
                      <TableCell align="end">
                        <div className="flex flex-wrap justify-end gap-2">
                          {setup.canManageSettings ? (
                            <Select
                              label={`Set ${teacher.name}’s principal`}
                              value=""
                              placeholder="Set principal…"
                              disabled={busy !== null}
                              options={principalOptions.filter(
                                (option) => option.value !== teacher.principalUserId,
                              )}
                              onChange={(event) =>
                                void post(
                                  `assign-${teacher.userId}`,
                                  '/api/school/kpis/principals/assign',
                                  'POST',
                                  { teacherUserId: teacher.userId, principalUserId: event.target.value },
                                  `${teacher.name}’s principal is set.`,
                                )
                              }
                            />
                          ) : canRequestTransfer && setup.me !== null ? (
                            teacher.principalUserId === setup.me ? (
                              <Select
                                label={`Transfer ${teacher.name} to`}
                                value=""
                                placeholder="Transfer to…"
                                disabled={busy !== null}
                                options={principalOptions.filter((option) => option.value !== setup.me)}
                                onChange={(event) =>
                                  void post(
                                    `transfer-${teacher.userId}`,
                                    '/api/school/kpis/principals/transfers',
                                    'POST',
                                    { teacherUserId: teacher.userId, toPrincipalUserId: event.target.value },
                                    `Transfer of ${teacher.name} requested. The other principal decides.`,
                                  )
                                }
                              />
                            ) : (
                              <Button
                                size="sm"
                                variant="secondary"
                                isLoading={busy === `transfer-${teacher.userId}`}
                                disabled={busy !== null}
                                onClick={() =>
                                  void post(
                                    `transfer-${teacher.userId}`,
                                    '/api/school/kpis/principals/transfers',
                                    'POST',
                                    { teacherUserId: teacher.userId, toPrincipalUserId: setup.me },
                                    `You asked for ${teacher.name}. ${teacher.principalName ?? 'The School Administrator'} decides.`,
                                  )
                                }
                              >
                                Request to me
                              </Button>
                            )
                          ) : null}
                        </div>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </Card>

          <Card header={<CardTitle title="Transfer requests" description="The principal on the other side accepts or declines. Decided requests are kept." />}>
            <Table caption="Transfer requests">
              <TableHead>
                <TableRow>
                  <TableHeaderCell>Requested</TableHeaderCell>
                  <TableHeaderCell>Teacher</TableHeaderCell>
                  <TableHeaderCell>From → to</TableHeaderCell>
                  <TableHeaderCell>Status</TableHeaderCell>
                  <TableHeaderCell align="end">
                    <span className="sr-only">Actions</span>
                  </TableHeaderCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {setup.transfers.length === 0 ? (
                  <TableEmptyRow colSpan={5}>No transfer requests.</TableEmptyRow>
                ) : (
                  setup.transfers.map((transfer) => (
                    <TableRow key={transfer.id}>
                      <TableCell>
                        {formatDateOnly(transfer.createdAt)}
                        <span className="block text-xs text-ink-muted">by {transfer.requestedByName}</span>
                      </TableCell>
                      <TableCell>{transfer.teacherName}</TableCell>
                      <TableCell>
                        {transfer.fromName ?? 'Unassigned'} → {transfer.toName}
                      </TableCell>
                      <TableCell>
                        <Badge
                          variant={
                            transfer.status === 'accepted'
                              ? 'success'
                              : transfer.status === 'requested'
                                ? 'warning'
                                : 'neutral'
                          }
                        >
                          {transfer.status}
                        </Badge>
                      </TableCell>
                      <TableCell align="end">
                        <div className="flex justify-end gap-2">
                          {transfer.canDecide ? (
                            <>
                              <Button
                                size="sm"
                                isLoading={busy === `accept-${transfer.id}`}
                                disabled={busy !== null}
                                onClick={() =>
                                  void post(
                                    `accept-${transfer.id}`,
                                    `/api/school/kpis/principals/transfers/${transfer.id}`,
                                    'PATCH',
                                    { decision: 'accepted' },
                                    `${transfer.teacherName} moved to ${transfer.toName}.`,
                                  )
                                }
                              >
                                Accept
                              </Button>
                              <Button
                                size="sm"
                                variant="secondary"
                                disabled={busy !== null}
                                onClick={() =>
                                  void post(
                                    `decline-${transfer.id}`,
                                    `/api/school/kpis/principals/transfers/${transfer.id}`,
                                    'PATCH',
                                    { decision: 'declined' },
                                    'Request declined.',
                                  )
                                }
                              >
                                Decline
                              </Button>
                            </>
                          ) : null}
                          {transfer.canCancel ? (
                            <Button
                              size="sm"
                              variant="ghost"
                              disabled={busy !== null}
                              onClick={() =>
                                void post(
                                  `cancel-${transfer.id}`,
                                  `/api/school/kpis/principals/transfers/${transfer.id}`,
                                  'PATCH',
                                  { decision: 'cancelled' },
                                  'Request cancelled.',
                                )
                              }
                            >
                              Cancel
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
        </>
      ) : null}
    </div>
  );
}
