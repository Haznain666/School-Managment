'use client';

import { useCallback, useEffect, useState } from 'react';

import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card, CardTitle } from '@/components/ui/Card';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { Textarea } from '@/components/ui/Textarea';
import { LEAVE_STATUS_LABELS, type LeaveStatus } from '@/db/schema/leave-requests';
import { schoolErrorMessage, schoolFetch } from '@/lib/school-client';

/**
 * Leave: the heads a school grants, and the applications against them.
 *
 * Whether a head is paid is shown on every row rather than buried in its
 * settings, because that single flag is what decides if an approval costs the
 * teacher money. An approver about to sign off five days should be able to see
 * it without opening anything.
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
  leaveTypeName: string;
  isPaid: boolean;
  startDate: string;
  endDate: string;
  totalDays: string;
  reason: string | null;
  status: LeaveStatus;
  decisionNote: string | null;
}

interface StaffOption {
  id: string;
  fullName: string;
  employeeCode: string;
}

export interface LeaveManagerProps {
  canEdit: boolean;
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

interface Draft {
  staffId: string;
  leaveTypeId: string;
  startDate: string;
  endDate: string;
  totalDays: string;
  reason: string;
}

/** Inclusive calendar days between two ISO dates, or 0 when either is unset. */
function spanDays(start: string, end: string): number {
  if (start === '' || end === '') return 0;

  const from = Date.parse(`${start}T00:00:00Z`);
  const to = Date.parse(`${end}T00:00:00Z`);
  if (Number.isNaN(from) || Number.isNaN(to) || to < from) return 0;

  return Math.round((to - from) / 86_400_000) + 1;
}

