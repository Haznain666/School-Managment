'use client';

import { useCallback, useEffect, useState } from 'react';

import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card, CardTitle } from '@/components/ui/Card';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { formatPayrollPeriod } from '@/db/schema/payroll-runs';
import {
  PAYMENT_MODE_LABELS,
  PAYMENT_MODES,
  PAYSLIP_STATUS_LABELS,
  type PaymentMode,
  type PayslipStatus,
} from '@/db/schema/payslips';
import { amountInWords, formatPkr } from '@/lib/money';
import { schoolErrorMessage, schoolFetch } from '@/lib/school-client';

/**
 * One payslip: the printable slip, and the form that records how it was paid.
 *
 * The net figure is printed in words as well as digits, for the same reason a
 * challan is — that is what makes a slip usable at a bank counter, and what
 * stops a `12,000` becoming a `1,20,000` between the school office and the
 * teller. `amountInWords` uses the South Asian scale, so it reads lakh, not
 * million.
 *
 * Nothing on the slip is editable. A payslip is a snapshot of what was
 * computed; a school that could revise the net after the fact would have no
 * record of what it actually owed.
 */

interface PayslipItem {
  id: string;
  description: string;
  kind: string;
  amount: string;
  sortOrder: number;
}

interface PayslipDetail {
  id: string;
  payslipNumber: string;
  staffName: string;
  employeeCode: string;
  designation: string | null;
  bankAccountTitle: string | null;
  bankAccountNumber: string | null;
  bankName: string | null;
  grossEarnings: string;
  totalDeductions: string;
  lossOfPayDays: string;
  lossOfPayAmount: string;
  netPayable: string;
  status: PayslipStatus;
  paymentMode: PaymentMode | null;
  paidOn: string | null;
  paymentReference: string | null;
  notes: string | null;
  payrollMonth: number;
  payrollYear: number;
  workingDays: number;
  runStatus: string;
  schoolName: string;
  schoolCity: string;
  branchName: string | null;
  items: PayslipItem[];
}

export interface PayslipViewProps {
  payslipId: string;
  canEdit: boolean;
}

const MODE_OPTIONS = [
  { value: '', label: 'Not recorded' },
  ...PAYMENT_MODES.map((value) => ({ value, label: PAYMENT_MODE_LABELS[value] })),
];

