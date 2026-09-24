'use client';

import Link from 'next/link';
import { useCallback, useState } from 'react';

import { INVOICE_BADGE } from '@/components/super-admin/invoice-badge';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card, CardTitle } from '@/components/ui/Card';
import { Input } from '@/components/ui/Input';
import { Modal } from '@/components/ui/Modal';
import { Select } from '@/components/ui/Select';
import { formatMoneyMinor } from '@/lib/money';
import {
  MAX_DISCOUNTS_PER_INVOICE,
  monthLabel,
  shortDate,
  type BillingCurrency,
  type InvoiceDisplayStatus,
  type InvoiceStatus,
} from '@/lib/platform-billing';
import { superAdminFetch, SuperAdminApiError } from '@/lib/super-admin-client';

/**
 * One platform invoice, and everything that can be done to it — §5.
 *
 * Draft: edit up to three discounts, download to read it, finalize.
 * Finalized: email it (to the remembered recipient by default, or anybody),
 * record money against it, download it again whenever.
 *
 * ── What the money section says ──────────────────────────────────────────
 * Total, Received, and — once anything has been received — "Balance carried to
 * next invoice" or simply Balance. Never "partial", "minimum" or a percentage
 * (E6): the chip says Paid when the server says it is paid, and the reason it
 * says so is not this screen's business.
 */

export interface InvoiceDetailData {
  id: string;
  invoiceNumber: string;
  school: { id: string; name: string; city: string; accessBlockedAt: string | null };
  periodStart: string;
  periodEnd: string;
  billedFrom: string;
  billableDays: number;
  daysInPeriod: number;
  billingCurrency: BillingCurrency;
  currency: BillingCurrency;
  conversionRate: string | null;
  subtotalMinor: number;
  discountTotalMinor: number;
  totalMinor: number;
  receivedMinor: number;
  balanceMinor: number;
  status: InvoiceStatus;
  displayStatus: InvoiceDisplayStatus;
  statusLabel: string;
  dueDate: string;
  finalizedAt: string | null;
  finalizedBy: string | null;
  carriedForwardTo: { id: string; invoiceNumber: string } | null;
  lines: { id: string; kind: string; description: string; quantity: number; unitRateMinor: number; amountMinor: number }[];
  discounts: {
    id: string;
    kind: 'percent' | 'fixed';
    percentBasisPoints: number | null;
    fixedMinor: number | null;
    amountMinor: number;
    description: string;
    position: number;
  }[];
  receipts: { id: string; amountMinor: number; transactionId: string; description: string | null; recordedBy: string; createdAt: string }[];
  emails: { id: string; to: string; status: string; error: string | null; sentBy: string; at: string }[];
  defaultRecipient: string | null;
}

export interface InvoiceBankAccount {
  id: string;
  bankName: string;
  accountTitle: string;
  accountNumber: string;
  iban: string;
  branchName: string | null;
  branchCode: string | null;
  city: string | null;
}

export interface InvoiceDetailPanelProps {
  initial: InvoiceDetailData;
  bankAccounts: InvoiceBankAccount[];
  canEdit: boolean;
  canRecord: boolean;
}

const DISCOUNT_KINDS = [
  { value: 'percent', label: 'Percentage of the subtotal' },
  { value: 'fixed', label: 'Fixed amount' },
];

