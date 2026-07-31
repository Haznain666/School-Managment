'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { Button } from '@/components/ui/Button';
import { Card, CardTitle } from '@/components/ui/Card';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { Textarea } from '@/components/ui/Textarea';
import {
  PAYMENT_METHODS,
  PAYMENT_METHOD_LABELS,
  type PaymentMethod,
} from '@/db/schema/fee-payments';
import { formatPkr } from '@/lib/money';
import { schoolErrorMessage, schoolFetch } from '@/lib/school-client';

/**
 * Recording money received against a challan.
 *
 * The amount is pre-filled with the full remaining balance because that is what
 * usually happens, and left editable because partial payment is common enough
 * that forcing it into two steps would be a lie about how schools collect.
 *
 * The client-side check below is a courtesy. The server reads the balance from
 * the database and refuses an overpayment there — this form cannot be the thing
 * that guarantees it, and does not pretend to be.
 */

export interface RecordPaymentFormProps {
  challanId: string;
  challanNumber: string;
  studentName: string;
  /** PKR still owed, as a string from the server. */
  balance: string;
  totalAmount: string;
  paidAmount: string;
}

const METHOD_OPTIONS = PAYMENT_METHODS.map((value) => ({
  value,
  label: PAYMENT_METHOD_LABELS[value],
}));

export function RecordPaymentForm({
  challanId,
  challanNumber,
  studentName,
  balance,
  totalAmount,
  paidAmount,
}: RecordPaymentFormProps) {
  const router = useRouter();

  const [amount, setAmount] = useState(String(Number(balance)));
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('cash');
  const [referenceNumber, setReferenceNumber] = useState('');
  const [paymentDate, setPaymentDate] = useState(new Date().toISOString().slice(0, 10));
  const [notes, setNotes] = useState('');

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const parsedAmount = Number(amount);
  const overBalance = Number.isFinite(parsedAmount) && parsedAmount > Number(balance);
  const isPartial =
    Number.isFinite(parsedAmount) && parsedAmount > 0 && parsedAmount < Number(balance);

  const submit = async (): Promise<void> => {
    if (!Number.isFinite(parsedAmount) || parsedAmount <= 0) {
      setError('Enter an amount greater than zero.');
      return;
    }

    setSaving(true);
    setError(null);

    try {
      await schoolFetch(`/api/school/fees/challans/${challanId}/payments`, {
        method: 'POST',
        body: JSON.stringify({
          amount: parsedAmount,
          paymentMethod,
          referenceNumber: referenceNumber.trim(),
          paymentDate,
          notes: notes.trim(),
        }),
      });

      router.push(`/dashboard/fees/challans/${challanId}`);
      router.refresh();
    } catch (caught) {
      setError(schoolErrorMessage(caught, 'Could not record the payment.'));
      setSaving(false);
    }
  };

  return (
    <div className="space-y-4">
      <Card>
        <div className="grid gap-4 sm:grid-cols-3">
          <Summary label="Billed" value={formatPkr(totalAmount)} />
          <Summary label="Already paid" value={formatPkr(paidAmount)} />
          <Summary label="Remaining balance" value={formatPkr(balance)} emphasis />
        </div>
      </Card>

      <Card
        header={
          <CardTitle
            title="Record a payment"
            description={`Against ${challanNumber} for ${studentName}.`}
          />
        }
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <Input
            label="Amount received (PKR)"
            type="number"
            min={0}
            step="0.01"
            value={amount}
            error={overBalance ? `Only ${formatPkr(balance)} is still owed.` : undefined}
            hint={isPartial ? 'This will be recorded as a partial payment.' : undefined}
            onChange={(event) => {
              setAmount(event.target.value);
            }}
          />

          <Select
            label="Payment method"
            options={METHOD_OPTIONS}
            value={paymentMethod}
            onChange={(event) => {
              setPaymentMethod(event.target.value as PaymentMethod);
            }}
          />

          <Input
            label="Reference number"
            value={referenceNumber}
            placeholder={
              paymentMethod === 'cheque'
                ? 'Cheque number'
                : paymentMethod === 'bank_transfer'
                  ? 'Transaction ID or deposit slip'
                  : 'Receipt number (optional)'
            }
            onChange={(event) => {
              setReferenceNumber(event.target.value);
            }}
          />

          <Input
            label="Payment date"
            type="date"
            value={paymentDate}
            onChange={(event) => {
              setPaymentDate(event.target.value);
            }}
          />

          <div className="sm:col-span-2">
            <Textarea
              label="Notes"
              rows={2}
              value={notes}
              onChange={(event) => {
                setNotes(event.target.value);
              }}
            />
          </div>
        </div>

        {error !== null ? (
          <p role="alert" className="mt-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
            {error}
          </p>
        ) : null}

        <div className="mt-4 flex gap-3">
          <Button
            isLoading={saving}
            disabled={overBalance}
            onClick={() => {
              void submit();
            }}
          >
            Record payment
          </Button>
          <Button
            variant="ghost"
            onClick={() => {
              router.push(`/dashboard/fees/challans/${challanId}`);
            }}
          >
            Cancel
          </Button>
        </div>

        <p className="mt-3 text-xs text-slate-500">
          The guardian is sent a WhatsApp confirmation once this is saved. If that
          message fails, the payment is still recorded.
        </p>
      </Card>
    </div>
  );
}

function Summary({
  label,
  value,
  emphasis = false,
}: {
  label: string;
  value: string;
  emphasis?: boolean;
}) {
  return (
    <div>
      <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
        {label}
      </p>
      <p
        className={
          emphasis
            ? 'mt-1 text-2xl font-bold text-slate-900'
            : 'mt-1 text-lg font-semibold text-slate-700'
        }
      >
        {value}
      </p>
    </div>
  );
}
