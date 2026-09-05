'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';

import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card, CardTitle } from '@/components/ui/Card';
import { DataTable, type DataTableColumn } from '@/components/ui/DataTable';
import {
  PAYROLL_RUN_STATUS_LABELS,
  canTransitionRun,
  formatPayrollPeriod,
  type PayrollRunStatus,
} from '@/db/schema/payroll-runs';
import { PAYSLIP_STATUS_LABELS, type PayslipStatus } from '@/db/schema/payslips';
import { formatPkr } from '@/lib/money';
import { schoolErrorMessage, schoolFetch } from '@/lib/school-client';

/**
 * One payroll run and the payslips in it.
 *
 * The three actions available depend on where the run is: a draft can be
 * recomputed or approved, an approved run can be marked paid, and a paid run
 * is read-only. `canTransitionRun` is the same function the API enforces with,
 * so the buttons on screen cannot offer a move the server will refuse.
 */

interface RunDetail {
  id: string;
  branchName: string | null;
  payrollMonth: number;
  payrollYear: number;
  status: PayrollRunStatus;
  workingDays: number;
  staffCount: number;
  grossTotal: string;
  deductionTotal: string;
  netTotal: string;
  notes: string | null;
}

interface PayslipRow {
  id: string;
  payslipNumber: string;
  staffName: string;
  employeeCode: string;
  designation: string | null;
  grossEarnings: string;
  totalDeductions: string;
  lossOfPayDays: string;
  netPayable: string;
  status: PayslipStatus;
}

/** One head's signature over their slice of the run. */
interface ApprovalRow {
  id: string;
  principalName: string;
  status: string;
  staffCount: number;
  note: string | null;
}

export interface PayrollRunDetailProps {
  runId: string;
  canEdit: boolean;
}

const RUN_VARIANT: Record<PayrollRunStatus, 'success' | 'warning' | 'danger' | 'neutral'> = {
  draft: 'warning',
  // Awaiting a head's signature reads as the same kind of "not finished yet"
  // as a draft does, because to whoever is looking at the list it is.
  pending_approval: 'warning',
  approved: 'neutral',
  paid: 'success',
  cancelled: 'danger',
};

const SLIP_VARIANT: Record<PayslipStatus, 'success' | 'warning' | 'neutral'> = {
  paid: 'success',
  held: 'warning',
  unpaid: 'neutral',
};

