'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';

import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { DataTable, type DataTableColumn } from '@/components/ui/DataTable';
import { Input } from '@/components/ui/Input';
import { Modal } from '@/components/ui/Modal';
import { Select } from '@/components/ui/Select';
import { PAYMENT_METHODS, PAYMENT_METHOD_LABELS } from '@/db/schema/fee-payments';
import { challanPrintHref } from '@/lib/challan-print';
import { formatMonthYear } from '@/lib/dates';
import { formatAmount, formatPkr, paiseToNumeric, toPaise } from '@/lib/money';
import { formatPhoneForDisplay } from '@/lib/phone-formats';
import { schoolErrorMessage, schoolFetch } from '@/lib/school-client';

/**
 * The family vouchers a school has issued, with the two things done to them.
 *
 * ── Why this is its own component ────────────────────────────────────────
 * It lives in two places: on the Vouchers register, as the *Family vouchers*
 * tab, which is where somebody looking for a voucher goes; and under the
 * wizard on `/dashboard/fees/family`, which is where one was just created. The
 * alternative was the register linking away to another screen, and a school
 * that has just issued a voucher and wants to take the money for it should not
 * have to know which of two pages it is filed under.
 *
 * ── Payment goes to the family route, not to the payments route ──────────
 * `POST /api/school/family-challans/[id]` spreads one payment across the
 * children's own vouchers — evenly, capped at what each owes — and writes a
 * `fee_payments` row against each of them. That distribution is the entire
 * point of the feature: the child vouchers are what the fee reports and the
 * defaulters list read, and a family payment that only moved the voucher's own
 * `paid_amount` would leave three children reported as defaulters by a system
 * holding their money.
 */

export interface IssuedFamilyVoucher {
  id: string;
  challanNumber: string;
  guardianName: string;
  phone: string;
  billingMonth: number | null;
  billingYear: number | null;
  dueDate: string;
  totalAmount: string;
  paidAmount: string;
  status: string;
  memberCount: number;
  memberChallanIds: string[];
}

export interface FamilyVoucherRegisterProps {
  canWrite: boolean;
  /** Bumped by a caller that has just issued one, to force a reload. */
  reloadToken?: number;
}

