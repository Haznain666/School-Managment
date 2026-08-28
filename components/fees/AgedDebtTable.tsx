'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { DataTable, type DataTableColumn } from '@/components/ui/DataTable';
import { Input } from '@/components/ui/Input';
import { Modal } from '@/components/ui/Modal';
import { Select } from '@/components/ui/Select';
import { PAYMENT_METHODS, PAYMENT_METHOD_LABELS } from '@/db/schema/fee-payments';
import { formatDateOnly } from '@/lib/dates';
import { AGING_BUCKETS, BUCKET_LABELS, type AgingBucket } from '@/lib/aging-buckets';
import { formatAmount, formatPkr, toPaise } from '@/lib/money';
import { formatPhoneForDisplay } from '@/lib/phone-formats';
import { schoolErrorMessage, schoolFetch } from '@/lib/school-client';

/**
 * Aged debt, as a table somebody can actually work down.
 *
 * ── Why the rows arrive whole instead of a page at a time ────────────────
 * `listDefaulters` already folds every open voucher in the school into one row
 * per student, in this process, and says why in its own docblock: the grouping
 * is per student across five buckets *and* carries the guardian, and a school's
 * open vouchers are hundreds of rows rather than millions. Given that, the
 * server has already paid for all of them — so `DataTable` runs in client mode
 * and sorting a column costs nothing rather than a round trip.
 *
 * ── The two quick actions, and the rule each of them obeys ───────────────
 * **Send reminder** posts this student's open voucher ids to the reminders
 * route, which queues the emails and records one `fee_challan_reminders` row
 * per voucher. The chips on the row are that record read back.
 *
 * **Mark as paid** records a real payment against each open voucher through
 * `POST /api/school/fees/challans/[id]/payments` — one request per voucher,
 * each in its own transaction with its own ledger posting. It deliberately does
 * **not** update a status directly: CLAUDE.md's accounting rule is that
 * everything which moves money posts to the ledger in the same transaction as
 * the record of it, and a status flipped to `paid` without a posting
 * understates the school's income in a way nothing on any screen would ever
 * report.
 *
 * It also asks *how* the money arrived, which looks like friction and is not.
 * The method decides which account the money lands in — a cheque is not cash
 * and a school that counts it as bank balance will overdraw on one that bounces
 * — so a "mark as paid" that guessed would be posting to the wrong account
 * every time somebody paid by transfer.
 */

export interface AgedDebtRow {
  studentProfileId: string;
  studentName: string;
  studentNumber: string;
  gradeName: string;
  sectionName: string;
  branchName: string;
  guardianName: string | null;
  guardianPhone: string | null;
  guardianEmail: string | null;
  reachable: boolean;
  openChallans: number;
  oldestDueDate: string;
  daysOverdue: number;
  bucket: AgingBucket;
  outstanding: string;
  openVouchers: Array<{ challanId: string; challanNumber: string; balance: string }>;
  reminders: Array<{ sequence: number; sentAt: string }>;
}

export interface AgedDebtTableProps {
  rows: readonly AgedDebtRow[];
  /** `fees.write`. Both quick actions are hidden without it and refused with it absent. */
  canCollect: boolean;
}

type Busy = { studentProfileId: string; action: 'remind' | 'pay' } | null;

