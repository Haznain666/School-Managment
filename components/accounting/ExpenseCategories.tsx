'use client';

import { Plus } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';

import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card, CardTitle } from '@/components/ui/Card';
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
import { schoolErrorMessage, schoolFetch } from '@/lib/school-client';

/**
 * Expense categories.
 *
 * A category is the word a clerk picks from; the account it points at is where
 * the money lands. Two categories may point at one head — "Van Fuel" and "Van
 * Repairs" are both Transport & Fuel — and that is the reason they are two
 * things rather than one.
 *
 * ── The account is set once ──────────────────────────────────────────────
 * Editing here renames and switches off, and nothing else. Expenses already
 * filed under a category were posted to the head it had at the time, so
 * repointing it would make the category's name disagree with the entries it
 * produced. A school that wants a different head makes a new category and
 * switches this one off, which leaves the history readable.
 */

interface CategoryRow {
  id: string;
  name: string;
  isActive: boolean;
  ledgerAccountId: string;
  accountCode: string;
  accountName: string;
  expenseCount: number;
}

interface AccountRow {
  id: string;
  code: string;
  name: string;
  type: string;
  isActive: boolean;
}

export interface ExpenseCategoriesProps {
  canEdit: boolean;
}

export function ExpenseCategories({ canEdit }: ExpenseCategoriesProps) {
  const [categories, setCategories] = useState<CategoryRow[] | null>(null);
  const [accounts, setAccounts] = useState<AccountRow[]>([]);
  const [draft, setDraft] = useState<{ name: string; ledgerAccountId: string } | null>(
    null,
  );
  const [renaming, setRenaming] = useState<{ id: string; name: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [categoryPayload, accountPayload] = await Promise.all([
        schoolFetch<{ categories: CategoryRow[] }>(
          '/api/school/accounting/expense-categories',
        ),
        schoolFetch<{ accounts: AccountRow[] }>(
          '/api/school/accounting/accounts?active=true',
        ),
      ]);
      setCategories(categoryPayload.categories);
      setAccounts(accountPayload.accounts);
      setError(null);
    } catch (caught) {
      setError(schoolErrorMessage(caught, 'Could not load the expense categories.'));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const expenseAccounts = accounts.filter((account) => account.type === 'expense');

  const create = async (): Promise<void> => {
    if (draft === null) return;
    if (draft.name.trim() === '') {
      setError('Give the category a name.');
      return;
    }
    if (draft.ledgerAccountId === '') {
      setError('Choose the account it posts to.');
      return;
    }

    setBusy('save');
    setError(null);
    try {
      await schoolFetch('/api/school/accounting/expense-categories', {
        method: 'POST',
        body: JSON.stringify({
          name: draft.name.trim(),
          ledgerAccountId: draft.ledgerAccountId,
        }),
      });
      setDraft(null);
      await load();
    } catch (caught) {
      setError(schoolErrorMessage(caught, 'Could not create the category.'));
    } finally {
      setBusy(null);
    }
  };

  const patch = async (id: string, body: object): Promise<void> => {
    setBusy(id);
    setError(null);
    try {
      await schoolFetch(`/api/school/accounting/expense-categories/${id}`, {
        method: 'PATCH',
        body: JSON.stringify(body),
      });
      setRenaming(null);
      await load();
    } catch (caught) {
      setError(schoolErrorMessage(caught, 'Could not update the category.'));
    } finally {
      setBusy(null);
    }
  };

  if (categories === null) {
    return (
      <Card>
        <p className="text-sm text-ink-muted">Loading the categories…</p>
      </Card>
    );
  }

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

      {draft !== null ? (
        <Card header={<CardTitle title="New category" />}>
          <div className="grid gap-4 sm:grid-cols-2">
            <Input
              label="Name"
              value={draft.name}
              hint="The words a clerk will pick from — “Van Fuel”, not “Transport”."
              onChange={(event) => setDraft({ ...draft, name: event.target.value })}
            />
            <Select
              label="Posts to"
              value={draft.ledgerAccountId}
              placeholder="Choose an expense account"
              options={expenseAccounts.map((account) => ({
                value: account.id,
                label: `${account.code} ${account.name}`,
              }))}
              hint="Set once. It cannot be changed after expenses have been filed under it."
              onChange={(event) =>
                setDraft({ ...draft, ledgerAccountId: event.target.value })
              }
            />
          </div>
          <div className="mt-4 flex gap-2">
            <Button isLoading={busy === 'save'} onClick={() => void create()}>
              Create
            </Button>
            <Button variant="ghost" onClick={() => setDraft(null)}>
              Cancel
            </Button>
          </div>
        </Card>
      ) : null}

      <Card
        header={
          <CardTitle
            title="Expense categories"
            description="What a bill can be filed under, and the head each one posts to."
            action={
              canEdit && draft === null ? (
                <Button
                  size="sm"
                  variant="secondary"
                  icon={Plus}
                  onClick={() => setDraft({ name: '', ledgerAccountId: '' })}
                >
                  Add a category
                </Button>
              ) : undefined
            }
          />
        }
      >
        <Table caption="Expense categories and the accounts they post to">
          <TableHead>
            <TableRow>
              <TableHeaderCell>Category</TableHeaderCell>
              <TableHeaderCell>Posts to</TableHeaderCell>
              <TableHeaderCell align="numeric">Filed</TableHeaderCell>
              {canEdit ? <TableHeaderCell align="end">Actions</TableHeaderCell> : null}
            </TableRow>
          </TableHead>
          <TableBody>
            {categories.map((row) => (
              <TableRow key={row.id}>
                <TableCell>
                  {renaming?.id === row.id ? (
                    <Input
                      label="Name"
                      hideLabel
                      value={renaming.name}
                      onChange={(event) =>
                        setRenaming({ id: row.id, name: event.target.value })
                      }
                    />
                  ) : (
                    <>
                      <span className="font-medium text-ink">{row.name}</span>
                      {!row.isActive ? (
                        <Badge className="ml-2" variant="neutral">
                          Switched off
                        </Badge>
                      ) : null}
                    </>
                  )}
                </TableCell>
                <TableCell muted>
                  {row.accountCode} {row.accountName}
                </TableCell>
                <TableCell align="numeric">{row.expenseCount}</TableCell>
                {canEdit ? (
                  <TableCell align="end">
                    <div className="flex justify-end gap-2">
                      {renaming?.id === row.id ? (
                        <>
                          <Button
                            size="sm"
                            isLoading={busy === row.id}
                            onClick={() =>
                              void patch(row.id, { name: renaming.name.trim() })
                            }
                          >
                            Save
                          </Button>
                          <Button size="sm" variant="ghost" onClick={() => setRenaming(null)}>
                            Cancel
                          </Button>
                        </>
                      ) : (
                        <>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => setRenaming({ id: row.id, name: row.name })}
                          >
                            Rename
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            isLoading={busy === row.id}
                            onClick={() => void patch(row.id, { isActive: !row.isActive })}
                          >
                            {row.isActive ? 'Switch off' : 'Switch on'}
                          </Button>
                        </>
                      )}
                    </div>
                  </TableCell>
                ) : null}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>
    </div>
  );
}
