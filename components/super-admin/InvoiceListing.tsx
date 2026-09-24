'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';

import { INVOICE_BADGE } from '@/components/super-admin/invoice-badge';
import { Badge } from '@/components/ui/Badge';
import { Card } from '@/components/ui/Card';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import {
  Table,
  TableBody,
  TableCell,
  TableEmptyRow,
  TableHead,
  TableHeaderCell,
  TableRow,
} from '@/components/ui/Table';
import { formatMoneyMinor } from '@/lib/money';
import {
  INVOICE_DISPLAY_LABELS,
  monthLabel,
  shortDate,
  type BillingCurrency,
  type InvoiceDisplayStatus,
} from '@/lib/platform-billing';
import { superAdminFetch } from '@/lib/super-admin-client';

/**
 * Every platform invoice, filtered by school, status and month — §5.
 *
 * The status filter offers exactly the five chips the spec names. There is no
 * "partial" and no "minimum paid" (E6): an invoice with money against it is
 * Paid or it is not, and what was received is a column, not a state.
 */

interface InvoiceRow {
  id: string;
  invoiceNumber: string;
  periodStart: string;
  currency: BillingCurrency;
  totalMinor: number;
  receivedMinor: number;
  status: InvoiceDisplayStatus;
  statusLabel: string;
  dueDate: string;
  schoolId: string;
  schoolName: string;
}

export interface InvoiceListingProps {
  schools: readonly { id: string; name: string }[];
}

const STATUS_OPTIONS = (Object.keys(INVOICE_DISPLAY_LABELS) as InvoiceDisplayStatus[]).map(
  (status) => ({ value: status, label: INVOICE_DISPLAY_LABELS[status] }),
);

export function InvoiceListing({ schools }: InvoiceListingProps) {
  const [schoolId, setSchoolId] = useState('');
  const [status, setStatus] = useState('');
  const [month, setMonth] = useState('');
  const [rows, setRows] = useState<InvoiceRow[] | null>(null);
  const [pending, setPending] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    const query = new URLSearchParams();
    if (schoolId !== '') query.set('schoolId', schoolId);
    if (status !== '') query.set('status', status);
    if (/^\d{4}-\d{2}$/.test(month)) query.set('month', month);

    setPending(true);
    void superAdminFetch<{ invoices: InvoiceRow[] }>(
      `/api/super-admin/billing/invoices?${query.toString()}`,
      { signal: controller.signal },
    )
      .then((data) => {
        setRows(data.invoices);
        setError(null);
      })
      .catch((caught: unknown) => {
        if (caught instanceof DOMException && caught.name === 'AbortError') return;
        setError('Could not load invoices.');
      })
      .finally(() => {
        if (!controller.signal.aborted) setPending(false);
      });

    return () => {
      controller.abort();
    };
  }, [schoolId, status, month]);

  return (
    <div className="space-y-4">
      <Card>
        <div className="grid gap-4 md:grid-cols-3">
          <Select
            label="School"
            options={[{ value: '', label: 'Every school' }, ...schools.map((school) => ({ value: school.id, label: school.name }))]}
            value={schoolId}
            onChange={(event) => {
              setSchoolId(event.target.value);
            }}
          />
          <Select
            label="Status"
            options={[{ value: '', label: 'Every status' }, ...STATUS_OPTIONS]}
            value={status}
            onChange={(event) => {
              setStatus(event.target.value);
            }}
          />
          <Input
            label="Billed month"
            type="month"
            value={month}
            onChange={(event) => {
              setMonth(event.target.value);
            }}
          />
        </div>
      </Card>

      {error !== null ? (
        <p role="alert" className="rounded-lg bg-status-danger-subtle px-3 py-2 text-sm text-status-danger-ink">
          {error}
        </p>
      ) : null}

      <Table
        caption="Platform invoices"
        aria-busy={pending}
        className={pending ? 'opacity-60 transition-opacity' : 'transition-opacity'}
      >
          <TableHead>
            <TableRow>
              <TableHeaderCell>Invoice</TableHeaderCell>
              <TableHeaderCell>School</TableHeaderCell>
              <TableHeaderCell>Month</TableHeaderCell>
              <TableHeaderCell align="numeric">Total</TableHeaderCell>
              <TableHeaderCell align="numeric">Received</TableHeaderCell>
              <TableHeaderCell>Due</TableHeaderCell>
              <TableHeaderCell>Status</TableHeaderCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {rows === null || rows.length === 0 ? (
              <TableEmptyRow colSpan={7}>
                <p className="py-6 text-center text-sm text-ink-muted">
                  {rows === null ? 'Loading invoices…' : 'No invoices match those filters.'}
                </p>
              </TableEmptyRow>
            ) : (
              rows.map((row) => (
                <TableRow key={row.id}>
                  <TableCell>
                    <Link
                      href={`/super-admin/billing/invoices/${row.id}`}
                      className="font-mono text-sm font-medium text-brand-primary hover:underline"
                    >
                      {row.invoiceNumber}
                    </Link>
                  </TableCell>
                  <TableCell>{row.schoolName}</TableCell>
                  <TableCell muted>{monthLabel(row.periodStart)}</TableCell>
                  <TableCell align="numeric">{formatMoneyMinor(row.totalMinor, row.currency)}</TableCell>
                  <TableCell align="numeric">{formatMoneyMinor(row.receivedMinor, row.currency)}</TableCell>
                  <TableCell muted>{shortDate(row.dueDate)}</TableCell>
                  <TableCell>
                    <Badge variant={INVOICE_BADGE[row.status]}>{row.statusLabel}</Badge>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
      </Table>
    </div>
  );
}
