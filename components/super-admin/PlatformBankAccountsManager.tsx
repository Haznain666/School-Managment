'use client';

import { useCallback, useState } from 'react';

import { Button } from '@/components/ui/Button';
import { Card, CardTitle } from '@/components/ui/Card';
import { Input } from '@/components/ui/Input';
import { Modal } from '@/components/ui/Modal';
import { ibanProblem, MAX_PLATFORM_BANK_ACCOUNTS } from '@/lib/platform-billing';
import { superAdminFetch, SuperAdminApiError } from '@/lib/super-admin-client';

/**
 * The platform's bank accounts — up to three, Pakistani only. §5.
 *
 * The IBAN is checked in the browser with the same `ibanProblem` the route
 * uses, so a transposed digit is caught while the bank letter is still in the
 * operator's hand rather than on the first invoice a school cannot pay.
 */

export interface PlatformBankAccountRow {
  id: string;
  bankName: string;
  accountTitle: string;
  accountNumber: string;
  iban: string;
  branchName: string | null;
  branchCode: string | null;
  city: string | null;
  position: number;
}

interface Draft {
  bankName: string;
  accountTitle: string;
  accountNumber: string;
  iban: string;
  branchName: string;
  branchCode: string;
  city: string;
}

const EMPTY: Draft = {
  bankName: '',
  accountTitle: '',
  accountNumber: '',
  iban: '',
  branchName: '',
  branchCode: '',
  city: '',
};

function draftOf(account: PlatformBankAccountRow): Draft {
  return {
    bankName: account.bankName,
    accountTitle: account.accountTitle,
    accountNumber: account.accountNumber,
    iban: account.iban,
    branchName: account.branchName ?? '',
    branchCode: account.branchCode ?? '',
    city: account.city ?? '',
  };
}

export interface PlatformBankAccountsManagerProps {
  initial: PlatformBankAccountRow[];
  canCreate: boolean;
  canEdit: boolean;
  canDelete: boolean;
}

