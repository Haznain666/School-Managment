'use client';

import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';

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
import { formatPkr, parsePaise } from '@/lib/money';
import { schoolErrorMessage, schoolFetch } from '@/lib/school-client';

/**
 * Recording a payment.
 *
 * Pre-filled with the full outstanding balance because that is what most
 * families pay, but editable down for an instalment. It cannot be edited *up*:
 * the server refuses more than the balance, since this module has no way to
 * issue a refund or carry a credit, and a balance nothing can spend is worse
 * than a rejected entry.
 */

export interface RecordPaymentFormProps {
  challanId: string;
  challanNumber: string;
  studentName: string;
  totalPaise: number;
  paidPaise: number;
  balancePaise: number;
}

const METHOD_OPTIONS = PAYMENT_METHODS.map((value) => ({
  value,
  label: PAYMENT_METHOD_LABELS[value],
}));

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

/** Paise -> the plain `1234.50` string the amount field starts with. */
function toInputValue(paise: number): string {
  return (paise / 100).toFixed(2);
}

export function RecordPaymentForm({
  challanId,
  challanNumber,
  studentName,
  totalPaise,
  paidPaise,
  balancePaise,
}: RecordPaymentFormProps) {
  const router = useRouter();

  const [amount, setAmount] = useState(toInputValue(balancePaise));
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('cash');
  const [referenceNumber, setReferenceNumber] = useState('');
  const [paymentDate, setPaymentDate] = useState(todayIso());
  const [notes, setNotes] = useState('');

  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const enteredPaise = parsePaise(amount);
  const isPartial = enteredPaise !== null && enteredPaise < balancePaise;

  const submit = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();

    if (enteredPaise === null || enteredPaise <= 0) {
      setError('Enter the amount received, e.g. 5000 or 5000.50.');
      return;
    }

    if (enteredPaise > balancePaise) {
      setError(
        `That is more than the outstanding balance of PKR ${formatPkr(balancePaise)}.`,
      );
      return;
    }

    setIsSubmitting(true);
    setError(null);

    try {
      await schoolFetch(`/api/school/fees/challans/${challanId}/payments`, {
        method: 'POST',
        body: JSON.stringify({
          amount,
          paymentMethod,
          referenceNumber,
          paymentDate,
          notes,
        }),
      });

      router.push(`/dashboard/fees/challans/${challanId}`);
      router.refresh();
    } catch (caught) {
      setError(schoolErrorMessage(caught, 'Could not record the payment.'));
      setIsSubmitting(false);
    }
  };

  return (
    <form
      onSubmit={(event) => {
        void submit(event);
      }}
      className="space-y-6"
      noValidate
    >
      <Card header={<CardTitle title="Challan" />}>
        <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-4">
          <Detail label="Challan" value={challanNumber} mono />
          <Detail label="Student" value={studentName} />
          <Detail label="Total" value={`PKR ${formatPkr(totalPaise)}`} />
          <Detail label="Already paid" value={`PKR ${formatPkr(paidPaise)}`} />
        </dl>
        <p className="mt-4 rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-700">
          Outstanding balance:{' '}
          <strong className="text-slate-900">PKR {formatPkr(balancePaise)}</strong>
        </p>
      </Card>

      <Card header={<CardTitle title="Payment received" />}>
        <div className="grid gap-4 sm:grid-cols-2">
          <Input
            label="Amount (PKR)"
            required
            inputMode="decimal"
            value={amount}
            disabled={isSubmitting}
            hint={
              isPartial
                ? 'Less than the balance — this will be recorded as a partial payment.'
                : 'Defaults to the full outstanding balance.'
            }
            onChange={(event) => {
              setAmount(event.target.value);
            }}
          />

          <Select
            label="Method"
            options={METHOD_OPTIONS}
            value={paymentMethod}
            disabled={isSubmitting}
            onChange={(event) => {
              setPaymentMethod(event.target.value as PaymentMethod);
            }}
          />

          <Input
            label="Reference number"
            value={referenceNumber}
            disabled={isSubmitting}
            hint={
              paymentMethod === 'cash'
                ? 'Optional for cash.'
                : 'Cheque number or transfer reference — strongly recommended.'
            }
            onChange={(event) => {
              setReferenceNumber(event.target.value);
            }}
          />

          <Input
            label="Payment date"
            type="date"
            value={paymentDate}
            disabled={isSubmitting}
            onChange={(event) => {
              setPaymentDate(event.target.value);
            }}
          />

          <div className="sm:col-span-2">
            <Textarea
              label="Notes"
              value={notes}
              disabled={isSubmitting}
              onChange={(event) => {
                setNotes(event.target.value);
              }}
            />
          </div>
        </div>

        <p className="mt-4 text-sm text-slate-500">
          The guardian gets a WhatsApp confirmation once this is recorded. If that
          message cannot be sent the payment is still saved — it is never held up
          by the messaging service.
        </p>
      </Card>

      {error !== null ? (
        <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </p>
      ) : null}

      <div className="flex gap-3">
        <Button type="submit" isLoading={isSubmitting}>
          Record payment
        </Button>
        <Button
          type="button"
          variant="secondary"
          disabled={isSubmitting}
          onClick={() => {
            router.back();
          }}
        >
          Cancel
        </Button>
      </div>
    </form>
  );
}

function Detail({
  label,
  value,
  mono = false,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div>
      <dt className="text-xs font-medium uppercase tracking-wide text-slate-500">
        {label}
      </dt>
      <dd className={`mt-0.5 text-sm text-slate-900${mono ? ' font-mono' : ''}`}>
        {value}
      </dd>
    </div>
  );
}