export function PayslipView({ payslipId, canEdit }: PayslipViewProps) {
  const [payslip, setPayslip] = useState<PayslipDetail | null>(null);
  const [mode, setMode] = useState('');
  const [paidOn, setPaidOn] = useState('');
  const [reference, setReference] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const payload = await schoolFetch<{ payslip: PayslipDetail }>(
        `/api/school/payroll/payslips/${payslipId}`,
      );
      setPayslip(payload.payslip);
      setMode(payload.payslip.paymentMode ?? '');
      setPaidOn(payload.payslip.paidOn ?? '');
      setReference(payload.payslip.paymentReference ?? '');
      setError(null);
    } catch (caught) {
      setError(schoolErrorMessage(caught, 'Could not load this payslip.'));
    }
  }, [payslipId]);

  useEffect(() => {
    void load();
  }, [load]);

  const markPaid = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    setNotice(null);

    try {
      await schoolFetch(`/api/school/payroll/payslips/${payslipId}`, {
        method: 'PATCH',
        body: JSON.stringify({
          status: 'paid',
          paymentMode: mode === '' ? null : mode,
          paidOn: paidOn === '' ? null : paidOn,
          paymentReference: reference.trim(),
        }),
      });
      setNotice('Payment recorded.');
      await load();
    } catch (caught) {
      setError(schoolErrorMessage(caught, 'Could not record the payment.'));
    } finally {
      setBusy(false);
    }
  };

  if (payslip === null) {
    return (
      <Card>
        <p className="text-sm text-ink-muted">{error ?? 'Loading payslip…'}</p>
      </Card>
    );
  }

  const earnings = payslip.items.filter((item) => item.kind === 'earning');
  const deductions = payslip.items.filter((item) => item.kind === 'deduction');

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

      <div className="flex flex-wrap items-center justify-between gap-3 print:hidden">
        <Badge variant={payslip.status === 'paid' ? 'success' : 'neutral'}>
          {PAYSLIP_STATUS_LABELS[payslip.status]}
        </Badge>
        <Button
          variant="secondary"
          onClick={() => {
            window.print();
          }}
        >
          Print payslip
        </Button>
      </div>

      <Card className="print:border-0 print:shadow-none">
        <header className="border-b border-line pb-4 text-center">
          <h2 className="text-lg font-semibold text-ink">{payslip.schoolName}</h2>
          <p className="text-sm text-ink-muted">
            {payslip.branchName ?? payslip.schoolCity}
          </p>
          <p className="mt-2 text-sm font-medium text-ink">
            Salary slip — {formatPayrollPeriod(payslip.payrollMonth, payslip.payrollYear)}
          </p>
          <p className="font-mono text-xs text-ink-muted">{payslip.payslipNumber}</p>
        </header>

        <dl className="grid gap-3 border-b border-line py-4 text-sm sm:grid-cols-2">
          <div>
            <dt className="text-xs uppercase tracking-wide text-ink-muted">Name</dt>
            <dd className="font-medium text-ink">{payslip.staffName}</dd>
          </div>
          <div>
            <dt className="text-xs uppercase tracking-wide text-ink-muted">
              Employee code
            </dt>
            <dd className="text-ink">{payslip.employeeCode}</dd>
          </div>
          <div>
            <dt className="text-xs uppercase tracking-wide text-ink-muted">
              Designation
            </dt>
            <dd className="text-ink">{payslip.designation ?? '—'}</dd>
          </div>
          <div>
            <dt className="text-xs uppercase tracking-wide text-ink-muted">
              Working days
            </dt>
            <dd className="text-ink">{payslip.workingDays}</dd>
          </div>
          {payslip.bankAccountNumber === null ? null : (
            <div className="sm:col-span-2">
              <dt className="text-xs uppercase tracking-wide text-ink-muted">Bank</dt>
              <dd className="text-ink">
                {payslip.bankAccountTitle ?? payslip.staffName} ·{' '}
                {payslip.bankAccountNumber}
                {payslip.bankName === null ? '' : ` · ${payslip.bankName}`}
              </dd>
            </div>
          )}
        </dl>

        <div className="grid gap-6 py-4 sm:grid-cols-2">
          <section>
            <h3 className="text-sm font-semibold text-ink">Earnings</h3>
            <ul className="mt-2 space-y-1 text-sm">
              {earnings.map((item) => (
                <li key={item.id} className="flex justify-between gap-4">
                  <span className="text-ink-muted">{item.description}</span>
                  <span className="text-ink">{formatPkr(item.amount)}</span>
                </li>
              ))}
              <li className="flex justify-between gap-4 border-t border-line pt-1 font-medium">
                <span className="text-ink">Gross</span>
                <span className="text-ink">
                  {formatPkr(payslip.grossEarnings)}
                </span>
              </li>
            </ul>
          </section>

          <section>
            <h3 className="text-sm font-semibold text-ink">Deductions</h3>
            {deductions.length === 0 ? (
              <p className="mt-2 text-sm text-ink-muted">None.</p>
            ) : (
              <ul className="mt-2 space-y-1 text-sm">
                {deductions.map((item) => (
                  <li key={item.id} className="flex justify-between gap-4">
                    <span className="text-ink-muted">{item.description}</span>
                    <span className="text-ink">{formatPkr(item.amount)}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>

        <footer className="border-t border-line pt-4">
          <div className="flex flex-wrap items-baseline justify-between gap-4">
            <span className="text-sm font-medium text-ink">Net payable</span>
            <span className="text-2xl font-semibold text-ink">
              {formatPkr(payslip.netPayable)}
            </span>
          </div>
          <p className="mt-1 text-sm text-ink-muted">
            {amountInWords(payslip.netPayable)}
          </p>

          {Number.parseFloat(payslip.lossOfPayDays) > 0 ? (
            <p className="mt-2 text-sm text-status-warning-onSubtle">
              {payslip.lossOfPayDays} unpaid day
              {Number.parseFloat(payslip.lossOfPayDays) === 1 ? '' : 's'} were
              deducted, worth {formatPkr(payslip.lossOfPayAmount)}.
            </p>
          ) : null}
        </footer>
      </Card>

      {canEdit && payslip.status !== 'paid' ? (
        <Card
          header={
            <CardTitle
              title="Record payment"
              description={
                payslip.runStatus === 'draft'
                  ? 'Approve the payroll run before recording payments against it.'
                  : 'How this salary actually left the school.'
              }
            />
          }
          className="print:hidden"
        >
          <div className="grid gap-4 sm:grid-cols-3">
            <Select
              label="Method"
              options={MODE_OPTIONS}
              value={mode}
              disabled={payslip.runStatus === 'draft'}
              onChange={(event) => {
                setMode(event.target.value);
              }}
            />
            <Input
              label="Paid on"
              type="date"
              value={paidOn}
              disabled={payslip.runStatus === 'draft'}
              onChange={(event) => {
                setPaidOn(event.target.value);
              }}
            />
            <Input
              label="Reference"
              value={reference}
              placeholder="Transfer or cheque number"
              disabled={payslip.runStatus === 'draft'}
              onChange={(event) => {
                setReference(event.target.value);
              }}
            />
          </div>

          <div className="mt-4">
            <Button
              isLoading={busy}
              disabled={payslip.runStatus === 'draft'}
              onClick={() => {
                void markPaid();
              }}
            >
              Mark paid
            </Button>
          </div>
        </Card>
      ) : null}
    </div>
  );
}