export function FamilyVoucherRegister({
  canWrite,
  reloadToken = 0,
}: FamilyVoucherRegisterProps) {
  const [vouchers, setVouchers] = useState<IssuedFamilyVoucher[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [paying, setPaying] = useState<IssuedFamilyVoucher | null>(null);
  const [amount, setAmount] = useState('');
  const [method, setMethod] = useState<string>('cash');
  const [reference, setReference] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const payload = await schoolFetch<{ challans: IssuedFamilyVoucher[] }>(
        '/api/school/family-challans',
      );
      setVouchers(payload.challans);
      setError(null);
    } catch (caught) {
      setError(schoolErrorMessage(caught, 'Could not read the family vouchers.'));
      setVouchers([]);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load, reloadToken]);

  const pay = async (voucher: IssuedFamilyVoucher): Promise<void> => {
    setBusy(true);
    setError(null);
    setNotice(null);

    try {
      const result = await schoolFetch<{
        result: { distributed: Array<{ amount: string }> };
      }>(`/api/school/family-challans/${voucher.id}`, {
        method: 'POST',
        body: JSON.stringify({
          amount: Number(amount),
          paymentMethod: method,
          reference: reference.trim() === '' ? undefined : reference.trim(),
        }),
      });

      const across = result.result.distributed.length;
      setNotice(
        `${formatPkr(amount)} recorded against ${voucher.challanNumber}, spread evenly ` +
          `across ${String(across)} child${across === 1 ? '' : 'ren'}’s vouchers.`,
      );
      setPaying(null);
      setReference('');
      await load();
    } catch (caught) {
      setError(schoolErrorMessage(caught, 'Could not record that payment.'));
    } finally {
      setBusy(false);
    }
  };

  const columns: Array<DataTableColumn<IssuedFamilyVoucher>> = [
    {
      id: 'voucher',
      header: 'Voucher',
      className: 'font-mono text-xs',
      sortValue: (row) => row.challanNumber,
      searchValue: (row) => row.challanNumber,
      cell: (row) => row.challanNumber,
    },
    {
      id: 'family',
      header: 'Family',
      rowHeader: true,
      sortValue: (row) => row.guardianName,
      searchValue: (row) => `${row.guardianName} ${row.phone}`,
      cell: (row) => (
        <>
          {row.guardianName}
          <span className="block font-mono text-xs font-normal text-ink-muted">
            {formatPhoneForDisplay(row.phone)}
          </span>
        </>
      ),
    },
    {
      id: 'children',
      header: 'Children',
      kind: 'number',
      muted: true,
      sortValue: (row) => row.memberCount,
      cell: (row) => row.memberCount,
    },
    {
      id: 'period',
      header: 'Period',
      muted: true,
      sortValue: (row) => `${String(row.billingYear ?? 0)}-${String(row.billingMonth ?? 0)}`,
      cell: (row) => formatMonthYear(row.billingMonth, row.billingYear),
    },
    {
      id: 'due',
      header: 'Due',
      kind: 'date',
      muted: true,
      className: 'font-mono text-xs',
      sortValue: (row) => row.dueDate,
      cell: (row) => row.dueDate,
    },
    {
      id: 'status',
      header: 'Status',
      sortValue: (row) => row.status,
      cell: (row) => (
        <Badge
          variant={
            row.status === 'paid'
              ? 'success'
              : row.status === 'cancelled'
                ? 'neutral'
                : row.status === 'partial'
                  ? 'warning'
                  : 'danger'
          }
        >
          {row.status}
        </Badge>
      ),
    },
    {
      id: 'total',
      header: 'Total',
      kind: 'money',
      className: 'font-mono',
      // Sorted on what is still owed rather than on the label, which is
      // sometimes "paid / billed" and would sort as text.
      sortValue: (row) => toPaise(row.totalAmount) - toPaise(row.paidAmount),
      cell: (row) =>
        toPaise(row.paidAmount) === 0
          ? formatAmount(row.totalAmount)
          : `${formatAmount(row.paidAmount)} / ${formatAmount(row.totalAmount)}`,
    },
    {
      id: 'actions',
      header: 'Actions',
      align: 'end',
      cell: (row) => (
        <div className="flex flex-nowrap justify-end gap-2">
          {/*
            Prints the children's own vouchers. There is no separate family
            document: the slip a parent carries to a bank counter is the child's,
            and the family voucher is the number the payment lands against.
          */}
          {row.memberChallanIds.length === 0 ? null : (
            <Link href={challanPrintHref(row.memberChallanIds)}>
              <Button size="sm" variant="ghost">
                Print
              </Button>
            </Link>
          )}

          {canWrite && row.status !== 'paid' && row.status !== 'cancelled' ? (
            <Button
              size="sm"
              variant="secondary"
              onClick={() => {
                setError(null);
                setNotice(null);
                setMethod('cash');
                // Pre-filled with what is still owed: paying in full is the
                // ordinary case and retyping the figure is how a digit is lost.
                setAmount(
                  paiseToNumeric(toPaise(row.totalAmount) - toPaise(row.paidAmount)),
                );
                setPaying(row);
              }}
            >
              Record payment
            </Button>
          ) : null}
        </div>
      ),
    },
  ];

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

      <DataTable
        caption="Family vouchers"
        columns={columns}
        rows={vouchers ?? []}
        getRowKey={(row) => row.id}
        pending={vouchers === null}
        defaultSort={{ columnId: 'due', direction: 'desc' }}
        search={{ placeholder: 'Voucher number, family or phone' }}
        filters={[
          {
            id: 'status',
            label: 'Status',
            allLabel: 'Every voucher',
            options: [
              { value: 'unpaid', label: 'Unpaid' },
              { value: 'partial', label: 'Part paid' },
              { value: 'paid', label: 'Paid' },
              { value: 'cancelled', label: 'Cancelled' },
            ],
            rowValue: (row) => row.status,
          },
        ]}
        itemNoun={{ singular: 'voucher', plural: 'vouchers' }}
        emptyTitle="No family vouchers issued yet"
        emptyDescription="Club a family's vouchers together and the result appears here."
        noResultTitle="No vouchers match those filters"
        noResultDescription="Clear the search or choose another status."
      />

      <Modal
        open={paying !== null}
        title="Record a family payment"
        description="Spread evenly across the children who still owe, capped at what each of them owes."
        onClose={() => {
          if (!busy) setPaying(null);
        }}
        footer={
          <>
            <Button
              variant="secondary"
              disabled={busy}
              onClick={() => {
                setPaying(null);
              }}
            >
              Cancel
            </Button>
            <Button
              isLoading={busy}
              disabled={toPaise(amount) <= 0}
              onClick={() => {
                if (paying !== null) void pay(paying);
              }}
            >
              Record payment
            </Button>
          </>
        }
      >
        {paying === null ? null : (
          <div className="space-y-4">
            <p className="text-sm text-ink-muted">
              {paying.challanNumber} · {paying.guardianName} ·{' '}
              {paying.memberCount} children ·{' '}
              {formatPkr(toPaise(paying.totalAmount) - toPaise(paying.paidAmount))} still
              owed.
            </p>

            <Input
              label="Amount received"
              inputMode="decimal"
              value={amount}
              disabled={busy}
              onChange={(event) => {
                setAmount(event.target.value);
              }}
            />

            <Select
              label="How the money arrived"
              options={PAYMENT_METHODS.map((value) => ({
                value,
                label: PAYMENT_METHOD_LABELS[value],
              }))}
              value={method}
              disabled={busy}
              onChange={(event) => {
                setMethod(event.target.value);
              }}
            />

            <Input
              label="Reference"
              placeholder="Slip or cheque number"
              value={reference}
              disabled={busy}
              onChange={(event) => {
                setReference(event.target.value);
              }}
            />
          </div>
        )}
      </Modal>
    </div>
  );
}