export function InvoiceDetailPanel({ initial, bankAccounts, canEdit, canRecord }: InvoiceDetailPanelProps) {
  const [invoice, setInvoice] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const [discountKind, setDiscountKind] = useState<'percent' | 'fixed'>('percent');
  const [discountValue, setDiscountValue] = useState('');
  const [discountDescription, setDiscountDescription] = useState('');

  const [recipient, setRecipient] = useState(initial.defaultRecipient ?? '');

  const [receiptAmount, setReceiptAmount] = useState('');
  const [receiptTransaction, setReceiptTransaction] = useState('');
  const [receiptDescription, setReceiptDescription] = useState('');

  const [confirmFinalize, setConfirmFinalize] = useState(false);

  const money = (minor: number) => formatMoneyMinor(minor, invoice.currency);
  const isDraft = invoice.status === 'draft';
  const payable = invoice.status === 'finalized' || invoice.status === 'paid';

  const run = useCallback(
    async <T,>(key: string, action: () => Promise<T>, success: (result: T) => string) => {
      setBusy(key);
      setError(null);
      setNotice(null);
      try {
        const result = await action();
        setNotice(success(result));
        return result;
      } catch (caught) {
        setError(caught instanceof SuperAdminApiError ? caught.message : 'That did not work.');
        return null;
      } finally {
        setBusy(null);
      }
    },
    [],
  );

  const base = `/api/super-admin/billing/invoices/${invoice.id}`;

  const addDiscount = async () => {
    const result = await run(
      'discount',
      () =>
        superAdminFetch<{ invoice: InvoiceDetailData }>(`${base}/discounts`, {
          method: 'POST',
          body: JSON.stringify({
            kind: discountKind,
            value: discountValue,
            description: discountDescription,
          }),
        }),
      () => 'Discount added.',
    );
    if (result !== null) {
      setInvoice(result.invoice);
      setDiscountValue('');
      setDiscountDescription('');
    }
  };

  const removeDiscount = async (discountId: string) => {
    const result = await run(
      `remove-${discountId}`,
      () =>
        superAdminFetch<{ invoice: InvoiceDetailData }>(`${base}/discounts/${discountId}`, {
          method: 'DELETE',
        }),
      () => 'Discount removed.',
    );
    if (result !== null) setInvoice(result.invoice);
  };

  const finalize = async () => {
    const result = await run(
      'finalize',
      () => superAdminFetch<{ invoice: InvoiceDetailData }>(`${base}/finalize`, { method: 'POST' }),
      () => 'Invoice finalized. It can now be emailed and paid.',
    );
    setConfirmFinalize(false);
    if (result !== null) setInvoice(result.invoice);
  };

  const sendEmail = async () => {
    const result = await run(
      'email',
      () =>
        superAdminFetch<{ sentTo: string; invoice: InvoiceDetailData }>(`${base}/email`, {
          method: 'POST',
          body: JSON.stringify({ to: recipient }),
        }),
      (sent) => `Sent to ${sent.sentTo}. That address is now the default for this school.`,
    );
    if (result !== null) setInvoice(result.invoice);
  };

  const recordReceipt = async () => {
    const result = await run(
      'receipt',
      () =>
        superAdminFetch<{ unblocked: boolean; invoice: InvoiceDetailData }>(`${base}/receipts`, {
          method: 'POST',
          body: JSON.stringify({
            amount: receiptAmount,
            transactionId: receiptTransaction,
            description: receiptDescription,
          }),
        }),
      (outcome) =>
        outcome.unblocked
          ? 'Receipt recorded. The school has been unblocked and its administrator emailed.'
          : 'Receipt recorded.',
    );
    if (result !== null) {
      setInvoice(result.invoice);
      setReceiptAmount('');
      setReceiptTransaction('');
      setReceiptDescription('');
    }
  };

  return (
    <div className="space-y-6">
      {error !== null ? (
        <p role="alert" className="rounded-lg bg-status-danger-subtle px-3 py-2 text-sm text-status-danger-ink">
          {error}
        </p>
      ) : null}
      {notice !== null ? (
        <p role="status" className="rounded-lg bg-status-success-subtle px-3 py-2 text-sm text-status-success-ink">
          {notice}
        </p>
      ) : null}

      <Card
        header={
          <CardTitle
            title={`${monthLabel(invoice.periodStart)} · ${invoice.school.name}`}
            description={`Due ${shortDate(invoice.dueDate)}${
              invoice.billableDays === invoice.daysInPeriod
                ? ''
                : ` · billed ${shortDate(invoice.billedFrom)} to ${shortDate(invoice.periodEnd)}, ${String(invoice.billableDays)} of ${String(invoice.daysInPeriod)} days`
            }`}
            action={<Badge variant={INVOICE_BADGE[invoice.displayStatus]}>{invoice.statusLabel}</Badge>}
          />
        }
      >
        <div className="space-y-4">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-2xs uppercase tracking-wide text-ink-muted">
                <th className="py-2 font-semibold">Description</th>
                <th className="py-2 text-right font-semibold">Qty</th>
                <th className="py-2 text-right font-semibold">Rate</th>
                <th className="py-2 text-right font-semibold">Amount</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {invoice.lines.length === 0 ? (
                <tr>
                  <td colSpan={4} className="py-3 text-ink-muted">
                    Nothing billable — no rates were set for this school.
                  </td>
                </tr>
              ) : (
                invoice.lines.map((line) => (
                  <tr key={line.id}>
                    <td className="py-2 text-ink">{line.description}</td>
                    <td className="py-2 text-right font-mono tabular-nums">
                      {line.kind === 'carry_forward' ? '' : line.quantity}
                    </td>
                    <td className="py-2 text-right font-mono tabular-nums">
                      {line.kind === 'carry_forward'
                        ? ''
                        : formatMoneyMinor(line.unitRateMinor, invoice.billingCurrency)}
                    </td>
                    <td className="py-2 text-right font-mono tabular-nums">{money(line.amountMinor)}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>

          {invoice.conversionRate !== null && invoice.billingCurrency !== invoice.currency ? (
            <p className="text-xs text-ink-muted">
              Rates in {invoice.billingCurrency}, converted to {invoice.currency} at {invoice.conversionRate}{' '}
              PKR per USD.
            </p>
          ) : null}

          <dl className="ml-auto max-w-sm space-y-1 text-sm">
            <div className="flex justify-between">
              <dt className="text-ink-muted">Subtotal</dt>
              <dd className="font-mono tabular-nums">{money(invoice.subtotalMinor)}</dd>
            </div>
            {invoice.discounts.map((discount) => (
              <div key={discount.id} className="flex justify-between gap-3">
                <dt className="text-ink-muted">
                  {discount.description}
                  {discount.kind === 'percent' && discount.percentBasisPoints !== null
                    ? ` (${String(discount.percentBasisPoints / 100)}%)`
                    : ''}
                </dt>
                <dd className="font-mono tabular-nums">−{money(discount.amountMinor)}</dd>
              </div>
            ))}
            <div className="flex justify-between border-t border-line pt-1 font-semibold">
              <dt>Total</dt>
              <dd className="font-mono tabular-nums">{money(invoice.totalMinor)}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-ink-muted">Received</dt>
              <dd className="font-mono tabular-nums">{money(invoice.receivedMinor)}</dd>
            </div>
            {invoice.balanceMinor > 0 && invoice.receivedMinor > 0 ? (
              <div className="flex justify-between">
                <dt className="text-ink-muted">Balance carried to next invoice</dt>
                <dd className="font-mono tabular-nums">{money(invoice.balanceMinor)}</dd>
              </div>
            ) : (
              <div className="flex justify-between">
                <dt className="text-ink-muted">Balance</dt>
                <dd className="font-mono tabular-nums">{money(invoice.balanceMinor)}</dd>
              </div>
            )}
          </dl>

          {invoice.carriedForwardTo !== null ? (
            <p className="text-sm text-ink-muted">
              The balance was carried to{' '}
              <Link
                href={`/super-admin/billing/invoices/${invoice.carriedForwardTo.id}`}
                className="font-mono text-brand-primary hover:underline"
              >
                {invoice.carriedForwardTo.invoiceNumber}
              </Link>
              .
            </p>
          ) : null}

          <div className="flex flex-wrap gap-2 border-t border-line pt-4">
            <a href={`${base}/pdf`}>
              <Button variant="secondary">Download PDF</Button>
            </a>
            {isDraft && canEdit ? (
              <Button
                isLoading={busy === 'finalize'}
                onClick={() => {
                  setConfirmFinalize(true);
                }}
              >
                Finalize
              </Button>
            ) : null}
          </div>
        </div>
      </Card>

      {isDraft && canEdit ? (
        <Card
          header={
            <CardTitle
              title="Discounts"
              description={`Up to ${String(MAX_DISCOUNTS_PER_INVOICE)}. A percentage is of the subtotal before any discount.`}
            />
          }
        >
          <div className="space-y-4">
            {invoice.discounts.length > 0 ? (
              <ul className="divide-y divide-line text-sm">
                {invoice.discounts.map((discount) => (
                  <li key={discount.id} className="flex items-center justify-between gap-3 py-2">
                    <span>
                      {discount.description} ·{' '}
                      {discount.kind === 'percent' && discount.percentBasisPoints !== null
                        ? `${String(discount.percentBasisPoints / 100)}%`
                        : money(discount.fixedMinor ?? 0)}
                    </span>
                    <Button
                      variant="ghost"
                      size="sm"
                      isLoading={busy === `remove-${discount.id}`}
                      onClick={() => void removeDiscount(discount.id)}
                    >
                      Remove
                    </Button>
                  </li>
                ))}
              </ul>
            ) : null}

            {invoice.discounts.length < MAX_DISCOUNTS_PER_INVOICE ? (
              <div className="grid gap-3 md:grid-cols-4">
                <Select
                  label="Kind"
                  options={DISCOUNT_KINDS}
                  value={discountKind}
                  onChange={(event) => {
                    setDiscountKind(event.target.value === 'fixed' ? 'fixed' : 'percent');
                  }}
                />
                <Input
                  label={discountKind === 'percent' ? 'Percent' : `Amount (${invoice.currency})`}
                  inputMode="decimal"
                  value={discountValue}
                  onChange={(event) => {
                    setDiscountValue(event.target.value);
                  }}
                />
                <Input
                  label="Description"
                  value={discountDescription}
                  placeholder="e.g. Launch offer"
                  onChange={(event) => {
                    setDiscountDescription(event.target.value);
                  }}
                />
                <div className="flex items-end">
                  <Button
                    variant="secondary"
                    isLoading={busy === 'discount'}
                    disabled={discountValue.trim() === '' || discountDescription.trim() === ''}
                    onClick={() => void addDiscount()}
                  >
                    Add discount
                  </Button>
                </div>
              </div>
            ) : (
              <p className="text-sm text-ink-muted">This invoice already carries the maximum of three.</p>
            )}
          </div>
        </Card>
      ) : null}

      {!isDraft && canEdit ? (
        <Card header={<CardTitle title="Email" description="Sends the PDF now. The address used becomes this school’s default." />}>
          <div className="flex flex-wrap items-end gap-3">
            <div className="min-w-[16rem] flex-1">
              <Input
                label="Send to"
                type="email"
                value={recipient}
                onChange={(event) => {
                  setRecipient(event.target.value);
                }}
              />
            </div>
            <Button
              isLoading={busy === 'email'}
              disabled={recipient.trim() === ''}
              onClick={() => void sendEmail()}
            >
              Email invoice
            </Button>
          </div>
        </Card>
      ) : null}

      <Card header={<CardTitle title="Receipts" />}>
        <div className="space-y-4">
          {invoice.receipts.length === 0 ? (
            <p className="text-sm text-ink-muted">Nothing received yet.</p>
          ) : (
            <ul className="divide-y divide-line text-sm">
              {invoice.receipts.map((receipt) => (
                <li key={receipt.id} className="flex flex-wrap items-center justify-between gap-3 py-2">
                  <span>
                    <span className="font-mono">{receipt.transactionId}</span>
                    {receipt.description === null ? '' : ` · ${receipt.description}`}
                    <span className="block text-xs text-ink-muted">
                      {new Date(receipt.createdAt).toLocaleString('en-GB')} · {receipt.recordedBy}
                    </span>
                  </span>
                  <span className="font-mono tabular-nums">{money(receipt.amountMinor)}</span>
                </li>
              ))}
            </ul>
          )}

          {payable && canRecord && invoice.balanceMinor > 0 ? (
            <div className="grid gap-3 border-t border-line pt-4 md:grid-cols-4">
              <Input
                label={`Amount (${invoice.currency})`}
                inputMode="decimal"
                value={receiptAmount}
                onChange={(event) => {
                  setReceiptAmount(event.target.value);
                }}
              />
              <Input
                label="Transaction ID"
                value={receiptTransaction}
                onChange={(event) => {
                  setReceiptTransaction(event.target.value);
                }}
              />
              <Input
                label="Description (optional)"
                value={receiptDescription}
                onChange={(event) => {
                  setReceiptDescription(event.target.value);
                }}
              />
              <div className="flex items-end">
                <Button
                  isLoading={busy === 'receipt'}
                  disabled={receiptAmount.trim() === '' || receiptTransaction.trim() === ''}
                  onClick={() => void recordReceipt()}
                >
                  Record receipt
                </Button>
              </div>
            </div>
          ) : null}
        </div>
      </Card>

      {invoice.emails.length > 0 ? (
        <Card header={<CardTitle title="Send log" />}>
          <ul className="divide-y divide-line text-sm">
            {invoice.emails.map((email) => (
              <li key={email.id} className="flex flex-wrap items-center justify-between gap-3 py-2">
                <span>
                  {email.to}
                  <span className="block text-xs text-ink-muted">
                    {new Date(email.at).toLocaleString('en-GB')} · {email.sentBy}
                    {email.error === null ? '' : ` · ${email.error}`}
                  </span>
                </span>
                <Badge variant={email.status === 'sent' ? 'success' : 'danger'}>
                  {email.status === 'sent' ? 'Sent' : 'Failed'}
                </Badge>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}

      <Card header={<CardTitle title="Pay to" description="Printed on every invoice." />}>
        {bankAccounts.length === 0 ? (
          <p className="text-sm text-ink-muted">
            No bank accounts yet.{' '}
            <Link href="/super-admin/billing/bank-accounts" className="text-brand-primary hover:underline">
              Add one
            </Link>{' '}
            before sending invoices.
          </p>
        ) : (
          <div className="grid gap-4 md:grid-cols-3">
            {bankAccounts.map((account) => (
              <div key={account.id} className="rounded-card border border-line p-3 text-sm">
                <p className="font-semibold text-ink">{account.bankName}</p>
                <p className="text-ink-muted">{account.accountTitle}</p>
                <p className="mt-1 font-mono text-xs">{account.accountNumber}</p>
                <p className="font-mono text-xs">{account.iban}</p>
              </div>
            ))}
          </div>
        )}
      </Card>

      <Modal
        open={confirmFinalize}
        onClose={() => {
          setConfirmFinalize(false);
        }}
        title={`Finalize ${invoice.invoiceNumber}?`}
        description={`It cannot be edited afterwards. It falls due on ${shortDate(invoice.dueDate)}.`}
        footer={
          <>
            <Button
              variant="secondary"
              onClick={() => {
                setConfirmFinalize(false);
              }}
            >
              Cancel
            </Button>
            <Button isLoading={busy === 'finalize'} onClick={() => void finalize()}>
              Finalize
            </Button>
          </>
        }
      >
        <p className="text-sm text-ink-muted">
          Total {money(invoice.totalMinor)}. Once finalized it can be emailed, and money can be
          recorded against it.
        </p>
      </Modal>
    </div>
  );
}
