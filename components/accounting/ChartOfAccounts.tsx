'use client';

import { Plus, Scale } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';

import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card, CardTitle } from '@/components/ui/Card';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { DataTable, type DataTableColumn } from '@/components/ui/DataTable';
import { SkeletonTable } from '@/components/ui/Skeleton';
import { Textarea } from '@/components/ui/Textarea';
import {
  ACCOUNT_TYPE_DESCRIPTIONS,
  ACCOUNT_TYPE_LABELS,
  LEDGER_ACCOUNT_TYPES,
  isAccountCode,
  suggestAccountCode,
  type LedgerAccountType,
} from '@/lib/accounting';
import { schoolErrorMessage, schoolFetch } from '@/lib/school-client';

/**
 * The chart of accounts.
 *
 * ── Three things this screen is careful about ────────────────────────────
 *
 * 1. **A system account is marked and cannot be switched off.** It can be
 *    renamed and re-coded freely — the software finds it by `system_key`, which
 *    is not editable from anywhere — but switching off Fee Income would leave
 *    the next payment at the counter with nowhere to post.
 *
 * 2. **There is no delete.** An account that has been posted to is part of the
 *    history of the school's money. The row says "Switch off", the sentence
 *    under it says what that means, and neither pretends a delete exists that
 *    would work on Tuesday and refuse on Wednesday.
 *
 * 3. **The suggested code is a suggestion.** `suggestAccountCode` proposes the
 *    first free ten in the type's range and the field is typed over freely; a
 *    school that codes its accounts its own way is not fighting a form.
 */

interface AccountRow {
  id: string;
  code: string;
  name: string;
  type: LedgerAccountType;
  description: string | null;
  systemKey: string | null;
  isActive: boolean;
  ownerName: string | null;
  branchName: string | null;
}

export interface ChartOfAccountsProps {
  canEdit: boolean;
}

interface Draft {
  id: string | null;
  code: string;
  name: string;
  type: LedgerAccountType;
  description: string;
}

const TYPE_OPTIONS = LEDGER_ACCOUNT_TYPES.map((value) => ({
  value,
  label: ACCOUNT_TYPE_LABELS[value],
}));

