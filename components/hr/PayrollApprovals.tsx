'use client';

import { useCallback, useEffect, useState } from 'react';

import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card, CardTitle } from '@/components/ui/Card';
import { Input } from '@/components/ui/Input';
import { Modal } from '@/components/ui/Modal';
import { formatPayrollPeriod } from '@/db/schema/payroll-runs';
import { formatPkr } from '@/lib/money';
import { schoolErrorMessage, schoolFetch } from '@/lib/school-client';

/**
 * The runs waiting on this head, and the slice of each that is theirs.
 *
 * ── What is on this screen, and what deliberately is not ─────────────────
 * A head sees the payslips they are answerable for — teachers and coordinators
 * at their campus, or in their grades — with gross, loss of pay and net. They
 * do not see the accountant's, the drivers' or the office's, because those are
 * not theirs to sign and showing them would make the screen a salary list
 * rather than an approval.
 *
 * ── Override asks for a reason and will not proceed without one ──────────
 * A waived deduction with no reason is a figure nobody can defend six months
 * later. The server refuses it too — this is the courtesy, that is the rule.
 */

interface AwaitingRun {
  runId: string;
  payrollMonth: number;
  payrollYear: number;
  netTotal: string;
  staffCount: number;
  approvalStatus: string;
}

interface SlicePayslip {
  id: string;
  staffName: string;
  employeeCode: string;
  grossEarnings: string;
  lossOfPayAmount: string;
  lossOfPayOverride: string | null;
  overrideReason: string | null;
  netPayable: string;
}

export interface PayrollApprovalsProps {
  runs: readonly AwaitingRun[];
  canApprove: boolean;
}

const STATUS_VARIANT: Record<string, 'success' | 'warning' | 'danger' | 'neutral'> = {
  pending: 'warning',
  approved: 'success',
  rejected: 'danger',
};

