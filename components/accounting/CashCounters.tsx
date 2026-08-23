'use client';

import { Coins, Plus } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';

import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card, CardTitle } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/EmptyState';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { DataTable, type DataTableColumn } from '@/components/ui/DataTable';
import { SkeletonTable } from '@/components/ui/Skeleton';
import { Textarea } from '@/components/ui/Textarea';
import { parsePositiveAmountPaise } from '@/lib/accounting';
import { formatPkr } from '@/lib/money';
import { schoolErrorMessage, schoolFetch } from '@/lib/school-client';

/**
 * Cash counters — who is holding the school's money, and settling it in.
 *
 * ── The one number this screen exists for ────────────────────────────────
 * Each row's balance is what that person is carrying and has not handed over.
 * It is not a report on a period: a clerk's position is "how much is in your
 * drawer", and it is answered as at right now.
 *
 * ── Short is shown, not absorbed ─────────────────────────────────────────
 * The form pre-fills with what the drawer should hold, and whoever counts it
 * types what was actually on the desk. Anything left stays in their account as
 * a balance they still carry, and the screen says so in the sentence under the
 * amount — because a form that quietly zeroed the drawer at four in the
 * afternoon is how a 500-rupee short becomes nobody's problem.
 */

interface CounterRow {
  accountId: string;
  code: string;
  name: string;
  staffUserId: string;
  staffName: string;
  staffRole: string;
  balancePaise: number;
  lastSettledOn: string | null;
}

interface SettlementRow {
  id: string;
  settlementDate: string;
  amountPaise: number;
  expectedPaise: number;
  shortPaise: number;
  staffName: string;
  fromName: string;
  toName: string;
  referenceNumber: string | null;
}

interface StaffOption {
  id: string;
  name: string;
  role: string;
}

