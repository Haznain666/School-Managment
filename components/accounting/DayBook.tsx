'use client';

import { BookOpenCheck, Plus, Undo2 } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';

import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card, CardTitle } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/EmptyState';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeaderCell,
  TableRow,
} from '@/components/ui/Table';
import {
  LEDGER_SOURCE_LABELS,
  lineProblem,
  LINE_PROBLEM_MESSAGES,
  parsePositiveAmountPaise,
  type LedgerSource,
} from '@/lib/accounting';
import { formatPkr } from '@/lib/money';
import { schoolErrorMessage, schoolFetch } from '@/lib/school-client';

/**
 * The day book, and the two things a person does to it.
 *
 * ── There is no Edit and no Delete, anywhere on this screen ──────────────
 * That is the module's one rule, and the screen is built to make it obvious
 * rather than to enforce it quietly. A wrong entry gets Reverse, which writes a
 * mirror and leaves both entries visible — the original struck through, the
 * reversal beside it. A reader six months later sees what happened *and* that
 * it was corrected, which is the whole reason an append-only ledger is worth
 * the inconvenience.
 *
 * ── The journal form balances in the browser, and again on the server ────
 * `lineProblem` is the same function the poster runs, imported here rather than
 * reimplemented — the defect that pattern exists to prevent is a form that
 * accepts what the API then refuses, or worse, the other way round.
 */

interface DayBookLine {
  accountId: string;
  accountCode: string;
  accountName: string;
  debitPaise: number;
  creditPaise: number;
  memo: string | null;
}

interface DayBookEntry {
  id: string;
  entryDate: string;
  memo: string;
  source: LedgerSource;
  referenceNumber: string | null;
  reversesTransactionId: string | null;
  reversedByTransactionId: string | null;
  lines: DayBookLine[];
  totalPaise: number;
}

interface AccountRow {
  id: string;
  code: string;
  name: string;
  isActive: boolean;
}

export interface DayBookProps {
  canWrite: boolean;
}