export function LeaveManager({ canEdit }: LeaveManagerProps) {
  const [types, setTypes] = useState<LeaveTypeRow[] | null>(null);
  const [requests, setRequests] = useState<LeaveRequestRow[] | null>(null);
  const [staff, setStaff] = useState<StaffOption[]>([]);
  const [statusFilter, setStatusFilter] = useState('pending');
  const [draft, setDraft] = useState<Draft | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const query = statusFilter === '' ? '' : `?status=${statusFilter}`;

      const [typePayload, requestPayload, staffPayload] = await Promise.all([
        schoolFetch<{ leaveTypes: LeaveTypeRow[] }>('/api/school/hr/leave-types'),
        schoolFetch<{ leaveRequests: LeaveRequestRow[] }>(
          `/api/school/hr/leave-requests${query}`,
        ),
        schoolFetch<{ staff: StaffOption[] }>('/api/school/hr/staff?status=active'),
      ]);

      setTypes(typePayload.leaveTypes);
      setRequests(requestPayload.leaveRequests);
      setStaff(staffPayload.staff);
      setError(null);
    } catch (caught) {
      setError(schoolErrorMessage(caught, 'Could not load leave.'));
    }
  }, [statusFilter]);

  useEffect(() => {
    void load();
  }, [load]);

  const seed = async (): Promise<void> => {
    setBusy('seed');
    setError(null);

    try {
      await schoolFetch('/api/school/hr/leave-types', {
        method: 'POST',
        body: JSON.stringify({ seed: true }),
      });
      await load();
    } catch (caught) {
      setError(schoolErrorMessage(caught, 'Could not seed the leave types.'));
    } finally {
      setBusy(null);
    }
  };

  const file = async (): Promise<void> => {
    if (draft === null) return;

    if (draft.staffId === '' || draft.leaveTypeId === '') {
      setError('Choose a staff member and a leave type.');
      return;
    }

    const span = spanDays(draft.startDate, draft.endDate);
    if (span === 0) {
      setError('Enter a start and end date, with the end on or after the start.');
      return;
    }

    setBusy('file');
    setError(null);

    try {
      await schoolFetch('/api/school/hr/leave-requests', {
        method: 'POST',
        body: JSON.stringify({
          staffId: draft.staffId,
          leaveTypeId: draft.leaveTypeId,
          startDate: draft.startDate,
          endDate: draft.endDate,
          totalDays: Number(draft.totalDays) || span,
          reason: draft.reason.trim(),
        }),
      });
      setDraft(null);
      await load();
    } catch (caught) {
      setError(schoolErrorMessage(caught, 'Could not file the leave request.'));
    } finally {
      setBusy(null);
    }
  };

  const decide = async (row: LeaveRequestRow, status: LeaveStatus): Promise<void> => {
    let note = '';

    if (status === 'rejected') {
      const entered = window.prompt('Why is this being rejected? The staff member sees it.');
      if (entered === null || entered.trim() === '') return;
      note = entered.trim();
    }

    setBusy(row.id);
    setError(null);

    try {
      await schoolFetch(`/api/school/hr/leave-requests/${row.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ status, decisionNote: note }),
      });
      await load();
    } catch (caught) {
      setError(schoolErrorMessage(caught, 'Could not record the decision.'));
    } finally {
      setBusy(null);
    }
  };

  const activeTypes = (types ?? []).filter((row) => row.isActive);

  return (
    <div className="space-y-6">
      {error !== null ? (
        <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </p>
      ) : null}

      <Card
        header={
          <CardTitle
            title="Leave types"
            description="Whether a head is paid decides if approving it costs the teacher money."
            action={
              canEdit && (types?.length ?? 0) === 0 ? (
                <Button
                  size="sm"
                  isLoading={busy === 'seed'}
                  onClick={() => {
                    void seed();
                  }}
                >
                  Seed defaults
                </Button>
              ) : undefined
            }
          />
        }
      >
        {types === null ? (
          <p className="text-sm text-slate-500">Loading leave types…</p>
        ) : types.length === 0 ? (
          <p className="text-sm text-slate-600">
            No leave types yet. Seeding creates the usual four — Casual (10 days),
            Sick (8), Annual (14) and Unpaid, the one that docks pay.
          </p>
        ) : (
          <ul className="flex flex-wrap gap-2">
            {types.map((row) => (
              <li
                key={row.id}
                className="rounded-lg border border-slate-200 px-3 py-2 text-sm"
              >
                <span className="font-medium text-slate-900">{row.name}</span>
                <span className="ml-2 text-slate-500">
                  {row.annualQuotaDays === 0
                    ? 'no quota'
                    : `${row.annualQuotaDays} days/year`}
                </span>
                <Badge className="ml-2" variant={row.isPaid ? 'success' : 'danger'}>
                  {row.isPaid ? 'Paid' : 'Unpaid'}
                </Badge>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card>
        <div className="grid gap-4 sm:grid-cols-3">
          <Select
            label="Show"
            options={STATUS_FILTERS}
            value={statusFilter}
            onChange={(event) => {
              setStatusFilter(event.target.value);
            }}
          />
          {canEdit && draft === null && activeTypes.length > 0 ? (
            <div className="flex items-end">
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
            </div>
          ) : null}
        </div>
      </Card>

      {draft !== null ? (
        <Card header={<CardTitle title="New leave request" />}>
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
                setDraft({ ...draft, startDate: event.target.value });
              }}
            />
            <Input
              label="To"
              type="date"
              value={draft.endDate}
              onChange={(event) => {
                setDraft({ ...draft, endDate: event.target.value });
              }}
            />
            <Input
              label="Days used"
              type="number"
              min={0.5}
              step={0.5}
              value={draft.totalDays}
              placeholder={String(spanDays(draft.startDate, draft.endDate))}
              hint="Half days allowed. Defaults to the whole range."
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

          <div className="mt-4 flex gap-3">
            <Button
              isLoading={busy === 'file'}
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

      {requests === null ? (
        <Card>
          <p className="text-sm text-slate-500">Loading requests…</p>
        </Card>
      ) : requests.length === 0 ? (
        <Card>
          <p className="text-sm text-slate-600">No leave requests to show.</p>
        </Card>
      ) : (
        <Card
          header={
            <CardTitle
              title="Leave requests"
              description={`${requests.length} request${requests.length === 1 ? '' : 's'}.`}
            />
          }
          className="p-0"
        >
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th scope="col" className="px-5 py-3 font-medium">Staff</th>
                  <th scope="col" className="px-5 py-3 font-medium">Type</th>
                  <th scope="col" className="px-5 py-3 font-medium">Dates</th>
                  <th scope="col" className="px-5 py-3 font-medium">Days</th>
                  <th scope="col" className="px-5 py-3 font-medium">Status</th>
                  {canEdit ? (
                    <th scope="col" className="px-5 py-3 font-medium">
                      <span className="sr-only">Decide</span>
                    </th>
                  ) : null}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {requests.map((row) => (
                  <tr key={row.id}>
                    <td className="px-5 py-3">
                      <p className="font-medium text-slate-900">{row.staffName}</p>
                      <p className="text-xs text-slate-500">{row.employeeCode}</p>
                    </td>
                    <td className="px-5 py-3 text-slate-600">
                      {row.leaveTypeName}
                      {row.isPaid ? null : (
                        <Badge className="ml-2" variant="danger">
                          Unpaid
                        </Badge>
                      )}
                    </td>
                    <td className="px-5 py-3 text-slate-600">
                      {row.startDate} → {row.endDate}
                      {row.reason === null || row.reason === '' ? null : (
                        <p className="text-xs text-slate-500">{row.reason}</p>
                      )}
                    </td>
                    <td className="px-5 py-3 text-slate-600">{row.totalDays}</td>
                    <td className="px-5 py-3">
                      <Badge variant={STATUS_VARIANT[row.status]}>
                        {LEAVE_STATUS_LABELS[row.status]}
                      </Badge>
                      {row.decisionNote === null || row.decisionNote === '' ? null : (
                        <p className="mt-1 text-xs text-slate-500">{row.decisionNote}</p>
                      )}
                    </td>
                    {canEdit ? (
                      <td className="px-5 py-3">
                        {row.status === 'pending' ? (
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
                        ) : null}
                      </td>
                    ) : null}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  );
}
