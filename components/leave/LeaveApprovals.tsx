'use client';

import { useCallback, useEffect, useState } from 'react';

import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { DataTable, type DataTableColumn } from '@/components/ui/DataTable';
import { Select } from '@/components/ui/Select';
import { LEAVE_STATUS_LABELS, type LeaveStatus } from '@/db/schema/leave-requests';
import { dayLabel } from '@/lib/leave-quota';
import { schoolErrorMessage, schoolFetch } from '@/lib/school-client';
import { ROLE_LABELS, type UserRole } from '@/types/school-auth';

/**
 * The approvals queue — the people who report to you, and nobody else.
 *
 * ── The list is drawn from the chain, not from a permission ──────────────
 * `leave.approve` says this person may decide leave; `lib/approval-chain.ts`
 * says whose. A coordinator sees the teachers assigned to them, a section head
 * their coordinators, a deputy and a head their campus. Somebody who is nobody's
 * approver sees an empty queue rather than the school's — which is the whole
 * difference between this screen and HR's.
 *
 * Every row carries the chain it travelled, so an approver can see *why* a
 * request reached them: a teacher under two coordinators skips that rung, and
 * the row says so instead of looking like a mistake.
 */

interface InboxRow {
  id: string;
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
  canDecide: boolean;
  chain: UserRole[];
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

export function LeaveApprovals() {
  const [rows, setRows] = useState<InboxRow[] | null>(null);
  const [statusFilter, setStatusFilter] = useState('pending');
  const [pending, setPending] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    // The status filter refetches, so the table shows its pending state on the
    // second load as well as the first.
    setPending(true);
    try {
      const query = statusFilter === '' ? '' : `&status=${statusFilter}`;
      const payload = await schoolFetch<{ rows: InboxRow[] }>(
        `/api/school/leave/requests?scope=inbox${query}`,
      );
      setRows(payload.rows);
      setError(null);
    } catch (caught) {
      setError(schoolErrorMessage(caught, 'Could not load the approvals queue.'));
    } finally {
      setPending(false);
    }
  }, [statusFilter]);

  useEffect(() => {
    void load();
  }, [load]);

  const decide = async (row: InboxRow, status: 'approved' | 'rejected'): Promise<void> => {
    let note = '';

    if (status === 'rejected') {
      // The refusal a person can read. `chat_grants.reason` carries the same
      // rule for the same reason: a decision nobody can be told the grounds for
      // is a decision the school cannot defend.
      const entered = window.prompt('Why is this being rejected? The staff member sees it.');
      if (entered === null || entered.trim() === '') return;
      note = entered.trim();
    }

    setBusy(row.id);
    setError(null);

    try {
      await schoolFetch(`/api/school/leave/requests/${row.id}/decision`, {
        method: 'POST',
        body: JSON.stringify({ status, decisionNote: note }),
      });
      await load();
    } catch (caught) {
      setError(schoolErrorMessage(caught, 'Could not record the decision.'));
    } finally {
      setBusy(null);
    }
  };

  const columns: Array<DataTableColumn<InboxRow>> = [
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
      cell: (row) => dayLabel(Number(row.totalDays)),
    },
    {
      id: 'chain',
      header: 'Approval chain',
      muted: true,
      sortValue: (row) => row.chain.join(),
      cell: (row) => (
        <span className="text-xs text-ink-muted">
          {row.chain.length === 0
            ? 'Nobody is set up to approve leave at their campus.'
            : row.chain.map((role) => ROLE_LABELS[role]).join(' → ')}
        </span>
      ),
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
    {
      id: 'decide',
      header: <span className="sr-only">Decide</span>,
      align: 'end',
      cell: (row) =>
        row.status === 'pending' && row.canDecide ? (
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
    },
  ];

  return (
    <div className="space-y-4">
      {error !== null ? (
        <p
          role="alert"
          className="rounded-lg bg-status-danger-subtle px-3 py-2 text-sm text-status-danger-ink"
        >
          {error}
        </p>
      ) : null}

      <DataTable
        caption="Leave awaiting your decision"
        columns={columns}
        rows={rows ?? []}
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
        itemNoun={{ singular: 'request', plural: 'requests' }}
        emptyTitle="Nothing is waiting on you"
        emptyDescription="Leave from the people who report to you appears here. If you expect somebody and they are missing, the reporting line under HR is where that is set."
        noResultTitle="No requests in that state"
        noResultDescription="Choose another state, or show every request."
      />
    </div>
  );
}
