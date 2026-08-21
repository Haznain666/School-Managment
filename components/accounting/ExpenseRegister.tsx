'use client';

import { Check, Plus, Receipt, X } from 'lucide-react';
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
  TableFoot,
  TableHead,
  TableHeaderCell,
  TableRow,
} from '@/components/ui/Table';
import {
  EXPENSE_STATUSES,
  EXPENSE_STATUS_LABELS,
  parsePositiveAmountPaise,
  type ExpenseStatus,
} from '@/lib/accounting';
import { formatPkr } from '@/lib/money';
import { schoolErrorMessage, schoolFetch } from '@/lib/school-client';

/**
 * The expense register — filing a bill, and deciding on one.
 *
 * ── Filing is not paying, and the screen says so ─────────────────────────
 * Saving writes a draft and posts nothing. The money leaves the school when
 * somebody approves it, and the approve button carries the sentence that says
 * which account it will come out of. A form that just said "Save" would leave
 * the person who filled it in believing the bill was paid.
 *
 * ── An approved expense is read-only here ────────────────────────────────
 * Not greyed out with an explanation somewhere else: the Edit control is
 * absent, and the row says why in words a clerk can act on. Correcting one
 * means reversing its ledger entry, which is a different screen and a
 * different decision.
 */

interface ExpenseRow {
  id: string;
  expenseDate: string;
  amountPaise: number;
  status: ExpenseStatus;
  payee: string | null;
  referenceNumber: string | null;
  notes: string | null;
  rejectionReason: string | null;
  categoryId: string;
  categoryName: string;
  accountName: string;
  paidFromAccountId: string;
  paidFromName: string;
  approverName: string | null;
  ledgerTransactionId: string | null;
}

interface CategoryRow {
  id: string;
  name: string;
  isActive: boolean;
  accountName: string;
}

interface AccountRow {
  id: string;
  code: string;
  name: string;
  type: string;
  isActive: boolean;
}

export interface ExpenseRegisterProps {
  canWrite: boolean;
  /** From the URL, so a link from the overview lands on the right filter. */
  initialStatus: ExpenseStatus | null;
}

interface Draft {
  id: string | null;
  categoryId: string;
  paidFromAccountId: string;
  amount: string;
  expenseDate: string;
  payee: string;
  referenceNumber: string;
  attachmentUrl: string;
  notes: string;
}

const STATUS_VARIANT: Record<ExpenseStatus, 'warning' | 'success' | 'danger'> = {
  draft: 'warning',
  approved: 'success',
  rejected: 'danger',
};

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