export function PayrollApprovals({ runs, canApprove }: PayrollApprovalsProps) {
  const [openRunId, setOpenRunId] = useState<string | null>(null);
  const [payslips, setPayslips] = useState<SlicePayslip[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async (runId: string) => {
    setPayslips(null);

    try {
      const payload = await schoolFetch<{ payslips: SlicePayslip[] }>(
        `/api/school/payroll/runs/${runId}`,
      );
      setPayslips(payload.payslips);
      setError(null);
    } catch (caught) {
      setPayslips([]);
      setError(schoolErrorMessage(caught, 'Could not read that run.'));
    }
  }, []);

  useEffect(() => {
    if (openRunId !== null) void load(openRunId);
  }, [openRunId, load]);

  const decide = async (
    runId: string,
    decision: 'approved' | 'rejected',
    note: string | null,
  ): Promise<void> => {
    setBusy(true);
    setError(null);

    try {
      const payload = await schoolFetch<{ runStatus: string; remaining?: number }>(
        `/api/school/payroll/runs/${runId}/approvals`,
        { method: 'POST', body: JSON.stringify({ decision, note }) },
      );

      setNotice(
        decision === 'rejected'
          ? 'Sent back to HR as a draft, with your reason.'
          : payload.runStatus === 'approved'
            ? 'Approved. That was the last signature — the run is approved.'
            : `Approved. ${String(payload.remaining ?? 0)} other head(s) still to sign.`,
      );

      setOpenRunId(null);
      setRejecting(null);
    } catch (caught) {
      setError(schoolErrorMessage(caught, 'Could not record your decision.'));
    } finally {
      setBusy(false);
    }
  };

  /* --------------------------------------------------------- the override */
  const [overriding, setOverriding] = useState<SlicePayslip | null>(null);
  const [overrideAmount, setOverrideAmount] = useState('0');
  const [overrideReason, setOverrideReason] = useState('');

  const saveOverride = async (): Promise<void> => {
    if (overriding === null || openRunId === null) return;

    setBusy(true);
    setError(null);

    try {
      await schoolFetch(`/api/school/payroll/payslips/${overriding.id}/override`, {
        method: 'PATCH',
        body: JSON.stringify({
          lossOfPayOverride: Number(overrideAmount),
          overrideReason,
        }),
      });

      setNotice(`${overriding.staffName}’s deduction changed.`);
      setOverriding(null);
      setOverrideReason('');
      await load(openRunId);
    } catch (caught) {
      setError(schoolErrorMessage(caught, 'Could not change that deduction.'));
    } finally {
      setBusy(false);
    }
  };

  /* -------------------------------------------------------- the rejection */
  const [rejecting, setRejecting] = useState<string | null>(null);
  const [rejectNote, setRejectNote] = useState('');

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

      {runs.length === 0 ? (
        <Card>
          <p className="text-sm text-ink-muted">
            Nothing is waiting on you. A payroll run reaches this screen when HR
            submits it for approval.
          </p>
        </Card>
      ) : (
        <ul className="space-y-3">
          {runs.map((run) => (
            <li key={run.runId}>
              <Card
                header={
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <CardTitle
                      title={formatPayrollPeriod(run.payrollMonth, run.payrollYear)}
                      description={`${String(run.staffCount)} staff you are responsible for · ${formatPkr(run.netTotal)} across the whole run`}
                    />
                    <Badge variant={STATUS_VARIANT[run.approvalStatus] ?? 'neutral'}>
                      {run.approvalStatus === 'pending'
                        ? 'Awaiting your signature'
                        : run.approvalStatus === 'approved'
                          ? 'You approved this'
                          : 'You sent this back'}
                    </Badge>
                  </div>
                }
              >
                <div className="flex flex-wrap gap-2">
                  <Button
                    variant="secondary"
                    onClick={() => {
                      setOpenRunId(run.runId);
                      setNotice(null);
                    }}
                  >
                    Open the payslips
                  </Button>

                  {canApprove && run.approvalStatus === 'pending' ? (
                    <>
                      <Button
                        disabled={busy}
                        onClick={() => {
                          void decide(run.runId, 'approved', null);
                        }}
                      >
                        Approve
                      </Button>
                      <Button
                        variant="danger"
                        disabled={busy}
                        onClick={() => {
                          setRejecting(run.runId);
                          setRejectNote('');
                        }}
                      >
                        Reject with a reason
                      </Button>
                    </>
                  ) : null}
                </div>
              </Card>
            </li>
          ))}
        </ul>
      )}

      <Modal
        open={openRunId !== null && overriding === null}
        title="The payslips on this run"
        description="Gross, what the register docked, and what is payable."
        onClose={() => {
          setOpenRunId(null);
        }}
      >
        {payslips === null ? (
          <p className="text-sm text-ink-muted">Reading the payslips…</p>
        ) : (
          <ul className="max-h-96 divide-y divide-line overflow-y-auto">
            {payslips.map((slip) => (
              <li key={slip.id} className="flex flex-wrap items-center justify-between gap-2 py-3">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-ink">{slip.staffName}</p>
                  <p className="font-mono text-xs text-ink-muted">
                    {slip.employeeCode} · {formatPkr(slip.grossEarnings)} gross
                  </p>
                  {/*
                    Both numbers, never one. A teacher asking why they were paid
                    more than the register implies is owed the figure the
                    attendance produced *and* the figure the head decided.
                  */}
                  <p className="text-xs text-ink-muted">
                    Loss of pay {formatPkr(slip.lossOfPayAmount)}
                    {slip.lossOfPayOverride === null
                      ? ''
                      : ` → ${formatPkr(slip.lossOfPayOverride)} (${slip.overrideReason ?? 'no reason recorded'})`}
                  </p>
                </div>

                <div className="flex items-center gap-3">
                  <span className="font-mono text-sm text-ink">
                    {formatPkr(slip.netPayable)}
                  </span>
                  {canApprove ? (
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() => {
                        setOverriding(slip);
                        setOverrideAmount(
                          slip.lossOfPayOverride ?? slip.lossOfPayAmount,
                        );
                        setOverrideReason(slip.overrideReason ?? '');
                      }}
                    >
                      Override deduction
                    </Button>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        )}
      </Modal>

      <Modal
        open={overriding !== null}
        title={overriding === null ? 'Override' : `${overriding.staffName}'s deduction`}
        description="The replacement amount, not a change to it. Zero waives the deduction entirely."
        onClose={() => {
          setOverriding(null);
        }}
      >
        <div className="space-y-4">
          <Input
            label="Loss of pay"
            type="number"
            min={0}
            value={overrideAmount}
            hint={
              overriding === null
                ? undefined
                : `The register produced ${formatPkr(overriding.lossOfPayAmount)}. That figure is kept either way.`
            }
            onChange={(event) => {
              setOverrideAmount(event.target.value);
            }}
          />

          <Input
            label="Why"
            value={overrideReason}
            hint="Required. A waived deduction with no reason is a figure nobody can defend."
            onChange={(event) => {
              setOverrideReason(event.target.value);
            }}
          />

          <div className="flex justify-end gap-2">
            <Button
              variant="secondary"
              disabled={busy}
              onClick={() => {
                setOverriding(null);
              }}
            >
              Cancel
            </Button>
            <Button
              isLoading={busy}
              disabled={overrideReason.trim() === ''}
              onClick={() => {
                void saveOverride();
              }}
            >
              Save
            </Button>
          </div>
        </div>
      </Modal>

      <Modal
        open={rejecting !== null}
        title="Send this run back"
        description="It returns to HR as a draft, and every head's signature is cleared — the next submission is a clean sheet."
        onClose={() => {
          setRejecting(null);
        }}
      >
        <div className="space-y-4">
          <Input
            label="Why"
            value={rejectNote}
            hint="Required. Whoever fixes this needs to know what to fix."
            onChange={(event) => {
              setRejectNote(event.target.value);
            }}
          />

          <div className="flex justify-end gap-2">
            <Button
              variant="secondary"
              disabled={busy}
              onClick={() => {
                setRejecting(null);
              }}
            >
              Cancel
            </Button>
            <Button
              variant="danger"
              isLoading={busy}
              disabled={rejectNote.trim() === ''}
              onClick={() => {
                if (rejecting !== null) void decide(rejecting, 'rejected', rejectNote);
              }}
            >
              Send it back
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