interface DraftLine {
  accountId: string;
  debit: string;
  credit: string;
  memo: string;
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

function emptyLine(): DraftLine {
  return { accountId: '', debit: '', credit: '', memo: '' };
}

/** A form amount to paise, with blank meaning zero rather than a refusal. */
function amountPaise(value: string): number {
  if (value.trim() === '') return 0;
  return parsePositiveAmountPaise(value) ?? -1;
}

export function DayBook({ canWrite }: DayBookProps) {
  const [entries, setEntries] = useState<DayBookEntry[] | null>(null);
  const [accounts, setAccounts] = useState<AccountRow[]>([]);
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [draft, setDraft] = useState<{
    entryDate: string;
    memo: string;
    referenceNumber: string;
    lines: DraftLine[];
  } | null>(null);
  const [reversing, setReversing] = useState<{ id: string; reason: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const query = new URLSearchParams();
      if (from !== '') query.set('from', from);
      if (to !== '') query.set('to', to);
      const suffix = query.toString() === '' ? '' : `?${query.toString()}`;

      const [entryPayload, accountPayload] = await Promise.all([
        schoolFetch<{ entries: DayBookEntry[] }>(
          `/api/school/accounting/entries${suffix}`,
        ),
        schoolFetch<{ accounts: AccountRow[] }>(
          '/api/school/accounting/accounts?active=true',
        ),
      ]);

      setEntries(entryPayload.entries);
      setAccounts(accountPayload.accounts);
      setError(null);
    } catch (caught) {
      setError(schoolErrorMessage(caught, 'Could not load the day book.'));
    }
  }, [from, to]);

  useEffect(() => {
    void load();
  }, [load]);

  const startNew = (): void => {
    setDraft({
      entryDate: today(),
      memo: '',
      referenceNumber: '',
      // Two lines, because a journal entry has at least two and starting with
      // one invites somebody to save a half-entry and find out.
      lines: [emptyLine(), emptyLine()],
    });
  };

  const draftProblem = ((): string | null => {
    if (draft === null) return null;
    if (draft.memo.trim() === '') return 'Say what this entry is for.';

    const lines = draft.lines
      .filter((line) => line.accountId !== '')
      .map((line) => ({
        accountId: line.accountId,
        debitPaise: amountPaise(line.debit),
        creditPaise: amountPaise(line.credit),
      }));

    if (lines.some((line) => line.debitPaise < 0 || line.creditPaise < 0)) {
      return 'An amount is a number of rupees, to at most two decimal places.';
    }

    const problem = lineProblem(lines);
    return problem === null ? null : LINE_PROBLEM_MESSAGES[problem];
  })();

  const save = async (): Promise<void> => {
    if (draft === null || draftProblem !== null) return;

    setBusy('save');
    setError(null);

    try {
      await schoolFetch('/api/school/accounting/entries', {
        method: 'POST',
        body: JSON.stringify({
          entryDate: draft.entryDate,
          memo: draft.memo.trim(),
          source: 'manual',
          referenceNumber: draft.referenceNumber.trim(),
          lines: draft.lines
            .filter((line) => line.accountId !== '')
            .map((line) => ({
              accountId: line.accountId,
              debit: line.debit.trim(),
              credit: line.credit.trim(),
              memo: line.memo.trim(),
            })),
        }),
      });
      setDraft(null);
      await load();
    } catch (caught) {
      setError(schoolErrorMessage(caught, 'Could not post the entry.'));
    } finally {
      setBusy(null);
    }
  };

  const reverse = async (): Promise<void> => {
    if (reversing === null) return;

    setBusy(reversing.id);
    setError(null);
    try {
      await schoolFetch(`/api/school/accounting/entries/${reversing.id}/reverse`, {
        method: 'POST',
        body: JSON.stringify({ reason: reversing.reason.trim() }),
      });
      setReversing(null);
      await load();
    } catch (caught) {
      setError(schoolErrorMessage(caught, 'Could not reverse the entry.'));
    } finally {
      setBusy(null);
    }
  };

  if (entries === null) {
    return (
      <Card>
        <p className="text-sm text-ink-muted">Loading the day book…</p>
      </Card>
    );
  }

  const accountOptions = accounts.map((account) => ({
    value: account.id,
    label: `${account.code} ${account.name}`,
  }));

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

      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div className="flex gap-3">
          <Input
            label="From"
            type="date"
            value={from}
            onChange={(event) => setFrom(event.target.value)}
          />
          <Input
            label="To"
            type="date"
            value={to}
            onChange={(event) => setTo(event.target.value)}
          />
        </div>
        {canWrite && draft === null ? (
          <Button icon={Plus} variant="secondary" onClick={startNew}>
            Post a journal entry
          </Button>
        ) : null}
      </div>

      {draft !== null ? (
        <Card
          header={
            <CardTitle
              title="Journal entry"
              description="Debits and credits have to be equal. Nothing posts until they are."
            />
          }
        >
          <div className="grid gap-4 sm:grid-cols-3">
            <Input
              label="Date"
              type="date"
              value={draft.entryDate}
              onChange={(event) => setDraft({ ...draft, entryDate: event.target.value })}
            />
            <Input
              label="What it is for"
              className="sm:col-span-2"
              value={draft.memo}
              hint="It is the only thing that will explain this entry in six months."
              onChange={(event) => setDraft({ ...draft, memo: event.target.value })}
            />
          </div>

          <div className="mt-4 space-y-3">
            {draft.lines.map((line, index) => (
              <div key={index} className="grid gap-3 sm:grid-cols-4">
                <Select
                  label={`Line ${index + 1} — account`}
                  value={line.accountId}
                  placeholder="Choose an account"
                  options={accountOptions}
                  onChange={(event) => {
                    const lines = [...draft.lines];
                    lines[index] = { ...line, accountId: event.target.value };
                    setDraft({ ...draft, lines });
                  }}
                />
                <Input
                  label="Debit"
                  inputMode="decimal"
                  value={line.debit}
                  onChange={(event) => {
                    const lines = [...draft.lines];
                    // A line is one side or the other. Typing in this box
                    // clears the other one, which is quicker than refusing it
                    // after the fact and says the same thing.
                    lines[index] = { ...line, debit: event.target.value, credit: '' };
                    setDraft({ ...draft, lines });
                  }}
                />
                <Input
                  label="Credit"
                  inputMode="decimal"
                  value={line.credit}
                  onChange={(event) => {
                    const lines = [...draft.lines];
                    lines[index] = { ...line, credit: event.target.value, debit: '' };
                    setDraft({ ...draft, lines });
                  }}
                />
                <Input
                  label="Note"
                  value={line.memo}
                  onChange={(event) => {
                    const lines = [...draft.lines];
                    lines[index] = { ...line, memo: event.target.value };
                    setDraft({ ...draft, lines });
                  }}
                />
              </div>
            ))}
          </div>

          <div className="mt-3">
            <Button
              size="sm"
              variant="ghost"
              icon={Plus}
              onClick={() => setDraft({ ...draft, lines: [...draft.lines, emptyLine()] })}
            >
              Another line
            </Button>
          </div>

          {draftProblem !== null ? (
            <p className="mt-3 text-sm text-status-warning-ink">{draftProblem}</p>
          ) : null}

          <div className="mt-4 flex gap-2">
            <Button
              isLoading={busy === 'save'}
              disabled={draftProblem !== null}
              onClick={() => void save()}
            >
              Post it
            </Button>
            <Button variant="ghost" onClick={() => setDraft(null)}>
              Cancel
            </Button>
          </div>
        </Card>
      ) : null}

      {entries.length === 0 ? (
        <EmptyState
          icon={BookOpenCheck}
          title="Nothing in the books for this range"
          description="Fee payments, approved expenses and settlements all post here as they happen."
        />
      ) : (
        <Card>
          <Table caption="Every entry in the books" maxHeight="70vh">
            <TableHead>
              <TableRow>
                <TableHeaderCell>Date</TableHeaderCell>
                <TableHeaderCell>Entry</TableHeaderCell>
                <TableHeaderCell>Debit</TableHeaderCell>
                <TableHeaderCell>Credit</TableHeaderCell>
                <TableHeaderCell align="numeric">Amount</TableHeaderCell>
                {canWrite ? <TableHeaderCell align="end">Actions</TableHeaderCell> : null}
              </TableRow>
            </TableHead>
            <TableBody>
              {entries.map((entry) => {
                const debits = entry.lines.filter((line) => line.debitPaise > 0);
                const credits = entry.lines.filter((line) => line.creditPaise > 0);
                const isReversed = entry.reversedByTransactionId !== null;

                return (
                  <TableRow key={entry.id}>
                    <TableCell>{entry.entryDate}</TableCell>
                    <TableCell>
                      <span
                        className={
                          // Struck through, not hidden. A reversed entry that
                          // vanished would make the day book disagree with
                          // itself the moment anybody added the amounts up.
                          isReversed ? 'text-ink-muted line-through' : 'text-ink'
                        }
                      >
                        {entry.memo}
                      </span>
                      <div className="mt-1 flex flex-wrap gap-2">
                        <Badge variant="neutral">
                          {LEDGER_SOURCE_LABELS[entry.source]}
                        </Badge>
                        {isReversed ? <Badge variant="warning">Reversed</Badge> : null}
                        {entry.reversesTransactionId !== null ? (
                          <Badge variant="info">Is a reversal</Badge>
                        ) : null}
                        {entry.referenceNumber !== null ? (
                          <span className="text-xs text-ink-muted">
                            {entry.referenceNumber}
                          </span>
                        ) : null}
                      </div>
                    </TableCell>
                    <TableCell muted>
                      {debits.map((line) => (
                        <div key={line.accountId + String(line.debitPaise)}>
                          {line.accountCode} {line.accountName}
                        </div>
                      ))}
                    </TableCell>
                    <TableCell muted>
                      {credits.map((line) => (
                        <div key={line.accountId + String(line.creditPaise)}>
                          {line.accountCode} {line.accountName}
                        </div>
                      ))}
                    </TableCell>
                    <TableCell align="numeric">
                      {formatPkr(entry.totalPaise / 100)}
                    </TableCell>
                    {canWrite ? (
                      <TableCell align="end">
                        {isReversed || entry.reversesTransactionId !== null ? (
                          <span className="text-xs text-ink-muted">
                            {isReversed ? 'Already reversed' : 'Reversals stand'}
                          </span>
                        ) : (
                          <Button
                            size="sm"
                            variant="ghost"
                            icon={Undo2}
                            onClick={() => setReversing({ id: entry.id, reason: '' })}
                          >
                            Reverse
                          </Button>
                        )}
                      </TableCell>
                    ) : null}
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
          <p className="mt-3 text-xs text-ink-muted">
            Nothing here is edited or deleted, ever. A wrong entry is reversed: a second
            entry, dated today, whose two sides are the mirror of the first. Both stay in
            the book, which is the only way a disputed balance is explainable months
            later.
          </p>
        </Card>
      )}

      {reversing !== null ? (
        <Card header={<CardTitle title="Reverse this entry" />}>
          <Input
            label="Why"
            value={reversing.reason}
            hint="Two entries that cancel with no reason are the hardest thing to explain later."
            onChange={(event) => setReversing({ ...reversing, reason: event.target.value })}
          />
          <div className="mt-4 flex gap-2">
            <Button
              variant="danger"
              isLoading={busy === reversing.id}
              disabled={reversing.reason.trim() === ''}
              onClick={() => void reverse()}
            >
              Post the reversal
            </Button>
            <Button variant="ghost" onClick={() => setReversing(null)}>
              Cancel
            </Button>
          </div>
        </Card>
      ) : null}
    </div>
  );
}
