'use client';

import { Coins, Plus } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';

import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card, CardTitle } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/EmptyState';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { Textarea } from '@/components/ui/Textarea';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeaderCell,
  TableRow,
} from '@/components/ui/Table';
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
    return (
      <Card>
        <p className="text-sm text-ink-muted">Loading the cash counters…</p>
      </Card>
    );
  }

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
          <Table caption="Cash held by each fee counter">
            <TableHead>
              <TableRow>
                <TableHeaderCell>Who</TableHeaderCell>
                <TableHeaderCell>Drawer</TableHeaderCell>
                <TableHeaderCell>Last settled</TableHeaderCell>
                <TableHeaderCell align="numeric">Holding</TableHeaderCell>
                <TableHeaderCell align="end">Actions</TableHeaderCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {counters.map((counter) => (
                <TableRow key={counter.accountId}>
                  <TableCell>
                    <span className="font-medium text-ink">{counter.staffName}</span>
                    <span className="ml-2 text-xs text-ink-muted">{counter.staffRole}</span>
                  </TableCell>
                  <TableCell muted>
                    {counter.code} {counter.name}
                  </TableCell>
                  <TableCell muted>{counter.lastSettledOn ?? 'Never'}</TableCell>
                  <TableCell align="numeric">
                    {formatPkr(counter.balancePaise / 100)}
                  </TableCell>
                  <TableCell align="end">
                    {counter.balancePaise > 0 ? (
                      <Button
                        size="sm"
                        onClick={() =>
                          setSettling({
                            counter,
                            // Pre-filled with what the drawer should hold. It
                            // is typed over when the count disagrees, which is
                            // the entire point of asking.
                            amount: (counter.balancePaise / 100).toFixed(2),
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
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
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
          <Table caption="Recorded cash settlements">
            <TableHead>
              <TableRow>
                <TableHeaderCell>Date</TableHeaderCell>
                <TableHeaderCell>Who</TableHeaderCell>
                <TableHeaderCell>To</TableHeaderCell>
                <TableHeaderCell align="numeric">Expected</TableHeaderCell>
                <TableHeaderCell align="numeric">Handed over</TableHeaderCell>
                <TableHeaderCell align="numeric">Left in drawer</TableHeaderCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {settlements.map((row) => (
                <TableRow key={row.id}>
                  <TableCell>{row.settlementDate}</TableCell>
                  <TableCell>{row.staffName}</TableCell>
                  <TableCell muted>
                    {row.toName}
                    {row.referenceNumber !== null ? (
                      <span className="ml-2 text-xs">{row.referenceNumber}</span>
                    ) : null}
                  </TableCell>
                  <TableCell align="numeric">{formatPkr(row.expectedPaise / 100)}</TableCell>
                  <TableCell align="numeric">{formatPkr(row.amountPaise / 100)}</TableCell>
                  <TableCell align="numeric">
                    {row.shortPaise === 0 ? '—' : formatPkr(row.shortPaise / 100)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      ) : null}
    </div>
  );
}
