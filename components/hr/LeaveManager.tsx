'use client';

import { useCallback, useEffect, useState } from 'react';

import { countHint, useLeaveCount } from '@/components/leave/useLeaveCount';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card, CardTitle } from '@/components/ui/Card';
import { DataTable, type DataTableColumn } from '@/components/ui/DataTable';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { Textarea } from '@/components/ui/Textarea';
import { Toggle } from '@/components/ui/Toggle';
import { LEAVE_STATUS_LABELS, type LeaveStatus } from '@/db/schema/leave-requests';
import { dayLabel } from '@/lib/leave-quota';
import { schoolErrorMessage, schoolFetch } from '@/lib/school-client';

/**
 * HR's leave screen: the heads a school grants, and every application.
 *
 * ── QA round 1 moved this onto the new flow (F1) ─────────────────────────
 * This screen filed and decided through `/api/school/hr/leave-requests`, which
 * checked only `hr.write`. QA, as an HR manager, filed a single-day request on
 * Iqbal Day (201 — the new route refuses it 422), filed for another campus's
 * staff past the `wrong_campus` refusal, and **decided** a request although HR
 * holds no `leave.approve`. Every rule Part B added was one screen away from
 * being skipped.
 *
 * So it now lists through `/api/school/leave/requests` — `scope=all` for
 * whoever manages leave, the chain-scoped queue for an approver who does not —
 * and files through the same POST the self-service form uses, which applies
 * the holiday, overlap, quota and campus checks. **HR does not decide leave**:
 * the Approve and Reject buttons appear only for somebody holding
 * `leave.approve`, and go to the decision endpoint, which re-resolves the chain.
 * The two legacy write routes refuse with 410.
 *
 * ── Leave types have their controls (F3) ─────────────────────────────────
 * The spec gives HR create, edit and retire. Retire means inactive: a head that
 * has requests against it is referenced by payslips and must stay explainable,
 * so there is no delete. Seeding is idempotent and offered whenever a default
 * is missing, not only on an empty school.
 *
 * Whether a head is paid is shown on every row, because that single flag is
 * what decides if an approval costs the teacher money.
 */

interface LeaveTypeRow {
  id: string;
  name: string;
  description: string | null;
  annualQuotaDays: number;
  isPaid: boolean;
  isActive: boolean;
}

interface LeaveRequestRow {
  id: string;
  staffId: string;
  staffName: string;
  employeeCode: string;
  branchName: string | null;
  leaveTypeName: string;
  isPaid: boolean;
  startDate: string;
  endDate: string;
  totalDays: string;
  reason: string | null;
  status: LeaveStatus;
  decisionNote: string | null;
  decidedByName: string | null;
  /** Present on the approver's queue; absent on HR's whole-school list. */
  canDecide?: boolean;
}

interface StaffOption {
  id: string;
  fullName: string;
  employeeCode: string;
}

export interface LeaveManagerProps {
  /** `leave.manage` — file on behalf, see every request, keep the leave heads. */
  canManage: boolean;
  /** `leave.approve` — decide, within the chain the server resolves. */
  canApprove: boolean;
}

const STATUS_VARIANT: Record<LeaveStatus, 'success' | 'warning' | 'danger' | 'neutral'> = {
  approved: 'success',
  pending: 'warning',
  rejected: 'danger',
  cancelled: 'neutral',
};

const STATUS_FILTERS = [
  { value: 'pending', label: 'Pending' },
  { value: '', label: 'All' },
  { value: 'approved', label: 'Approved' },
  { value: 'rejected', label: 'Rejected' },
];

/** The four heads `DEFAULT_LEAVE_TYPES` seeds, by name. */
const DEFAULT_NAMES = ['Casual Leave', 'Sick Leave', 'Annual Leave', 'Unpaid Leave'];

interface RequestDraft {
  staffId: string;
  leaveTypeId: string;
  startDate: string;
  endDate: string;
  totalDays: string;
  reason: string;
}

interface TypeDraft {
  /** Null = a new head. */
  id: string | null;
  name: string;
  description: string;
  annualQuotaDays: string;
  isPaid: boolean;
}

const EMPTY_TYPE: TypeDraft = {
  id: null,
  name: '',
  description: '',
  annualQuotaDays: '0',
  isPaid: true,
};

