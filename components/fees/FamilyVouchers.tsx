'use client';

import { useCallback, useEffect, useState } from 'react';

import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card, CardTitle } from '@/components/ui/Card';
import { DataTable, type DataTableColumn } from '@/components/ui/DataTable';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { formatPhoneForDisplay } from '@/lib/phone-formats';

interface Member {
  challanId: string;
  studentName: string;
  studentNumber: string;
  challanNumber: string;
  totalAmount: string;
}

interface Group {
  guardianId: string;
  guardianName: string;
  phone: string;
  members: Member[];
  total: string;
}

interface Issued {
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
}

export interface FamilyVouchersProps {
  canWrite: boolean;
  defaultMonth: number;
  defaultYear: number;
}

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

/**
 * Family vouchers: one slip for a parent with several children.
 *
 * Families are found by the primary guardian's phone number, which is the only
 * grouping key `student_guardians` actually carries — see `lib/family-challans.ts`
 * for why that is both deliberate and imperfect. The children's names are
 * printed on the voucher, so a wrong grouping is visible rather than silent.
 */
export function FamilyVouchers({ canWrite, defaultMonth, defaultYear }: FamilyVouchersProps) {
  const [month, setMonth] = useState(String(defaultMonth));
  const [year, setYear] = useState(String(defaultYear));
  const [dueDate, setDueDate] = useState('');

  const [groups, setGroups] = useState<Group[] | null>(null);
  const [issued, setIssued] = useState<Issued[] | null>(null);
  const [loadingGroups, setLoadingGroups] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [payingId, setPayingId] = useState<string | null>(null);
  const [amount, setAmount] = useState('');
  const [method, setMethod] = useState('cash');
  const [reference, setReference] = useState('');

  const loadIssued = useCallback(async () => {
    const response = await fetch('/api/school/family-challans');
    const payload = (await response.json()) as { ok: boolean; data?: { challans: Issued[] } };
    if (payload.ok === true && payload.data !== undefined) setIssued(payload.data.challans);
  }, []);

  const loadGroups = useCallback(async () => {
    setError(null);
    // Changing the month refetches, so the pending flag is set here rather
    // than derived from `groups === null` — the second month's wait would
    // otherwise show the first month's families as though they were current.
    setLoadingGroups(true);
    const query = new URLSearchParams({ month, year });
    try {
      const response = await fetch(`/api/school/family-challans?${query.toString()}`);
      const payload = (await response.json()) as {
        ok: boolean;
        data?: { groups: Group[] };
        error?: { message: string };
      };
      if (payload.ok === true && payload.data !== undefined) setGroups(payload.data.groups);
      else setError(payload.error?.message ?? 'Could not read those challans.');
    } catch {
      setError('Could not read those challans.');
    } finally {
      setLoadingGroups(false);
    }
  }, [month, year]);

  useEffect(() => {
    void loadGroups();
    void loadIssued();
  }, [loadGroups, loadIssued]);

  const issue = useCallback(
    async (group: Group) => {
      setBusyId(group.guardianId);
      setError(null);
      setNotice(null);

      try {
        const response = await fetch('/api/school/family-challans', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            guardianId: group.guardianId,
            challanIds: group.members.map((member) => member.challanId),
            dueDate,
          }),
        });

        const payload = (await response.json()) as {
          ok: boolean;
          data?: { result: { challanNumber: string; total: string; members: number } };
          error?: { message: string };
        };

        if (!response.ok || payload.ok !== true || payload.data === undefined) {
          setError(payload.error?.message ?? 'Could not issue that voucher.');
          return;
        }

        setNotice(
          `${payload.data.result.challanNumber} issued for ${group.guardianName} — ` +
            `${payload.data.result.members} children, PKR ${payload.data.result.total}.`,
        );
        await Promise.all([loadGroups(), loadIssued()]);
      } catch {
        setError('Could not issue that voucher.');
      } finally {
        setBusyId(null);
      }
    },
    [dueDate, loadGroups, loadIssued],
  );

  /**
   * Takes money against a voucher.
   *
   * The route spreads it across the children's own challans, oldest first, and
   * writes a `fee_payments` row against each — which is the whole point of the
   * feature. Without this control the voucher could be issued and then only
   * paid a child at a time, which is the queueing it exists to remove.
   */
  const pay = useCallback(
    async (voucher: Issued) => {
      setBusyId(voucher.id);
      setError(null);
      setNotice(null);

      try {
        const response = await fetch(`/api/school/family-challans/${voucher.id}`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            amount: Number(amount),
            paymentMethod: method,
            reference: reference.trim() === '' ? undefined : reference.trim(),
          }),
        });

        const payload = (await response.json()) as {
          ok: boolean;
          data?: { result: { distributed: Array<{ amount: string }> } };
          error?: { message: string };
        };

        if (!response.ok || payload.ok !== true || payload.data === undefined) {
          setError(payload.error?.message ?? 'Could not record that payment.');
          return;
        }

        const across = payload.data.result.distributed.length;
        setNotice(
          `PKR ${Number(amount).toFixed(2)} recorded against ${voucher.challanNumber}, ` +
            `spread across ${across} child${across === 1 ? '' : 'ren'}’s challans, oldest first.`,
        );
        setPayingId(null);
        setAmount('');
        setReference('');
        await Promise.all([loadGroups(), loadIssued()]);
      } catch {
        setError('Could not record that payment.');
      } finally {
        setBusyId(null);
      }
    },
    [amount, method, reference, loadGroups, loadIssued],
  );

  const groupColumns: Array<DataTableColumn<Group>> = [
    {
      id: 'family',
      header: 'Family',
      sortValue: (group) => group.guardianName,
      searchValue: (group) =>
        `${group.guardianName} ${group.phone} ${group.members
          .map((member) => member.studentName)
          .join(' ')}`,
      cell: (group) => (
        <>
          <p className="font-medium text-ink">{group.guardianName}</p>
          <p className="font-mono text-xs text-ink-muted">
            {formatPhoneForDisplay(group.phone)}
          </p>
        </>
      ),
    },
    {
      id: 'children',
      header: 'Children',
      muted: true,
      sortValue: (group) => group.members.length,
      cell: (group) => (
        <ul className="text-sm text-ink-muted">
          {group.members.map((member) => (
            <li key={member.challanId}>
              {member.studentName} · {member.challanNumber} · PKR {member.totalAmount}
            </li>
          ))}
        </ul>
      ),
    },
    {
      id: 'total',
      header: 'Total',
      kind: 'money',
      sortValue: (group) => Number(group.total),
      cell: (group) => (
        <span className="font-mono text-sm text-ink">PKR {group.total}</span>
      ),
    },
  ];

  if (canWrite) {
    groupColumns.push({
      id: 'issue',
      header: 'Action',
      align: 'end',
      cell: (group) => (
        <Button
          size="sm"
          isLoading={busyId === group.guardianId}
          disabled={dueDate === ''}
          title={dueDate === '' ? 'Choose a due date first' : undefined}
          onClick={() => {
            void issue(group);
          }}
        >
          Issue one voucher
        </Button>
      ),
    });
  }

  const issuedColumns: Array<DataTableColumn<Issued>> = [
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
      sortValue: (row) => row.guardianName,
      searchValue: (row) => `${row.guardianName} ${row.phone}`,
      cell: (row) => (
        <>
          {row.guardianName}
          <span className="block font-mono text-xs text-ink-muted">
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
      sortValue: (row) => Number(row.totalAmount) - Number(row.paidAmount),
      cell: (row) =>
        row.paidAmount === '0.00'
          ? row.totalAmount
          : `${row.paidAmount} / ${row.totalAmount}`,
    },
  ];

  if (canWrite) {
    issuedColumns.push({
      id: 'payment',
      header: 'Payment',
      align: 'numeric',
      cell: (row) =>
        row.status === 'paid' || row.status === 'cancelled' ? (
          <span className="text-xs text-ink-muted">—</span>
        ) : payingId === row.id ? (
          <div className="flex flex-nowrap items-center justify-end gap-2 whitespace-nowrap">
            <input
              type="number"
              aria-label={`Amount received for ${row.challanNumber}`}
              placeholder="Amount"
              value={amount}
              className="w-28 rounded-lg border border-line-strong px-2 py-1 text-sm"
              onChange={(event) => {
                setAmount(event.target.value);
              }}
            />
            <select
              aria-label="Payment method"
              value={method}
              className="rounded-lg border border-line-strong px-2 py-1 text-sm"
              onChange={(event) => {
                setMethod(event.target.value);
              }}
            >
              <option value="cash">Cash</option>
              <option value="bank_transfer">Bank transfer</option>
              <option value="cheque">Cheque</option>
            </select>
            <input
              type="text"
              aria-label="Reference"
              placeholder="Slip no."
              value={reference}
              className="w-24 rounded-lg border border-line-strong px-2 py-1 text-sm"
              onChange={(event) => {
                setReference(event.target.value);
              }}
            />
            <Button
              size="sm"
              isLoading={busyId === row.id}
              disabled={Number(amount) <= 0}
              onClick={() => {
                void pay(row);
              }}
            >
              Record
            </Button>
            <Button
              variant="ghost"
              size="sm"
              disabled={busyId === row.id}
              onClick={() => {
                setPayingId(null);
              }}
            >
              Cancel
            </Button>
          </div>
        ) : (
          <Button
            variant="secondary"
            size="sm"
            onClick={() => {
              setPayingId(row.id);
              // Pre-filled with what is still owed, because paying the voucher
              // in full is the ordinary case and retyping it is how a digit
              // gets dropped.
              setAmount((Number(row.totalAmount) - Number(row.paidAmount)).toFixed(2));
              setError(null);
              setNotice(null);
            }}
          >
            Take payment
          </Button>
        ),
    });
  }

  return (
    <div className="space-y-4">
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

      <Card header={<CardTitle title="Which month?" />}>
        <div className="grid gap-4 sm:grid-cols-3">
          <Select
            label="Month"
            options={MONTHS.map((name, index) => ({ value: String(index + 1), label: name }))}
            value={month}
            onChange={(event) => {
              setMonth(event.target.value);
            }}
          />
          <Input
            label="Year"
            type="number"
            value={year}
            onChange={(event) => {
              setYear(event.target.value);
            }}
          />
          <Input
            label="Voucher due date"
            type="date"
            value={dueDate}
            hint="Printed on the slip the parent takes to the bank."
            onChange={(event) => {
              setDueDate(event.target.value);
            }}
          />
        </div>
      </Card>

      <Card
        header={
          <CardTitle
            title="Families that could have one voucher"
            description="Two or more children with an open challan for this month, sharing a contact number."
          />
        }
      >
        <DataTable
          caption="Families that could share one voucher"
          columns={groupColumns}
          rows={groups ?? []}
          getRowKey={(group) => group.guardianId}
          pending={loadingGroups}
          defaultSort={{ columnId: 'total', direction: 'desc' }}
          search={{ placeholder: 'Guardian, phone or child' }}
          filters={[
            {
              id: 'size',
              label: 'Children',
              allLabel: 'Any number',
              options: [
                { value: '2', label: 'Two' },
                { value: '3', label: 'Three' },
                { value: '4+', label: 'Four or more' },
              ],
              rowValue: (group) =>
                group.members.length >= 4 ? '4+' : String(group.members.length),
            },
          ]}
          itemNoun={{ singular: 'family', plural: 'families' }}
          emptyTitle="Nothing to combine"
          emptyDescription="No family has more than one open challan for this month."
          noResultTitle="No families match those filters"
          noResultDescription="Widen the search or the number of children."
        />
      </Card>

      <Card className="p-0" header={<CardTitle title="Issued vouchers" />}>
        <DataTable
          caption="Family vouchers"
          columns={issuedColumns}
          rows={issued ?? []}
          getRowKey={(row) => row.id}
          pending={issued === null}
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
          emptyDescription="Combine a family above and the voucher appears here."
          noResultTitle="No vouchers match those filters"
          noResultDescription="Clear the search or choose another status."
        />
      </Card>
    </div>
  );
}