export function PlatformBankAccountsManager({
  initial,
  canCreate,
  canEdit,
  canDelete,
}: PlatformBankAccountsManagerProps) {
  const [accounts, setAccounts] = useState(initial);
  /** `new`, an account id being edited, or null. */
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft>(EMPTY);
  const [deleting, setDeleting] = useState<PlatformBankAccountRow | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const ibanError = draft.iban.trim() === '' ? undefined : (ibanProblem(draft.iban) ?? undefined);

  const save = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const data =
        editing === 'new'
          ? await superAdminFetch<{ accounts: PlatformBankAccountRow[] }>(
              '/api/super-admin/billing/bank-accounts',
              { method: 'POST', body: JSON.stringify(draft) },
            )
          : await superAdminFetch<{ accounts: PlatformBankAccountRow[] }>(
              `/api/super-admin/billing/bank-accounts/${editing ?? ''}`,
              { method: 'PATCH', body: JSON.stringify(draft) },
            );
      setAccounts(data.accounts);
      setEditing(null);
      setDraft(EMPTY);
    } catch (caught) {
      setError(caught instanceof SuperAdminApiError ? caught.message : 'Could not save the account.');
    } finally {
      setBusy(false);
    }
  }, [draft, editing]);

  const remove = useCallback(async (account: PlatformBankAccountRow) => {
    setBusy(true);
    setError(null);
    try {
      const data = await superAdminFetch<{ accounts: PlatformBankAccountRow[] }>(
        `/api/super-admin/billing/bank-accounts/${account.id}`,
        { method: 'DELETE' },
      );
      setAccounts(data.accounts);
      setDeleting(null);
    } catch (caught) {
      setError(caught instanceof SuperAdminApiError ? caught.message : 'Could not remove the account.');
    } finally {
      setBusy(false);
    }
  }, []);

  const field = (key: keyof Draft, label: string, hint?: string) => (
    <Input
      label={label}
      value={draft[key]}
      disabled={busy}
      {...(hint === undefined ? {} : { hint })}
      {...(key === 'iban' && ibanError !== undefined ? { error: ibanError } : {})}
      onChange={(event) => {
        setDraft((current) => ({ ...current, [key]: event.target.value }));
      }}
    />
  );

  return (
    <div className="space-y-6">
      {error !== null ? (
        <p role="alert" className="rounded-lg bg-status-danger-subtle px-3 py-2 text-sm text-status-danger-ink">
          {error}
        </p>
      ) : null}

      <div className="grid gap-4 md:grid-cols-3">
        {accounts.map((account) => (
          <Card key={account.id}>
            <div className="space-y-1 text-sm">
              <p className="font-semibold text-ink">{account.bankName}</p>
              <p className="text-ink-muted">{account.accountTitle}</p>
              <p className="pt-2">
                Account <span className="font-mono">{account.accountNumber}</span>
              </p>
              <p>
                IBAN <span className="font-mono">{account.iban}</span>
              </p>
              <p className="text-ink-muted">
                {[account.branchName, account.branchCode, account.city]
                  .filter((part) => part !== null && part !== '')
                  .join(' · ')}
              </p>
              <div className="flex gap-2 pt-3">
                {canEdit ? (
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => {
                      setEditing(account.id);
                      setDraft(draftOf(account));
                      setError(null);
                    }}
                  >
                    Edit
                  </Button>
                ) : null}
                {canDelete ? (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      setDeleting(account);
                    }}
                  >
                    Remove
                  </Button>
                ) : null}
              </div>
            </div>
          </Card>
        ))}
      </div>

      {accounts.length === 0 ? (
        <p className="text-sm text-ink-muted">
          No accounts yet. Invoices print these as the way to pay, so add at least one before
          sending any.
        </p>
      ) : null}

      {editing === null && canCreate && accounts.length < MAX_PLATFORM_BANK_ACCOUNTS ? (
        <Button
          onClick={() => {
            setEditing('new');
            setDraft(EMPTY);
            setError(null);
          }}
        >
          Add bank account
        </Button>
      ) : null}

      {editing !== null ? (
        <Card header={<CardTitle title={editing === 'new' ? 'New bank account' : 'Edit bank account'} />}>
          <div className="space-y-4">
            <div className="grid gap-4 md:grid-cols-2">
              {field('bankName', 'Bank name')}
              {field('accountTitle', 'Account title')}
              {field('accountNumber', 'Account number')}
              {field('iban', 'IBAN', 'PK followed by 22 characters.')}
              {field('branchName', 'Branch name (optional)')}
              {field('branchCode', 'Branch code (optional)')}
              {field('city', 'City (optional)')}
            </div>
            <div className="flex gap-2">
              <Button
                isLoading={busy}
                disabled={
                  draft.bankName.trim() === '' ||
                  draft.accountTitle.trim() === '' ||
                  draft.accountNumber.trim() === '' ||
                  ibanProblem(draft.iban) !== null
                }
                onClick={() => void save()}
              >
                Save account
              </Button>
              <Button
                variant="secondary"
                disabled={busy}
                onClick={() => {
                  setEditing(null);
                  setDraft(EMPTY);
                }}
              >
                Cancel
              </Button>
            </div>
          </div>
        </Card>
      ) : null}

      <Modal
        open={deleting !== null}
        onClose={() => {
          setDeleting(null);
        }}
        title={`Remove ${deleting?.bankName ?? 'this account'}?`}
        description="Invoices already sent keep the details they were printed with."
        size="sm"
        footer={
          <>
            <Button
              variant="secondary"
              disabled={busy}
              onClick={() => {
                setDeleting(null);
              }}
            >
              Cancel
            </Button>
            <Button
              variant="danger"
              isLoading={busy}
              onClick={() => {
                if (deleting !== null) void remove(deleting);
              }}
            >
              Remove
            </Button>
          </>
        }
      >
        <p className="text-sm text-ink-muted">New invoices and PDFs stop showing it straight away.</p>
      </Modal>
    </div>
  );
}