export function LeaveManager({ canManage, canApprove }: LeaveManagerProps) {
  const [types, setTypes] = useState<LeaveTypeRow[] | null>(null);
  const [requests, setRequests] = useState<LeaveRequestRow[] | null>(null);
  const [staff, setStaff] = useState<StaffOption[]>([]);
  const [statusFilter, setStatusFilter] = useState('pending');
  const [draft, setDraft] = useState<RequestDraft | null>(null);
  const [typeDraft, setTypeDraft] = useState<TypeDraft | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [pending, setPending] = useState(true);

  const counting = useLeaveCount(
    draft?.startDate ?? '',
    draft?.endDate ?? '',
    draft === null || draft.staffId === '' ? null : draft.staffId,
  );

  // The counted figure fills the box; a typed half day survives until the
  // dates change, because it is an answer about *those* dates.
  const countedDays = counting.result?.days ?? null;
  useEffect(() => {
    if (countedDays === null) return;
    setDraft((held) => (held === null ? held : { ...held, totalDays: String(countedDays) }));
  }, [countedDays]);

  const load = useCallback(async () => {
    setPending(true);
    try {
      const status = statusFilter === '' ? '' : `&status=${statusFilter}`;
      // HR sees the school; an approver without `leave.manage` sees their queue.
      const listPath = canManage
        ? `/api/school/leave/requests?scope=all${status}`
        : `/api/school/leave/requests?scope=inbox${status}`;

      const [typePayload, requestPayload, staffPayload] = await Promise.all([
        schoolFetch<{ leaveTypes: LeaveTypeRow[] }>('/api/school/hr/leave-types'),
        schoolFetch<{ leaveRequests?: LeaveRequestRow[]; rows?: LeaveRequestRow[] }>(listPath),
        canManage
          ? schoolFetch<{ staff: StaffOption[] }>('/api/school/hr/staff?status=active')
          : Promise.resolve({ staff: [] as StaffOption[] }),
      ]);

      setTypes(typePayload.leaveTypes);
      setRequests(requestPayload.leaveRequests ?? requestPayload.rows ?? []);
      setStaff(staffPayload.staff);
      setError(null);
    } catch (caught) {
      setError(schoolErrorMessage(caught, 'Could not load leave.'));
    } finally {
      setPending(false);
    }
  }, [statusFilter, canManage]);

  useEffect(() => {
    void load();
  }, [load]);

  const run = async (key: string, work: () => Promise<void>, failure: string): Promise<void> => {
    setBusy(key);
    setError(null);
    setNotice(null);
    try {
      await work();
    } catch (caught) {
      setError(schoolErrorMessage(caught, failure));
    } finally {
      setBusy(null);
    }
  };

  const seed = (): Promise<void> =>
    run(
      'seed',
      async () => {
        await schoolFetch('/api/school/hr/leave-types', {
          method: 'POST',
          body: JSON.stringify({ seed: true }),
        });
        setNotice('The standard leave types are in place. Any you had already tuned were left alone.');
        await load();
      },
      'Could not add the standard leave types.',
    );

  const saveType = (): Promise<void> => {
    if (typeDraft === null) return Promise.resolve();
    const body = {
      name: typeDraft.name.trim(),
      description: typeDraft.description.trim(),
      annualQuotaDays: Number(typeDraft.annualQuotaDays),
      isPaid: typeDraft.isPaid,
    };

    return run(
      'type',
      async () => {
        await schoolFetch(
          typeDraft.id === null ? '/api/school/hr/leave-types' : `/api/school/hr/leave-types/${typeDraft.id}`,
          { method: typeDraft.id === null ? 'POST' : 'PATCH', body: JSON.stringify(body) },
        );
        setNotice(typeDraft.id === null ? `${body.name} added.` : `${body.name} saved.`);
        setTypeDraft(null);
        await load();
      },
      'Could not save that leave type.',
    );
  };

  const setActive = (row: LeaveTypeRow, isActive: boolean): Promise<void> =>
    run(
      `type-${row.id}`,
      async () => {
        await schoolFetch(`/api/school/hr/leave-types/${row.id}`, {
          method: 'PATCH',
          body: JSON.stringify({ isActive }),
        });
        setNotice(
          isActive
            ? `${row.name} is offered again.`
            : `${row.name} is retired. It is no longer offered, and every request already made under it is kept.`,
        );
        await load();
      },
      'Could not change that leave type.',
    );

  const file = (): Promise<void> => {
    if (draft === null) return Promise.resolve();
    if (draft.staffId === '' || draft.leaveTypeId === '') {
      setError('Choose a staff member and a leave type.');
      return Promise.resolve();
    }

    return run(
      'file',
      async () => {
        const result = await schoolFetch<{ counted: { days: number } }>('/api/school/leave/requests', {
          method: 'POST',
          body: JSON.stringify({
            staffId: draft.staffId,
            leaveTypeId: draft.leaveTypeId,
            startDate: draft.startDate,
            endDate: draft.endDate,
            totalDays: draft.totalDays === '' ? undefined : Number(draft.totalDays),
            reason: draft.reason.trim(),
          }),
        });
        setDraft(null);
        setNotice(
          `Filed for ${dayLabel(result.counted.days)}. It goes up the approval chain like any other request.`,
        );
        await load();
      },
      'Could not file the leave request.',
    );
  };

  const decide = (row: LeaveRequestRow, status: 'approved' | 'rejected'): Promise<void> => {
    let note = '';
    if (status === 'rejected') {
      const entered = window.prompt('Why is this being rejected? The staff member sees it.');
      if (entered === null || entered.trim() === '') return Promise.resolve();
      note = entered.trim();
    }

    return run(
      row.id,
      async () => {
        await schoolFetch(`/api/school/leave/requests/${row.id}/decision`, {
          method: 'POST',
          body: JSON.stringify({ status, decisionNote: note }),
        });
        await load();
      },
      'Could not record the decision.',
    );
  };

  const activeTypes = (types ?? []).filter((row) => row.isActive);
  const missingDefaults = DEFAULT_NAMES.filter(
    (name) => !(types ?? []).some((row) => row.name === name),
  );

  const requestColumns: Array<DataTableColumn<LeaveRequestRow>> = [
    {
      id: 'staff',
      header: 'Staff',
      sortValue: (row) => row.staffName,
      searchValue: (row) => `${row.staffName} ${row.employeeCode}`,
      cell: (row) => (
        <>
          <p className="font-medium text-ink">{row.staffName}</p>
          <p className="text-xs text-ink-muted">
            {row.employeeCode}
            {row.branchName === null ? '' : ` · ${row.branchName}`}
          </p>
        </>
      ),
    },
    {
      id: 'type',
      header: 'Type',
      muted: true,
      sortValue: (row) => row.leaveTypeName,
      searchValue: (row) => row.leaveTypeName,
      cell: (row) => (
        <>
          {row.leaveTypeName}
          {row.isPaid ? null : (
            <Badge className="ml-2" variant="danger">
              Unpaid
            </Badge>
          )}
        </>
      ),
    },
    {
      id: 'dates',
      header: 'Dates',
      kind: 'date',
      muted: true,
      sortValue: (row) => row.startDate,
      cell: (row) => (
        <>
          {row.startDate} → {row.endDate}
          {row.reason === null || row.reason === '' ? null : (
            <p className="text-xs text-ink-muted">{row.reason}</p>
          )}
        </>
      ),
    },
    {
      id: 'days',
      header: 'Days',
      kind: 'number',
      muted: true,
      sortValue: (row) => Number(row.totalDays),
      cell: (row) => row.totalDays,
    },
    {
      id: 'status',
      header: 'Status',
      sortValue: (row) => LEAVE_STATUS_LABELS[row.status],
      cell: (row) => (
        <>
          <Badge variant={STATUS_VARIANT[row.status]}>{LEAVE_STATUS_LABELS[row.status]}</Badge>
          {row.decisionNote === null || row.decisionNote === '' ? null : (
            <p className="mt-1 text-xs text-ink-muted">
              {row.decidedByName === null ? '' : `${row.decidedByName}: `}
              {row.decisionNote}
            </p>
          )}
        </>
      ),
    },
  ];

  // Only somebody who may approve sees the buttons, and only where the chain
  // has not already said no. The decision endpoint re-resolves it either way.
  if (canApprove) {
    requestColumns.push({
      id: 'decide',
      header: <span className="sr-only">Decide</span>,
      align: 'end',
      cell: (row) =>
        row.status === 'pending' && row.canDecide !== false ? (
          <div className="flex justify-end gap-2">
            <Button
              size="sm"
              isLoading={busy === row.id}
              onClick={() => {
                void decide(row, 'approved');
              }}
            >
              Approve
            </Button>
            <Button
              size="sm"
              variant="secondary"
              onClick={() => {
                void decide(row, 'rejected');
              }}
            >
              Reject
            </Button>
          </div>
        ) : null,
    });
  }

  return (
    <div className="space-y-6">
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

      <Card
        header={
          <CardTitle
            title="Leave types"
            description="Whether a head is paid decides if approving it costs the teacher money. Retiring one stops it being offered and keeps every request made under it."
            action={
              canManage ? (
                <div className="flex flex-wrap gap-2">
                  {missingDefaults.length > 0 ? (
                    <Button
                      size="sm"
                      variant="secondary"
                      isLoading={busy === 'seed'}
                      onClick={() => {
                        void seed();
                      }}
                    >
                      {(types?.length ?? 0) === 0 ? 'Seed defaults' : 'Add missing defaults'}
                    </Button>
                  ) : null}
                  {typeDraft === null ? (
                    <Button
                      size="sm"
                      onClick={() => {
                        setTypeDraft(EMPTY_TYPE);
                      }}
                    >
                      Add a leave type
                    </Button>
                  ) : null}
                </div>
              ) : undefined
            }
          />
        }
      >
        {types === null ? (
          <p className="text-sm text-ink-muted">Loading leave types…</p>
        ) : types.length === 0 ? (
          <p className="text-sm text-ink-muted">
            No leave types yet. Seeding creates the usual four — Casual (10 days), Sick (8),
            Annual (14) and Unpaid, the one that docks pay.
          </p>
        ) : (
          <ul className="divide-y divide-line rounded-lg border border-line">
            {types.map((row) => (
              <li key={row.id} className="flex flex-wrap items-center justify-between gap-3 px-3 py-2 text-sm">
                <div className="min-w-0">
                  <span className={row.isActive ? 'font-medium text-ink' : 'font-medium text-ink-muted line-through'}>
                    {row.name}
                  </span>
                  <span className="ml-2 text-ink-muted">
                    {row.annualQuotaDays === 0 ? 'no quota' : `${row.annualQuotaDays} days/year`}
                  </span>
                  <Badge className="ml-2" variant={row.isPaid ? 'success' : 'danger'}>
                    {row.isPaid ? 'Paid' : 'Unpaid'}
                  </Badge>
                  {row.isActive ? null : (
                    <Badge className="ml-2" variant="neutral">
                      Retired
                    </Badge>
                  )}
                  {row.description === null || row.description === '' ? null : (
                    <p className="text-xs text-ink-muted">{row.description}</p>
                  )}
                </div>

                {canManage ? (
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => {
                        setTypeDraft({
                          id: row.id,
                          name: row.name,
                          description: row.description ?? '',
                          annualQuotaDays: String(row.annualQuotaDays),
                          isPaid: row.isPaid,
                        });
                      }}
                    >
                      Edit
                    </Button>
                    <Button
                      size="sm"
                      variant="secondary"
                      isLoading={busy === `type-${row.id}`}
                      onClick={() => {
                        void setActive(row, !row.isActive);
                      }}
                    >
                      {row.isActive ? 'Retire' : 'Offer again'}
                    </Button>
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
        )}

        {typeDraft === null ? null : (
          <div className="mt-4 space-y-4 rounded-lg border border-line p-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <Input
                label="Name"
                value={typeDraft.name}
                maxLength={60}
                placeholder="Maternity Leave"
                onChange={(event) => {
                  setTypeDraft({ ...typeDraft, name: event.target.value });
                }}
              />
              <Input
                label="Days a year"
                type="number"
                min={0}
                max={365}
                step={1}
                value={typeDraft.annualQuotaDays}
                hint="0 means no quota — every request is decided by hand."
                onChange={(event) => {
                  setTypeDraft({ ...typeDraft, annualQuotaDays: event.target.value });
                }}
              />
              <div className="sm:col-span-2">
                <Textarea
                  label="Description"
                  rows={2}
                  value={typeDraft.description}
                  onChange={(event) => {
                    setTypeDraft({ ...typeDraft, description: event.target.value });
                  }}
                />
              </div>
            </div>
            <Toggle
              label="Paid"
              description="Off means every approved day of this leave is docked from pay."
              checked={typeDraft.isPaid}
              onChange={(next) => {
                setTypeDraft({ ...typeDraft, isPaid: next });
              }}
            />
            <div className="flex gap-3">
              <Button
                isLoading={busy === 'type'}
                onClick={() => {
                  void saveType();
                }}
              >
                {typeDraft.id === null ? 'Add leave type' : 'Save'}
              </Button>
              <Button
                variant="ghost"
                onClick={() => {
                  setTypeDraft(null);
                }}
              >
                Cancel
              </Button>
            </div>
          </div>
        )}
      </Card>

      {draft !== null ? (
        <Card
          header={
            <CardTitle
              title="File a request for somebody"
              description="For a member of staff who cannot apply themselves. It goes up their approval chain like any other request."
            />
          }
        >
          <div className="grid gap-4 sm:grid-cols-2">
            <Select
              label="Staff member"
              placeholder="Choose someone"
              options={staff.map((row) => ({
                value: row.id,
                label: `${row.fullName} (${row.employeeCode})`,
              }))}
              value={draft.staffId}
              onChange={(event) => {
                setError(null);
                setDraft({ ...draft, staffId: event.target.value });
              }}
            />
            <Select
              label="Leave type"
              options={activeTypes.map((row) => ({
                value: row.id,
                label: `${row.name} (${row.isPaid ? 'paid' : 'unpaid'})`,
              }))}
              value={draft.leaveTypeId}
              onChange={(event) => {
                setDraft({ ...draft, leaveTypeId: event.target.value });
              }}
            />
            <Input
              label="From"
              type="date"
              value={draft.startDate}
              onChange={(event) => {
                setError(null);
                setDraft({ ...draft, startDate: event.target.value, totalDays: '' });
              }}
            />
            <Input
              label="To"
              type="date"
              value={draft.endDate}
              onChange={(event) => {
                setError(null);
                setDraft({ ...draft, endDate: event.target.value, totalDays: '' });
              }}
            />
            <Input
              label="Days used"
              type="number"
              min={0.5}
              step={0.5}
              value={draft.totalDays}
              hint={
                draft.staffId === ''
                  ? 'Choose the staff member first — their calendar decides what counts.'
                  : countHint(counting, draft.startDate, draft.endDate)
              }
              onChange={(event) => {
                setDraft({ ...draft, totalDays: event.target.value });
              }}
            />
            <div className="sm:col-span-2">
              <Textarea
                label="Reason"
                rows={2}
                value={draft.reason}
                onChange={(event) => {
                  setDraft({ ...draft, reason: event.target.value });
                }}
              />
            </div>
          </div>

          {counting.result?.holidayProblem == null ? null : (
            <p className="mt-3 rounded-lg bg-status-warning-subtle px-3 py-2 text-sm text-status-warning-ink">
              {counting.result.holidayProblem}
            </p>
          )}

          <div className="mt-4 flex gap-3">
            <Button
              isLoading={busy === 'file'}
              disabled={counting.pending}
              onClick={() => {
                void file();
              }}
            >
              File request
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

      <DataTable
        caption="Leave requests"
        columns={requestColumns}
        rows={requests ?? []}
        getRowKey={(row) => row.id}
        pending={pending}
        defaultSort={{ columnId: 'dates', direction: 'desc' }}
        search={{ placeholder: 'Staff name, code or leave type' }}
        extraFilters={
          <div className="w-full sm:w-52">
            <Select
              label="Show"
              options={STATUS_FILTERS}
              value={statusFilter}
              onChange={(event) => {
                setStatusFilter(event.target.value);
              }}
            />
          </div>
        }
        actions={
          canManage && draft === null && activeTypes.length > 0 ? (
            <Button
              onClick={() => {
                setDraft({
                  staffId: '',
                  leaveTypeId: activeTypes[0]?.id ?? '',
                  startDate: '',
                  endDate: '',
                  totalDays: '',
                  reason: '',
                });
              }}
            >
              File a request
            </Button>
          ) : undefined
        }
        itemNoun={{ singular: 'request', plural: 'requests' }}
        emptyTitle="No leave requests to show"
        emptyDescription={
          canManage
            ? 'Applications from staff, and those filed here, appear once they exist.'
            : 'Requests from the people who report to you appear here for a decision.'
        }
        noResultTitle="No requests in that state"
        noResultDescription="Choose another state, or show every request."
      />
    </div>
  );
}