export function PayrollRunDetail({ runId, canEdit }: PayrollRunDetailProps) {
  const [run, setRun] = useState<RunDetail | null>(null);
  const [payslips, setPayslips] = useState<PayslipRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [approvals, setApprovals] = useState<ApprovalRow[]>([]);
  const [uncovered, setUncovered] = useState<Array<{ staffName: string }>>([]);

  const load = useCallback(async () => {
    try {
      const payload = await schoolFetch<{ run: RunDetail; payslips: PayslipRow[] }>(
        `/api/school/payroll/runs/${runId}`,
      );
      setRun(payload.run);
      setPayslips(payload.payslips);
      setError(null);

      /*
       * The approvals, in a second request rather than folded into the first.
       *
       * `resolveRunApprovers` walks the timetable and every live principal
       * assignment, and a draft run does not need any of that work — this
       * screen is opened far more often to look at payslips than to look at
       * signatures. Failing quietly is right for the same reason: a payroll run
       * that would not render because its approvals could not be read would be
       * a screen broken by a panel nobody asked for.
       */
      try {
        const approvalPayload = await schoolFetch<{
          approvals: ApprovalRow[];
          uncovered: Array<{ staffName: string }>;
        }>(`/api/school/payroll/runs/${runId}/approvals`);

        setApprovals(approvalPayload.approvals);
        setUncovered(approvalPayload.uncovered);
      } catch {
        setApprovals([]);
        setUncovered([]);
      }
    } catch (caught) {
      setError(schoolErrorMessage(caught, 'Could not load this payroll run.'));
    }
  }, [runId]);

  useEffect(() => {
    void load();
  }, [load]);

  const move = async (status: PayrollRunStatus): Promise<void> => {
    setBusy(status);
    setError(null);
    setNotice(null);

    try {
      await schoolFetch(`/api/school/payroll/runs/${runId}`, {
        method: 'PATCH',
        body: JSON.stringify({ status }),
      });
      setNotice(`Run marked ${PAYROLL_RUN_STATUS_LABELS[status].toLowerCase()}.`);
      await load();
    } catch (caught) {
      setError(schoolErrorMessage(caught, 'Could not update the run.'));
    } finally {
      setBusy(null);
    }
  };

  const regenerate = async (): Promise<void> => {
    setBusy('regenerate');
    setError(null);
    setNotice(null);

    try {
      const payload = await schoolFetch<{ staffCount: number }>(
        `/api/school/payroll/runs/${runId}`,
        { method: 'PATCH', body: JSON.stringify({ regenerate: true }) },
      );
      setNotice(`Recomputed ${payload.staffCount} payslips.`);
      await load();
    } catch (caught) {
      setError(schoolErrorMessage(caught, 'Could not recompute the run.'));
    } finally {
      setBusy(null);
    }
  };

  if (run === null) {
    return (
      <Card>
        <p className="text-sm text-ink-muted">{error ?? 'Loading payroll run…'}</p>
      </Card>
    );
  }

  const payslipColumns: Array<DataTableColumn<PayslipRow>> = [
    {
      id: 'number',
      header: 'Number',
      muted: true,
      className: 'font-mono text-xs',
      sortValue: (row) => row.payslipNumber,
      searchValue: (row) => row.payslipNumber,
      cell: (row) => row.payslipNumber,
    },
    {
      id: 'staff',
      header: 'Staff',
      sortValue: (row) => row.staffName,
      searchValue: (row) =>
        `${row.staffName} ${row.employeeCode} ${row.designation ?? ''}`,
      cell: (row) => (
        <>
          <p className="font-medium text-ink">{row.staffName}</p>
          <p className="text-xs text-ink-muted">
            {row.employeeCode}
            {row.designation === null ? '' : ` · ${row.designation}`}
          </p>
        </>
      ),
    },
    {
      id: 'gross',
      header: 'Gross',
      kind: 'money',
      muted: true,
      sortValue: (row) => Number(row.grossEarnings),
      cell: (row) => formatPkr(row.grossEarnings),
    },
    {
      id: 'deductions',
      header: 'Deductions',
      kind: 'money',
      muted: true,
      sortValue: (row) => Number(row.totalDeductions),
      cell: (row) => formatPkr(row.totalDeductions),
    },
    {
      id: 'lop',
      header: 'LOP',
      kind: 'number',
      muted: true,
      sortValue: (row) => Number(row.lossOfPayDays),
      cell: (row) => row.lossOfPayDays,
    },
    {
      id: 'net',
      header: 'Net',
      kind: 'money',
      rowHeader: true,
      sortValue: (row) => Number(row.netPayable),
      cell: (row) => formatPkr(row.netPayable),
    },
    {
      id: 'status',
      header: 'Status',
      sortValue: (row) => PAYSLIP_STATUS_LABELS[row.status],
      cell: (row) => (
        <Badge variant={SLIP_VARIANT[row.status]}>
          {PAYSLIP_STATUS_LABELS[row.status]}
        </Badge>
      ),
    },
    {
      id: 'open',
      header: <span className="sr-only">Open</span>,
      align: 'numeric',
      cell: (row) => (
        <Link
          href={`/dashboard/payroll/payslips/${row.id}`}
          className="text-sm font-medium text-brand-primary hover:underline"
        >
          Open
        </Link>
      ),
    },
  ];

  return (
    <div className="space-y-4">
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
            title={formatPayrollPeriod(run.payrollMonth, run.payrollYear)}
            description={`${run.branchName ?? 'Whole school'} · ${run.staffCount} staff · ${run.workingDays} working days`}
            action={
              <Badge variant={RUN_VARIANT[run.status]}>
                {PAYROLL_RUN_STATUS_LABELS[run.status]}
              </Badge>
            }
          />
        }
        footer={
          canEdit ? (
            <div className="flex flex-wrap gap-3">
              {run.status === 'draft' ? (
                <Button
                  variant="secondary"
                  isLoading={busy === 'regenerate'}
                  onClick={() => {
                    void regenerate();
                  }}
                >
                  Recompute
                </Button>
              ) : null}

              {/*
                Sprint 27, item C5. Submitting is the ordinary path now: the
                heads answerable for the run's teachers and coordinators sign
                their own slice, and the run advances when every one is signed.

                A school with no principal at all is answered by the route, not
                here — `resolveRunApprovers` finds nobody, and the run goes
                straight to `approved` exactly as it did before this sprint.
                That is why the direct Approve below is still offered: it is the
                path for a school that has never appointed a head, and refusing
                it would freeze a working school's payroll.
              */}
              {canTransitionRun(run.status, 'pending_approval') ? (
                <Button
                  isLoading={busy === 'pending_approval'}
                  onClick={() => {
                    void move('pending_approval');
                  }}
                >
                  Submit for approval
                </Button>
              ) : null}

              {canTransitionRun(run.status, 'approved') ? (
                <Button
                  variant={run.status === 'draft' ? 'secondary' : 'primary'}
                  isLoading={busy === 'approved'}
                  onClick={() => {
                    void move('approved');
                  }}
                >
                  Approve
                </Button>
              ) : null}

              {canTransitionRun(run.status, 'paid') ? (
                <Button
                  isLoading={busy === 'paid'}
                  onClick={() => {
                    void move('paid');
                  }}
                >
                  Mark paid
                </Button>
              ) : null}

              {canTransitionRun(run.status, 'cancelled') ? (
                <Button
                  variant="ghost"
                  isLoading={busy === 'cancelled'}
                  onClick={() => {
                    void move('cancelled');
                  }}
                >
                  Cancel run
                </Button>
              ) : null}
            </div>
          ) : undefined
        }
      >
        <dl className="grid gap-4 sm:grid-cols-3">
          <div>
            <dt className="text-xs uppercase tracking-wide text-ink-muted">
              Gross earnings
            </dt>
            <dd className="text-lg font-semibold text-ink">
              {formatPkr(run.grossTotal)}
            </dd>
          </div>
          <div>
            <dt className="text-xs uppercase tracking-wide text-ink-muted">
              Deductions, including loss of pay
            </dt>
            <dd className="text-lg font-semibold text-ink">
              {formatPkr(run.deductionTotal)}
            </dd>
          </div>
          <div>
            <dt className="text-xs uppercase tracking-wide text-ink-muted">
              Net payable
            </dt>
            <dd className="text-lg font-semibold text-ink">
              {formatPkr(run.netTotal)}
            </dd>
          </div>
        </dl>

        {run.status === 'draft' ? (
          <p className="mt-4 text-sm text-ink-muted">
            This run is still a draft, so it can be recomputed after fixing a
            salary structure or correcting the register. Once approved it is
            fixed.
          </p>
        ) : null}
      </Card>

      {/*
        Who has signed, and who has not — Sprint 27, item C5.

        Shown from the moment the run is submitted and kept afterwards: "the
        Senior School head signed on the 3rd" is the question an approved run is
        asked about, not only a pending one. Hidden on a draft, where there is
        nothing to say yet.
      */}
      {run.status === 'draft' || approvals.length === 0 ? null : (
        <Card
          header={
            <CardTitle
              title="Approvals"
              description="Each head signs the teachers and coordinators they are responsible for. The run advances when every one is signed."
            />
          }
        >
          <ul className="divide-y divide-line">
            {approvals.map((row) => (
              <li
                key={row.id}
                className="flex flex-wrap items-center justify-between gap-2 py-3"
              >
                <div className="min-w-0">
                  <p className="text-sm font-medium text-ink">{row.principalName}</p>
                  <p className="text-xs text-ink-muted">
                    {row.staffCount} staff
                    {row.note === null ? '' : ` · ${row.note}`}
                  </p>
                </div>

                <Badge
                  variant={
                    row.status === 'approved'
                      ? 'success'
                      : row.status === 'rejected'
                        ? 'danger'
                        : 'warning'
                  }
                >
                  {row.status === 'approved'
                    ? 'Approved'
                    : row.status === 'rejected'
                      ? 'Sent back'
                      : 'Awaiting'}
                </Badge>
              </li>
            ))}
          </ul>

          {/*
            Somebody nobody covers is named rather than hidden. Silently
            blocking a run because a principal assignment is missing is a
            payroll nobody can run and no screen explaining why — and the person
            reading this holds `payroll.write`, so they can sign that slice
            themselves once they know it exists.
          */}
          {uncovered.length === 0 ? null : (
            <p className="mt-4 rounded-lg bg-status-warning-subtle px-3 py-2 text-sm text-status-warning-onSubtle">
              No principal assignment reaches{' '}
              {uncovered.map((row) => row.staffName).join(', ')}. Their payslips
              are in the run and nobody is being asked to sign for them — add a
              campus or a grade to an assignment, or approve the run yourself.
            </p>
          )}
        </Card>
      )}

      <Card
        header={<CardTitle title="Payslips" description={`${payslips.length} slips.`} />}
      >
        <DataTable
          caption="Payslips in this run"
          columns={payslipColumns}
          rows={payslips}
          getRowKey={(row) => row.id}
          defaultSort={{ columnId: 'staff', direction: 'asc' }}
          search={{ placeholder: 'Name, code or payslip number' }}
          filters={[
            {
              id: 'status',
              label: 'Status',
              allLabel: 'Every payslip',
              options: Object.entries(PAYSLIP_STATUS_LABELS).map(([value, label]) => ({
                value,
                label,
              })),
              rowValue: (row) => row.status,
            },
            {
              id: 'lop',
              label: 'Loss of pay',
              allLabel: 'Everyone',
              options: [
                { value: 'docked', label: 'Docked' },
                { value: 'clean', label: 'Full month' },
              ],
              rowValue: (row) => (Number(row.lossOfPayDays) > 0 ? 'docked' : 'clean'),
            },
          ]}
          itemNoun={{ singular: 'payslip', plural: 'payslips' }}
          emptyTitle="This run has no payslips"
          emptyDescription="Nobody active had a salary structure when it was raised."
          noResultTitle="No payslips match those filters"
          noResultDescription="Clear the search or widen the status."
        />
      </Card>
    </div>
  );
}