export function AgedDebtTable({ rows, canCollect }: AgedDebtTableProps) {
  const router = useRouter();

  const [busy, setBusy] = useState<Busy>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [minimum, setMinimum] = useState('');

  /** The row whose "mark as paid" is being confirmed. */
  const [settling, setSettling] = useState<AgedDebtRow | null>(null);
  const [method, setMethod] = useState<string>('cash');

  const minimumPaise = toPaise(minimum);
  const visible =
    minimum.trim() === '' || minimumPaise <= 0
      ? rows
      : rows.filter((row) => toPaise(row.outstanding) >= minimumPaise);

  const sendReminder = async (row: AgedDebtRow): Promise<void> => {
    setBusy({ studentProfileId: row.studentProfileId, action: 'remind' });
    setError(null);
    setNotice(null);

    try {
      const result = await schoolFetch<{ queued: number; unreachable: number }>(
        '/api/school/fees/reminders',
        {
          method: 'POST',
          body: JSON.stringify({
            challanIds: row.openVouchers.map((voucher) => voucher.challanId),
          }),
        },
      );

      setNotice(
        result.queued === 0
          ? `Nothing was sent for ${row.studentName} — there is no email address on file.`
          : `${result.queued} reminder${result.queued === 1 ? '' : 's'} queued for ${row.studentName}.`,
      );
      router.refresh();
    } catch (caught) {
      setError(schoolErrorMessage(caught, 'The reminder could not be sent.'));
    } finally {
      setBusy(null);
    }
  };

  const markPaid = async (row: AgedDebtRow): Promise<void> => {
    setBusy({ studentProfileId: row.studentProfileId, action: 'pay' });
    setError(null);
    setNotice(null);

    let settled = 0;

    try {
      /*
       * One request per voucher, in order, and never `Promise.all`.
       *
       * Each one is a transaction that posts to the ledger and increments the
       * voucher's paid amount in SQL. Firing five at once against the same
       * school buys nothing at this size and makes a partial failure harder to
       * explain than "three of five went through".
       */
      for (const voucher of row.openVouchers) {
        await schoolFetch(`/api/school/fees/challans/${voucher.challanId}/payments`, {
          method: 'POST',
          body: JSON.stringify({ amount: Number(voucher.balance), paymentMethod: method }),
        });
        settled += 1;
      }

      setNotice(
        `${row.studentName}: ${settled} voucher${settled === 1 ? '' : 's'} settled.`,
      );
      setSettling(null);
      router.refresh();
    } catch (caught) {
      setError(
        `${schoolErrorMessage(caught, 'The payment could not be recorded.')}${
          settled === 0 ? '' : ` ${String(settled)} of the vouchers were settled before it failed.`
        }`,
      );
    } finally {
      setBusy(null);
    }
  };

  const columns: Array<DataTableColumn<AgedDebtRow>> = [
    {
      id: 'student',
      header: 'Student',
      rowHeader: true,
      sortValue: (row) => row.studentName,
      searchValue: (row) => `${row.studentName} ${row.studentNumber}`,
      cell: (row) => (
        <Link
          href={`/dashboard/admissions/students/${row.studentProfileId}`}
          className="font-medium text-brand-primary hover:underline"
        >
          {row.studentName}
          <span className="block font-mono text-xs font-normal text-ink-muted">
            {row.studentNumber}
          </span>
        </Link>
      ),
    },
    {
      id: 'class',
      header: 'Class',
      muted: true,
      sortValue: (row) => `${row.gradeName} ${row.sectionName}`,
      searchValue: (row) => `${row.gradeName} ${row.sectionName} ${row.branchName}`,
      cell: (row) => (
        <>
          {row.gradeName} {row.sectionName}
          <span className="block text-xs text-ink-muted">{row.branchName}</span>
        </>
      ),
    },
    {
      id: 'guardian',
      header: 'Guardian',
      muted: true,
      sortValue: (row) => row.guardianName ?? '',
      searchValue: (row) => row.guardianName ?? '',
      cell: (row) =>
        row.reachable ? (
          <>
            <span className="block">{row.guardianName ?? '—'}</span>
            <span className="block font-mono text-xs text-ink-muted">
              {row.guardianPhone === null
                ? row.guardianEmail
                : formatPhoneForDisplay(row.guardianPhone)}
            </span>
          </>
        ) : (
          <span className="text-status-warning-ink">No contact on file</span>
        ),
    },
    {
      id: 'openChallans',
      header: 'Open vouchers',
      kind: 'number',
      sortValue: (row) => row.openChallans,
      cell: (row) => row.openChallans,
    },
    {
      id: 'oldestDueDate',
      header: 'Oldest due',
      kind: 'date',
      muted: true,
      sortValue: (row) => row.oldestDueDate,
      cell: (row) => row.oldestDueDate,
    },
    {
      id: 'daysOverdue',
      header: 'Days overdue',
      kind: 'number',
      sortValue: (row) => row.daysOverdue,
      cell: (row) => (
        <Badge
          variant={
            row.bucket === 'd90_plus'
              ? 'danger'
              : row.bucket === 'current'
                ? 'neutral'
                : 'warning'
          }
        >
          {row.daysOverdue <= 0 ? 'Not yet due' : `${row.daysOverdue} days`}
        </Badge>
      ),
    },
    {
      id: 'outstanding',
      header: 'Outstanding',
      kind: 'money',
      sortValue: (row) => toPaise(row.outstanding),
      cell: (row) => formatAmount(row.outstanding),
    },
    {
      /*
       * The chase history, as chips, newest last and wrapping (item 6d).
       *
       * Newest last rather than first because the row reads left to right as a
       * sequence of events, and the question being asked of it is "how far has
       * this gone", not "what happened most recently".
       */
      id: 'reminders',
      header: 'Chased',
      sortValue: (row) => row.reminders.length,
      cell: (row) =>
        row.reminders.length === 0 ? (
          <span className="text-xs text-ink-muted">Never</span>
        ) : (
          <span className="flex flex-wrap gap-1">
            {row.reminders.map((reminder) => (
              <span
                key={`${String(reminder.sequence)}-${reminder.sentAt}`}
                className="whitespace-nowrap rounded-full bg-surface-sunken px-2 py-0.5 text-[11px] text-ink-muted"
              >
                Reminder {reminder.sequence} · {formatDateOnly(reminder.sentAt)}
              </span>
            ))}
          </span>
        ),
    },
  ];

  if (canCollect) {
    columns.push({
      id: 'actions',
      header: 'Actions',
      cell: (row) => (
        <div className="flex flex-nowrap gap-2">
          <Button
            size="sm"
            variant="secondary"
            isLoading={
              busy?.studentProfileId === row.studentProfileId && busy.action === 'remind'
            }
            disabled={busy !== null || !row.reachable}
            onClick={() => {
              void sendReminder(row);
            }}
          >
            Send reminder
          </Button>
          <Button
            size="sm"
            variant="ghost"
            disabled={busy !== null}
            onClick={() => {
              setMethod('cash');
              setError(null);
              setSettling(row);
            }}
          >
            Mark as paid
          </Button>
        </div>
      ),
    });
  }

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
        <p className="rounded-lg bg-status-success-subtle px-3 py-2 text-sm text-status-success-onSubtle">
          {notice}
        </p>
      )}

      <DataTable
        caption="Aged debt"
        columns={columns}
        rows={visible}
        getRowKey={(row) => row.studentProfileId}
        filters={[
          {
            id: 'bucket',
            label: 'Age',
            allLabel: 'Every age',
            options: AGING_BUCKETS.map((value) => ({
              value,
              label: BUCKET_LABELS[value],
            })),
            rowValue: (row) => row.bucket,
          },
          {
            id: 'branch',
            label: 'Campus',
            allLabel: 'All campuses',
            options: [...new Set(rows.map((row) => row.branchName))]
              .sort((left, right) => left.localeCompare(right))
              .map((value) => ({ value, label: value })),
            rowValue: (row) => row.branchName,
          },
          {
            id: 'grade',
            label: 'Class',
            allLabel: 'All classes',
            options: [...new Set(rows.map((row) => row.gradeName))]
              .sort((left, right) => left.localeCompare(right, undefined, { numeric: true }))
              .map((value) => ({ value, label: value })),
            rowValue: (row) => row.gradeName,
          },
        ]}
        extraFilters={
          <div className="w-full sm:w-44">
            <Input
              label="Owing at least"
              inputMode="decimal"
              placeholder="e.g. 5000"
              value={minimum}
              onChange={(event) => {
                setMinimum(event.target.value);
              }}
            />
          </div>
        }
        search={{ placeholder: 'Student, ID or guardian' }}
        itemNoun={{ singular: 'student', plural: 'students' }}
        emptyTitle="Nothing outstanding"
        emptyDescription="Every voucher this school has raised has been settled."
        noResultTitle="No students match those filters"
        noResultDescription="Widen the age, campus or class and they will come back."
      />

      <Modal
        open={settling !== null}
        title="Record payment in full"
        description="This takes the money in, posts it to the ledger and settles every open voucher for this student."
        onClose={() => {
          if (busy === null) setSettling(null);
        }}
        footer={
          <>
            <Button
              variant="secondary"
              disabled={busy !== null}
              onClick={() => {
                setSettling(null);
              }}
            >
              Cancel
            </Button>
            <Button
              isLoading={busy?.action === 'pay'}
              onClick={() => {
                if (settling !== null) void markPaid(settling);
              }}
            >
              Record {settling === null ? '' : formatPkr(settling.outstanding)}
            </Button>
          </>
        }
      >
        {settling === null ? null : (
          <div className="space-y-4">
            <p className="text-sm text-ink">
              <span className="font-medium">{formatPkr(settling.outstanding)}</span> across{' '}
              {settling.openChallans} voucher{settling.openChallans === 1 ? '' : 's'} for{' '}
              <span className="font-medium">{settling.studentName}</span>. One payment is
              recorded against each, for exactly what it still owes.
            </p>

            <ul className="space-y-0.5 text-sm text-ink-muted">
              {settling.openVouchers.map((voucher) => (
                <li key={voucher.challanId}>
                  <span className="font-mono text-xs">{voucher.challanNumber}</span> ·{' '}
                  {formatPkr(voucher.balance)}
                </li>
              ))}
            </ul>

            {/*
              Not a detail. The method decides which account the money lands in
              — a cheque is not money until it clears — so a control that
              guessed would post to the wrong account every time a parent paid
              by transfer.
            */}
            <Select
              label="How the money arrived"
              options={PAYMENT_METHODS.map((value) => ({
                value,
                label: PAYMENT_METHOD_LABELS[value],
              }))}
              value={method}
              disabled={busy !== null}
              onChange={(event) => {
                setMethod(event.target.value);
              }}
            />
          </div>
        )}
      </Modal>
    </div>
  );
}