export function ChartOfAccounts({ canEdit }: ChartOfAccountsProps) {
  const [accounts, setAccounts] = useState<AccountRow[] | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const payload = await schoolFetch<{ accounts: AccountRow[] }>(
        '/api/school/accounting/accounts',
      );
      setAccounts(payload.accounts);
      setError(null);
    } catch (caught) {
      setError(schoolErrorMessage(caught, 'Could not load the chart of accounts.'));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const seed = async (): Promise<void> => {
    setBusy('seed');
    setError(null);
    try {
      await schoolFetch('/api/school/accounting/accounts', { method: 'PUT' });
      await load();
    } catch (caught) {
      setError(schoolErrorMessage(caught, 'The chart of accounts could not be created.'));
    } finally {
      setBusy(null);
    }
  };

  const startNew = (): void => {
    const codes = (accounts ?? []).map((account) => account.code);
    setDraft({
      id: null,
      code: suggestAccountCode('expense', codes),
      name: '',
      type: 'expense',
      description: '',
    });
  };

  // Re-suggests the code when the type changes, but only while the field still
  // holds a suggestion this component made. Somebody who has typed their own
  // code keeps it.
  const changeType = (type: LedgerAccountType): void => {
    setDraft((current) => {
      if (current === null) return current;
      const codes = (accounts ?? []).map((account) => account.code);
      const suggestedForOld = suggestAccountCode(current.type, codes);
      return {
        ...current,
        type,
        code:
          current.code === suggestedForOld || current.code === ''
            ? suggestAccountCode(type, codes)
            : current.code,
      };
    });
  };

  const save = async (): Promise<void> => {
    if (draft === null) return;

    const name = draft.name.trim();
    if (name === '') {
      setError('Give the account a name.');
      return;
    }
    if (!isAccountCode(draft.code)) {
      setError('An account code is three to eight digits — 5600, for example.');
      return;
    }

    setBusy('save');
    setError(null);

    const body = JSON.stringify({
      code: draft.code,
      name,
      type: draft.type,
      description: draft.description.trim(),
    });

    try {
      if (draft.id === null) {
        await schoolFetch('/api/school/accounting/accounts', { method: 'POST', body });
      } else {
        await schoolFetch(`/api/school/accounting/accounts/${draft.id}`, {
          method: 'PATCH',
          body,
        });
      }
      setDraft(null);
      await load();
    } catch (caught) {
      setError(schoolErrorMessage(caught, 'Could not save the account.'));
    } finally {
      setBusy(null);
    }
  };

  const toggleActive = async (row: AccountRow): Promise<void> => {
    setBusy(row.id);
    setError(null);
    try {
      await schoolFetch(`/api/school/accounting/accounts/${row.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ isActive: !row.isActive }),
      });
      await load();
    } catch (caught) {
      setError(schoolErrorMessage(caught, 'Could not update the account.'));
    } finally {
      setBusy(null);
    }
  };

  if (accounts === null) {
    return <SkeletonTable rows={8} columns={5} />;
  }

  const columns: Array<DataTableColumn<AccountRow>> = [
    {
      id: 'code',
      header: 'Code',
      kind: 'number',
      sortValue: (row) => Number(row.code),
      searchValue: (row) => row.code,
      cell: (row) => row.code,
    },
    {
      id: 'name',
      header: 'Account',
      sortValue: (row) => row.name,
      searchValue: (row) => `${row.name} ${row.ownerName ?? ''} ${row.branchName ?? ''}`,
      cell: (row) => (
        <>
          <span className="font-medium text-ink">{row.name}</span>
          {row.ownerName !== null ? (
            <span className="ml-2 text-xs text-ink-muted">
              {row.ownerName}&rsquo;s drawer
            </span>
          ) : null}
          {row.branchName !== null ? (
            <span className="ml-2 text-xs text-ink-muted">{row.branchName}</span>
          ) : null}
        </>
      ),
    },
    {
      id: 'type',
      header: 'Type',
      sortValue: (row) => ACCOUNT_TYPE_LABELS[row.type],
      cell: (row) => ACCOUNT_TYPE_LABELS[row.type],
    },
    {
      id: 'notes',
      header: 'Notes',
      muted: true,
      searchValue: (row) => row.description ?? '',
      cell: (row) => (
        <div className="flex flex-wrap items-center gap-2">
          {row.systemKey !== null ? <Badge variant="info">Posted to automatically</Badge> : null}
          {!row.isActive ? <Badge variant="neutral">Switched off</Badge> : null}
          {row.description !== null ? <span className="text-xs">{row.description}</span> : null}
        </div>
      ),
    },
  ];

  if (canEdit) {
    columns.push({
      id: 'actions',
      header: 'Actions',
      align: 'end',
      cell: (row) => (
        <div className="flex justify-end gap-2">
          <Button
            size="sm"
            variant="ghost"
            onClick={() =>
              setDraft({
                id: row.id,
                code: row.code,
                name: row.name,
                type: row.type,
                description: row.description ?? '',
              })
            }
          >
            Edit
          </Button>
          <Button
            size="sm"
            variant="ghost"
            isLoading={busy === row.id}
            // A system account has nowhere else for the software to post, so
            // the control is absent rather than present and refusing.
            disabled={row.systemKey !== null && row.isActive}
            onClick={() => void toggleActive(row)}
          >
            {row.isActive ? 'Switch off' : 'Switch on'}
          </Button>
        </div>
      ),
    });
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

      {accounts.length === 0 ? (
        <Card>
          <h3 className="text-base font-semibold text-ink">Setup required</h3>
          <p className="mt-1 text-sm text-ink-muted">
            This school has no accounts, so nothing can be posted — fee payments taken
            now are not reaching the books. Setting up creates the fifteen heads a
            Pakistani school actually uses, and the expense categories that go with
            them. Rename, re-code or add to any of it afterwards.
          </p>
          {canEdit ? (
            <Button
              className="mt-4"
              icon={Scale}
              isLoading={busy === 'seed'}
              onClick={() => void seed()}
            >
              Set up the chart of accounts
            </Button>
          ) : null}
        </Card>
      ) : null}

      {draft !== null ? (
        <Card header={<CardTitle title={draft.id === null ? 'New account' : 'Edit account'} />}>
          <div className="grid gap-4 sm:grid-cols-2">
            <Select
              label="Type"
              options={TYPE_OPTIONS}
              value={draft.type}
              // The type of an existing account is not editable: entries have
              // already been posted against it on the assumption that debits
              // grow it, and flipping that would invert every balance it has
              // ever carried without touching a single entry.
              disabled={draft.id !== null}
              hint={ACCOUNT_TYPE_DESCRIPTIONS[draft.type]}
              onChange={(event) => changeType(event.target.value as LedgerAccountType)}
            />
            <Input
              label="Code"
              value={draft.code}
              inputMode="numeric"
              hint="Digits only. The chart sorts by it."
              onChange={(event) =>
                setDraft({ ...draft, code: event.target.value.replace(/\D/g, '') })
              }
            />
            <Input
              label="Name"
              value={draft.name}
              onChange={(event) => setDraft({ ...draft, name: event.target.value })}
            />
            <Textarea
              label="What it is for"
              value={draft.description}
              rows={2}
              onChange={(event) => setDraft({ ...draft, description: event.target.value })}
            />
          </div>
          <div className="mt-4 flex gap-2">
            <Button isLoading={busy === 'save'} onClick={() => void save()}>
              Save
            </Button>
            <Button variant="ghost" onClick={() => setDraft(null)}>
              Cancel
            </Button>
          </div>
        </Card>
      ) : null}

      {accounts.length > 0 ? (
        <Card
          header={
            <CardTitle
              title="Chart of accounts"
              description="Every head this school posts to."
              action={
                canEdit && draft === null ? (
                  <Button size="sm" variant="secondary" icon={Plus} onClick={startNew}>
                    Add an account
                  </Button>
                ) : undefined
              }
            />
          }
        >
          <DataTable
            caption="The school's chart of accounts"
            columns={columns}
            rows={accounts}
            getRowKey={(row) => row.id}
            defaultSort={{ columnId: 'code', direction: 'asc' }}
            rowClassName={(row) => (row.isActive ? undefined : 'opacity-60')}
            search={{ placeholder: 'Code or account name' }}
            filters={[
              {
                id: 'type',
                label: 'Type',
                allLabel: 'Every type',
                options: TYPE_OPTIONS,
                rowValue: (row) => row.type,
              },
              {
                id: 'status',
                label: 'Status',
                allLabel: 'On and off',
                options: [
                  { value: 'active', label: 'Switched on' },
                  { value: 'inactive', label: 'Switched off' },
                ],
                rowValue: (row) => (row.isActive ? 'active' : 'inactive'),
              },
            ]}
            itemNoun={{ singular: 'account', plural: 'accounts' }}
            emptyTitle="No accounts"
            emptyDescription="Set up the chart of accounts to start posting."
          />
          <p className="mt-3 text-xs text-ink-muted">
            An account is never deleted. Switching one off takes it out of the pickers
            and leaves it on the statements, because the entries already posted against
            it are part of the history of this school&rsquo;s money.
          </p>
        </Card>
      ) : null}
    </div>
  );
}