export interface CashCountersProps {
  /** Members of staff who could be given a drawer, resolved on the server. */
  staff: readonly StaffOption[];
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

export function CashCounters({ staff }: CashCountersProps) {
  const [counters, setCounters] = useState<CounterRow[] | null>(null);
  const [settlements, setSettlements] = useState<SettlementRow[]>([]);
  const [opening, setOpening] = useState<string>('');
  const [settling, setSettling] = useState<{
    counter: CounterRow;
    amount: string;
    settlementDate: string;
    referenceNumber: string;
    notes: string;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const payload = await schoolFetch<{
        settlements: SettlementRow[];
        accounts: CounterRow[];
      }>('/api/school/accounting/settlements');
      setCounters(payload.accounts);
      setSettlements(payload.settlements);
      setError(null);
    } catch (caught) {
      setError(schoolErrorMessage(caught, 'Could not load the cash counters.'));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const openDrawer = async (): Promise<void> => {
    if (opening === '') return;

    setBusy('open');
    setError(null);
    try {
      await schoolFetch('/api/school/accounting/cash-accounts', {
        method: 'POST',
        body: JSON.stringify({ staffUserId: opening }),
      });
      setOpening('');
      await load();
    } catch (caught) {
      setError(schoolErrorMessage(caught, 'Could not open the cash account.'));
    } finally {
      setBusy(null);
    }
  };

  const settle = async (): Promise<void> => {
    if (settling === null) return;

    const amountPaise = parsePositiveAmountPaise(settling.amount);
    if (amountPaise === null) {
      setError('Enter what was actually handed over.');
      return;
    }

    setBusy(settling.counter.accountId);
    setError(null);
    try {
      await schoolFetch('/api/school/accounting/settlements', {
        method: 'POST',
        body: JSON.stringify({
          staffUserId: settling.counter.staffUserId,
          amount: settling.amount.trim(),
          settlementDate: settling.settlementDate,
          referenceNumber: settling.referenceNumber.trim(),
          notes: settling.notes.trim(),
        }),
      });
      setSettling(null);
      await load();
    } catch (caught) {
      setError(schoolErrorMessage(caught, 'Could not record the settlement.'));
    } finally {
      setBusy(null);
    }
  };

  if (counters === null) {
    return <SkeletonTable rows={5} columns={5} />;
  }

  const counterColumns: Array<DataTableColumn<CounterRow>> = [
    {
      id: 'who',
      header: 'Who',
      sortValue: (row) => row.staffName,
      searchValue: (row) => `${row.staffName} ${row.staffRole}`,
      cell: (row) => (
        <>
          <span className="font-medium text-ink">{row.staffName}</span>
          <span className="ml-2 text-xs text-ink-muted">{row.staffRole}</span>
        </>
      ),
    },
    {
      id: 'drawer',
      header: 'Drawer',
      muted: true,
      sortValue: (row) => row.code,
      searchValue: (row) => `${row.code} ${row.name}`,
      cell: (row) => `${row.code} ${row.name}`,
    },
    {
      id: 'lastSettled',
      header: 'Last settled',
      kind: 'date',
      muted: true,
      sortValue: (row) => row.lastSettledOn,
      cell: (row) => row.lastSettledOn ?? 'Never',
    },
    {
      id: 'holding',
      header: 'Holding',
      kind: 'money',
      sortValue: (row) => row.balancePaise,
      cell: (row) => formatPkr(row.balancePaise / 100),
    },
    {
      id: 'actions',
      header: 'Actions',
      align: 'end',
      cell: (row) =>
        row.balancePaise > 0 ? (
          <Button
            size="sm"
            onClick={() =>
              setSettling({
                counter: row,
                // Pre-filled with what the drawer should hold. It is typed over
                // when the count disagrees, which is the entire point of asking.
                amount: (row.balancePaise / 100).toFixed(2),
                settlementDate: today(),
                referenceNumber: '',
                notes: '',
              })
            }
          >
            Settle
          </Button>
        ) : (
          <Badge variant="success">Settled up</Badge>
        ),
    },
  ];

  const settlementColumns: Array<DataTableColumn<SettlementRow>> = [
    {
      id: 'date',
      header: 'Date',
      kind: 'date',
      sortValue: (row) => row.settlementDate,
      searchValue: (row) => row.settlementDate,
      cell: (row) => row.settlementDate,
    },
    {
      id: 'who',
      header: 'Who',
      sortValue: (row) => row.staffName,
      searchValue: (row) => row.staffName,
      cell: (row) => row.staffName,
    },
    {
      id: 'to',
      header: 'To',
      muted: true,
      sortValue: (row) => row.toName,
      searchValue: (row) => `${row.toName} ${row.referenceNumber ?? ''}`,
      cell: (row) => (
        <>
          {row.toName}
          {row.referenceNumber !== null ? (
            <span className="ml-2 text-xs">{row.referenceNumber}</span>
          ) : null}
        </>
      ),
    },
    {
      id: 'expected',
      header: 'Expected',
      kind: 'money',
      sortValue: (row) => row.expectedPaise,
      cell: (row) => formatPkr(row.expectedPaise / 100),
    },
    {
      id: 'handedOver',
      header: 'Handed over',
      kind: 'money',
      sortValue: (row) => row.amountPaise,
      cell: (row) => formatPkr(row.amountPaise / 100),
    },
    {
      id: 'left',
      header: 'Left in drawer',
      kind: 'money',
      sortValue: (row) => row.shortPaise,
      cell: (row) => (row.shortPaise === 0 ? '—' : formatPkr(row.shortPaise / 100)),
    },
  ];

  const withoutDrawer = staff.filter(
    (member) => !counters.some((counter) => counter.staffUserId === member.id),
  );

  const shortfall =
    settling === null
      ? 0
      : settling.counter.balancePaise - (parsePositiveAmountPaise(settling.amount) ?? 0);

  return (
    <div className="space-y-4">
      {error !== null ? (
        <p
          role="alert"
          className="rounded-lg bg-status-danger-subtle px-3 py-2 text-sm text-status-danger-ink"
        >
          {error}
        </p>
      ) : null}

      {counters.length === 0 ? (
        <EmptyState
          icon={Coins}
          title="No counter has its own drawer yet"
          description={
            'Every cash fee payment currently lands straight in office cash. Giving a ' +
            'clerk their own drawer means the money they take is recorded as theirs ' +
            'until they hand it in — which is what lets anybody be short, and what ' +
            'lets a bursar know what to expect before counting it.'
          }
        />
      ) : (
        <Card
          header={
            <CardTitle
              title="What each counter is holding"
              description="As at right now. This is what they owe the school."
            />
          }
        >
          <DataTable
            caption="Cash held by each fee counter"
            columns={counterColumns}
            rows={counters}
            getRowKey={(row) => row.accountId}
            defaultSort={{ columnId: 'holding', direction: 'desc' }}
            search={{ placeholder: 'Name or drawer' }}
            filters={[
              {
                id: 'position',
                label: 'Position',
                allLabel: 'Every counter',
                options: [
                  { value: 'holding', label: 'Still holding cash' },
                  { value: 'settled', label: 'Settled up' },
                ],
                rowValue: (row) => (row.balancePaise > 0 ? 'holding' : 'settled'),
              },
            ]}
            itemNoun={{ singular: 'counter', plural: 'counters' }}
            emptyTitle="No counters"
          />
        </Card>
      )}

      {settling !== null ? (
        <Card
          header={
            <CardTitle
              title={`Settle ${settling.counter.staffName}'s takings`}
              description={`Their drawer should hold ${formatPkr(
                settling.counter.balancePaise / 100,
              )}.`}
            />
          }
        >
          <div className="grid gap-4 sm:grid-cols-2">
            <Input
              label="Counted and handed over (PKR)"
              inputMode="decimal"
              value={settling.amount}
              onChange={(event) => setSettling({ ...settling, amount: event.target.value })}
            />
            <Input
              label="Date"
              type="date"
              value={settling.settlementDate}
              onChange={(event) =>
                setSettling({ ...settling, settlementDate: event.target.value })
              }
            />
            <Input
              label="Deposit slip number"
              value={settling.referenceNumber}
              hint="If it went straight to the bank."
              onChange={(event) =>
                setSettling({ ...settling, referenceNumber: event.target.value })
              }
            />
            <Textarea
              label="Notes"
              rows={2}
              value={settling.notes}
              onChange={(event) => setSettling({ ...settling, notes: event.target.value })}
            />
          </div>

          {shortfall > 0 ? (
            <p className="mt-3 rounded-lg bg-status-warning-subtle px-3 py-2 text-sm text-status-warning-ink">
              {formatPkr(shortfall / 100)} stays in {settling.counter.staffName}&rsquo;s
              drawer as a balance they are still carrying. It is not written off — that is
              a decision somebody makes with a journal entry, not something this form does
              quietly.
            </p>
          ) : null}

          <div className="mt-4 flex gap-2">
            <Button
              isLoading={busy === settling.counter.accountId}
              onClick={() => void settle()}
            >
              Record the settlement
            </Button>
            <Button variant="ghost" onClick={() => setSettling(null)}>
              Cancel
            </Button>
          </div>
        </Card>
      ) : null}

      {withoutDrawer.length > 0 ? (
        <Card header={<CardTitle title="Open a drawer" />}>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
            <Select
              label="Member of staff"
              className="sm:max-w-80"
              value={opening}
              placeholder="Choose somebody"
              options={withoutDrawer.map((member) => ({
                value: member.id,
                label: `${member.name} — ${member.role}`,
              }))}
              onChange={(event) => setOpening(event.target.value)}
            />
            <Button
              icon={Plus}
              variant="secondary"
              isLoading={busy === 'open'}
              disabled={opening === ''}
              onClick={() => void openDrawer()}
            >
              Open a cash account
            </Button>
          </div>
          <p className="mt-3 text-xs text-ink-muted">
            From then on, cash they take at the fee counter is recorded as theirs until
            they settle it. Bank transfers and cheques are unaffected — those never sit in
            anybody&rsquo;s drawer.
          </p>
        </Card>
      ) : null}

      {settlements.length > 0 ? (
        <Card header={<CardTitle title="Settlements" description="What has been handed in." />}>
          <DataTable
            caption="Recorded cash settlements"
            columns={settlementColumns}
            rows={settlements}
            getRowKey={(row) => row.id}
            defaultSort={{ columnId: 'date', direction: 'desc' }}
            search={{ placeholder: 'Who, or a slip number' }}
            filters={[
              {
                id: 'short',
                label: 'Shortfall',
                allLabel: 'Every settlement',
                options: [
                  { value: 'short', label: 'Left something in the drawer' },
                  { value: 'clean', label: 'Handed over in full' },
                ],
                rowValue: (row) => (row.shortPaise === 0 ? 'clean' : 'short'),
              },
            ]}
            itemNoun={{ singular: 'settlement', plural: 'settlements' }}
            emptyTitle="Nothing settled yet"
          />
        </Card>
      ) : null}
    </div>
  );
}