export function ExpenseRegister({ canWrite, initialStatus }: ExpenseRegisterProps) {
  const [expenses, setExpenses] = useState<ExpenseRow[] | null>(null);
  const [categories, setCategories] = useState<CategoryRow[]>([]);
  const [accounts, setAccounts] = useState<AccountRow[]>([]);
  const [status, setStatus] = useState<ExpenseStatus | ''>(initialStatus ?? '');
  const [draft, setDraft] = useState<Draft | null>(null);
  const [rejecting, setRejecting] = useState<{ id: string; reason: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const query = status === '' ? '' : `?status=${status}`;
      const [expensePayload, categoryPayload, accountPayload] = await Promise.all([
        schoolFetch<{ expenses: ExpenseRow[] }>(`/api/school/accounting/expenses${query}`),
        schoolFetch<{ categories: CategoryRow[] }>(
          '/api/school/accounting/expense-categories',
        ),
        schoolFetch<{ accounts: AccountRow[] }>(
          '/api/school/accounting/accounts?active=true',
        ),
      ]);

      setExpenses(expensePayload.expenses);
      setCategories(categoryPayload.categories);
      setAccounts(accountPayload.accounts);
      setError(null);
    } catch (caught) {
      setError(schoolErrorMessage(caught, 'Could not load the expenses.'));
    }
  }, [status]);

  useEffect(() => {
    void load();
  }, [load]);

  // Only what the school holds or owes: money comes out of a drawer, a bank
  // account or a payable, never out of an income head.
  const payableFrom = accounts.filter(
    (account) => account.type === 'asset' || account.type === 'liability',
  );
  const activeCategories = categories.filter((category) => category.isActive);

  const startNew = (): void => {
    setDraft({
      id: null,
      categoryId: activeCategories[0]?.id ?? '',
      paidFromAccountId: payableFrom[0]?.id ?? '',
      amount: '',
      expenseDate: today(),
      payee: '',
      referenceNumber: '',
      attachmentUrl: '',
      notes: '',
    });
  };

  const save = async (): Promise<void> => {
    if (draft === null) return;

    if (parsePositiveAmountPaise(draft.amount) === null) {
      setError('Enter an amount greater than zero, to at most two decimal places.');
      return;
    }
    if (draft.categoryId === '') {
      setError('Choose what this was spent on.');
      return;
    }
    if (draft.paidFromAccountId === '') {
      setError('Choose where the money came from.');
      return;
    }

    setBusy('save');
    setError(null);

    const body = JSON.stringify({
      categoryId: draft.categoryId,
      paidFromAccountId: draft.paidFromAccountId,
      amount: draft.amount.trim(),
      expenseDate: draft.expenseDate,
      payee: draft.payee.trim(),
      referenceNumber: draft.referenceNumber.trim(),
      attachmentUrl: draft.attachmentUrl.trim(),
      notes: draft.notes.trim(),
    });

    try {
      if (draft.id === null) {
        await schoolFetch('/api/school/accounting/expenses', { method: 'POST', body });
      } else {
        await schoolFetch(`/api/school/accounting/expenses/${draft.id}`, {
          method: 'PATCH',
          body,
        });
      }
      setDraft(null);
      await load();
    } catch (caught) {
      setError(schoolErrorMessage(caught, 'Could not save the expense.'));
    } finally {
      setBusy(null);
    }
  };

  const decide = async (
    id: string,
    decision: 'approve' | 'reject',
    reason?: string,
  ): Promise<void> => {
    setBusy(id);
    setError(null);
    try {
      await schoolFetch(`/api/school/accounting/expenses/${id}/decision`, {
        method: 'POST',
        body: JSON.stringify({ decision, reason }),
      });
      setRejecting(null);
      await load();
    } catch (caught) {
      setError(schoolErrorMessage(caught, 'Could not record the decision.'));
    } finally {
      setBusy(null);
    }
  };

  const discard = async (id: string): Promise<void> => {
    setBusy(id);
    setError(null);
    try {
      await schoolFetch(`/api/school/accounting/expenses/${id}`, { method: 'DELETE' });
      await load();
    } catch (caught) {
      setError(schoolErrorMessage(caught, 'Could not discard the draft.'));
    } finally {
      setBusy(null);
    }
  };

  if (expenses === null) {
    return (
      <Card>
        <p className="text-sm text-ink-muted">Loading the expense register…</p>
      </Card>
    );
  }

  const total = expenses
    .filter((row) => row.status === 'approved')
    .reduce((sum, row) => sum + row.amountPaise, 0);

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
        <Select
          label="Show"
          className="sm:max-w-48"
          value={status}
          options={[
            { value: '', label: 'Everything' },
            ...EXPENSE_STATUSES.map((value) => ({
              value,
              label: EXPENSE_STATUS_LABELS[value],
            })),
          ]}
          onChange={(event) => setStatus(event.target.value as ExpenseStatus | '')}
        />
        {canWrite && draft === null ? (
          <Button icon={Plus} onClick={startNew}>
            File an expense
          </Button>
        ) : null}
      </div>

      {draft !== null ? (
        <Card
          header={
            <CardTitle
              title={draft.id === null ? 'File an expense' : 'Correct the draft'}
              description="Saving records it as a request. No money moves until somebody approves it."
            />
          }
        >
          <div className="grid gap-4 sm:grid-cols-2">
            <Select
              label="What it was for"
              value={draft.categoryId}
              placeholder={activeCategories.length === 0 ? 'No categories yet' : undefined}
              options={activeCategories.map((category) => ({
                value: category.id,
                label: `${category.name} → ${category.accountName}`,
              }))}
              onChange={(event) => setDraft({ ...draft, categoryId: event.target.value })}
            />
            <Select
              label="Paid from"
              value={draft.paidFromAccountId}
              options={payableFrom.map((account) => ({
                value: account.id,
                label: `${account.code} ${account.name}`,
              }))}
              hint="The account the money comes out of."
              onChange={(event) =>
                setDraft({ ...draft, paidFromAccountId: event.target.value })
              }
            />
            <Input
              label="Amount (PKR)"
              value={draft.amount}
              inputMode="decimal"
              onChange={(event) => setDraft({ ...draft, amount: event.target.value })}
            />
            <Input
              label="Date"
              type="date"
              value={draft.expenseDate}
              onChange={(event) => setDraft({ ...draft, expenseDate: event.target.value })}
            />
            <Input
              label="Paid to"
              value={draft.payee}
              hint="The shop, the landlord, the contractor."
              onChange={(event) => setDraft({ ...draft, payee: event.target.value })}
            />
            <Input
              label="Bill or receipt number"
              value={draft.referenceNumber}
              onChange={(event) =>
                setDraft({ ...draft, referenceNumber: event.target.value })
              }
            />
            <Input
              label="Link to the bill"
              value={draft.attachmentUrl}
              // A URL rather than an upload: this application stores no files
              // of its own. An expense with nothing attached is ordinary —
              // there is no receipt for a 200-rupee rickshaw fare.
              hint="Optional. A photo or scan, wherever the school keeps it."
              onChange={(event) =>
                setDraft({ ...draft, attachmentUrl: event.target.value })
              }
            />
            <Textarea
              label="Notes"
              rows={2}
              value={draft.notes}
              onChange={(event) => setDraft({ ...draft, notes: event.target.value })}
            />
          </div>
          <div className="mt-4 flex gap-2">
            <Button isLoading={busy === 'save'} onClick={() => void save()}>
              Save as a draft
            </Button>
            <Button variant="ghost" onClick={() => setDraft(null)}>
              Cancel
            </Button>
          </div>
        </Card>
      ) : null}

      {expenses.length === 0 ? (
        <EmptyState
          icon={Receipt}
          tone={status === '' ? 'empty' : 'no-result'}
          title={
            status === ''
              ? 'Nothing has been filed yet'
              : `No ${EXPENSE_STATUS_LABELS[status].toLowerCase()} expenses`
          }
          description={
            status === ''
              ? 'File the first bill and it will appear here as a request, waiting for somebody to approve it.'
              : 'Change the filter to see the rest of the register.'
          }
          secondaryAction={
            status === '' ? undefined : (
              <Button variant="ghost" onClick={() => setStatus('')}>
                Show everything
              </Button>
            )
          }
        />
      ) : (
        <Card>
          <Table caption="The expense register">
            <TableHead>
              <TableRow>
                <TableHeaderCell>Date</TableHeaderCell>
                <TableHeaderCell>What for</TableHeaderCell>
                <TableHeaderCell>Paid to</TableHeaderCell>
                <TableHeaderCell>Out of</TableHeaderCell>
                <TableHeaderCell>Status</TableHeaderCell>
                <TableHeaderCell align="numeric">Amount</TableHeaderCell>
                {canWrite ? <TableHeaderCell align="end">Actions</TableHeaderCell> : null}
              </TableRow>
            </TableHead>
            <TableBody>
              {expenses.map((row) => (
                <TableRow key={row.id}>
                  <TableCell>{row.expenseDate}</TableCell>
                  <TableCell>
                    <span className="font-medium text-ink">{row.categoryName}</span>
                    <span className="ml-2 text-xs text-ink-muted">{row.accountName}</span>
                    {row.rejectionReason !== null ? (
                      <p className="mt-1 text-xs text-status-danger-ink">
                        {row.rejectionReason}
                      </p>
                    ) : null}
                  </TableCell>
                  <TableCell muted>{row.payee ?? '—'}</TableCell>
                  <TableCell muted>{row.paidFromName}</TableCell>
                  <TableCell>
                    <Badge variant={STATUS_VARIANT[row.status]}>
                      {EXPENSE_STATUS_LABELS[row.status]}
                    </Badge>
                    {row.approverName !== null ? (
                      <span className="ml-2 text-xs text-ink-muted">
                        {row.approverName}
                      </span>
                    ) : null}
                  </TableCell>
                  <TableCell align="numeric">
                    {formatPkr(row.amountPaise / 100)}
                  </TableCell>
                  {canWrite ? (
                    <TableCell align="end">
                      {row.status === 'draft' ? (
                        <div className="flex flex-wrap justify-end gap-2">
                          <Button
                            size="sm"
                            icon={Check}
                            isLoading={busy === row.id}
                            onClick={() => void decide(row.id, 'approve')}
                          >
                            Approve
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            icon={X}
                            onClick={() => setRejecting({ id: row.id, reason: '' })}
                          >
                            Reject
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() =>
                              setDraft({
                                id: row.id,
                                categoryId: row.categoryId,
                                paidFromAccountId: row.paidFromAccountId,
                                amount: (row.amountPaise / 100).toFixed(2),
                                expenseDate: row.expenseDate,
                                payee: row.payee ?? '',
                                referenceNumber: row.referenceNumber ?? '',
                                attachmentUrl: '',
                                notes: row.notes ?? '',
                              })
                            }
                          >
                            Edit
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => void discard(row.id)}
                          >
                            Discard
                          </Button>
                        </div>
                      ) : (
                        <span className="text-xs text-ink-muted">
                          {row.status === 'approved'
                            ? 'Posted — reverse it in the day book to correct it'
                            : 'Refused — file a fresh one'}
                        </span>
                      )}
                    </TableCell>
                  ) : null}
                </TableRow>
              ))}
            </TableBody>
            <TableFoot>
              <TableRow>
                <TableCell colSpan={5}>Approved in this view</TableCell>
                <TableCell align="numeric">{formatPkr(total / 100)}</TableCell>
                {canWrite ? <TableCell /> : null}
              </TableRow>
            </TableFoot>
          </Table>
        </Card>
      )}

      {rejecting !== null ? (
        <Card header={<CardTitle title="Reject this expense" />}>
          <Textarea
            label="Why"
            rows={2}
            value={rejecting.reason}
            hint="Whoever filed it needs to know what to change."
            onChange={(event) =>
              setRejecting({ ...rejecting, reason: event.target.value })
            }
          />
          <div className="mt-4 flex gap-2">
            <Button
              variant="danger"
              isLoading={busy === rejecting.id}
              onClick={() => void decide(rejecting.id, 'reject', rejecting.reason.trim())}
            >
              Reject it
            </Button>
            <Button variant="ghost" onClick={() => setRejecting(null)}>
              Cancel
            </Button>
          </div>
        </Card>
      ) : null}
    </div>
  );
}
