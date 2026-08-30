'use client';

import { useCallback, useEffect, useState } from 'react';

import { AddressAutocomplete } from '@/components/ui/AddressAutocomplete';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { DataTable, type DataTableColumn } from '@/components/ui/DataTable';
import { Input } from '@/components/ui/Input';
import { Modal } from '@/components/ui/Modal';
import { Select } from '@/components/ui/Select';
import { Textarea } from '@/components/ui/Textarea';
import { Toggle } from '@/components/ui/Toggle';
import {
  BANK_PURPOSES,
  BANK_PURPOSE_HINTS,
  BANK_PURPOSE_LABELS,
  type BankPurpose,
} from '@/db/schema/bank-accounts';
import { schoolErrorMessage, schoolFetch } from '@/lib/school-client';

/**
 * The school's bank accounts — Sprint 20, item 10.
 *
 * ── Purpose is a three-way radio, not two checkboxes ─────────────────────
 * "Students", "Staff", "Both". Two checkboxes admit a fourth state — neither
 * ticked — which is an account that exists and is for nothing, and every reader
 * of the column would then have to decide whether that meant "both" or
 * "hidden". A radio group cannot hold the answer nobody meant.
 *
 * ── Deactivating is the safe act, and the screen says so ─────────────────
 * The obvious rule — refuse a delete once an account has been printed on a
 * voucher — cannot be enforced: nothing records that a voucher was printed, and
 * a voucher snapshots none of these details. So delete stays, its confirmation
 * says in plain words that slips already in parents' hands carry these numbers
 * and will not change, and the row toggle is offered as the thing a school
 * closing an account actually wants — the number off tomorrow's vouchers, the
 * record of last month's money intact.
 *
 * ── An inactive account never prints ─────────────────────────────────────
 * That is the whole point of the toggle, and it is enforced server-side in
 * `listVoucherBankAccounts`. It is stated on the row as well, because a toggle
 * whose consequence is invisible is a toggle nobody trusts.
 */

interface BankAccountRow {
  id: string;
  branchId: string | null;
  branchName: string | null;
  accountTitle: string;
  bankName: string;
  branchNameOfBank: string | null;
  branchCode: string | null;
  accountNumber: string;
  iban: string | null;
  swiftCode: string | null;
  bankAddress: string | null;
  intermediaryBank: string | null;
  intermediarySwift: string | null;
  currency: string;
  purpose: BankPurpose;
  instructions: string | null;
  isActive: boolean;
  sortOrder: number;
}

interface BranchOption {
  id: string;
  name: string;
}

interface Draft {
  id: string | null;
  branchId: string;
  accountTitle: string;
  bankName: string;
  branchNameOfBank: string;
  branchCode: string;
  accountNumber: string;
  iban: string;
  swiftCode: string;
  bankAddress: string;
  intermediaryBank: string;
  intermediarySwift: string;
  currency: string;
  purpose: BankPurpose;
  instructions: string;
  isActive: boolean;
  sortOrder: string;
}

function emptyDraft(): Draft {
  return {
    id: null,
    branchId: '',
    accountTitle: '',
    bankName: '',
    branchNameOfBank: '',
    branchCode: '',
    accountNumber: '',
    iban: '',
    swiftCode: '',
    bankAddress: '',
    intermediaryBank: '',
    intermediarySwift: '',
    currency: 'PKR',
    purpose: 'student',
    instructions: '',
    isActive: true,
    sortOrder: '0',
  };
}

function draftFrom(row: BankAccountRow): Draft {
  return {
    id: row.id,
    branchId: row.branchId ?? '',
    accountTitle: row.accountTitle,
    bankName: row.bankName,
    branchNameOfBank: row.branchNameOfBank ?? '',
    branchCode: row.branchCode ?? '',
    accountNumber: row.accountNumber,
    iban: row.iban ?? '',
    swiftCode: row.swiftCode ?? '',
    bankAddress: row.bankAddress ?? '',
    intermediaryBank: row.intermediaryBank ?? '',
    intermediarySwift: row.intermediarySwift ?? '',
    currency: row.currency,
    purpose: row.purpose,
    instructions: row.instructions ?? '',
    isActive: row.isActive,
    sortOrder: String(row.sortOrder),
  };
}

export function BankAccountsTable({ canEdit }: { canEdit: boolean }) {
  const [accounts, setAccounts] = useState<BankAccountRow[] | null>(null);
  const [branches, setBranches] = useState<BranchOption[]>([]);
  const [canShare, setCanShare] = useState(true);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [deleting, setDeleting] = useState<BankAccountRow | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const payload = await schoolFetch<{
        accounts: BankAccountRow[];
        branches: BranchOption[];
        canShare: boolean;
      }>('/api/school/settings/banks');

      setAccounts(payload.accounts);
      setBranches(payload.branches);
      setCanShare(payload.canShare);
      setError(null);
    } catch (caught) {
      setError(schoolErrorMessage(caught, 'Could not load the bank accounts.'));
      setAccounts([]);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const save = async (): Promise<void> => {
    if (draft === null) return;

    setBusy(true);
    setError(null);

    const body = JSON.stringify({
      branchId: draft.branchId === '' ? null : draft.branchId,
      accountTitle: draft.accountTitle.trim(),
      bankName: draft.bankName.trim(),
      branchNameOfBank: draft.branchNameOfBank.trim(),
      branchCode: draft.branchCode.trim(),
      accountNumber: draft.accountNumber.trim(),
      iban: draft.iban.trim(),
      swiftCode: draft.swiftCode.trim(),
      bankAddress: draft.bankAddress.trim(),
      intermediaryBank: draft.intermediaryBank.trim(),
      intermediarySwift: draft.intermediarySwift.trim(),
      currency: draft.currency.trim(),
      purpose: draft.purpose,
      instructions: draft.instructions.trim(),
      isActive: draft.isActive,
      sortOrder: Number(draft.sortOrder) || 0,
    });

    try {
      if (draft.id === null) {
        await schoolFetch('/api/school/settings/banks', { method: 'POST', body });
        setNotice(`${draft.bankName.trim()} added.`);
      } else {
        await schoolFetch(`/api/school/settings/banks/${draft.id}`, {
          method: 'PATCH',
          body,
        });
        setNotice(`${draft.bankName.trim()} updated.`);
      }

      setDraft(null);
      await load();
    } catch (caught) {
      setError(schoolErrorMessage(caught, 'Could not save the account.'));
    } finally {
      setBusy(false);
    }
  };

  const toggle = async (row: BankAccountRow, isActive: boolean): Promise<void> => {
    setBusy(true);
    setError(null);
    setNotice(null);

    try {
      // One field, deliberately. See the route: a full-record write from a row
      // would overwrite whatever somebody else had just saved in the modal.
      await schoolFetch(`/api/school/settings/banks/${row.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ isActive }),
      });

      setNotice(
        isActive
          ? `${row.bankName} will print on new vouchers again.`
          : `${row.bankName} will not print on any new voucher. Vouchers already issued are unchanged.`,
      );
      await load();
    } catch (caught) {
      setError(schoolErrorMessage(caught, 'Could not change that account.'));
    } finally {
      setBusy(false);
    }
  };

  const remove = async (row: BankAccountRow): Promise<void> => {
    setBusy(true);
    setError(null);

    try {
      await schoolFetch(`/api/school/settings/banks/${row.id}`, { method: 'DELETE' });
      setNotice(`${row.bankName} removed.`);
      setDeleting(null);
      await load();
    } catch (caught) {
      setError(schoolErrorMessage(caught, 'Could not remove the account.'));
    } finally {
      setBusy(false);
    }
  };

  const columns: Array<DataTableColumn<BankAccountRow>> = [
    {
      id: 'bank',
      header: 'Bank',
      rowHeader: true,
      sortValue: (row) => row.bankName,
      searchValue: (row) =>
        `${row.bankName} ${row.accountTitle} ${row.accountNumber} ${row.iban ?? ''}`,
      cell: (row) => (
        <>
          <span className="block font-medium text-ink">{row.bankName}</span>
          <span className="block text-xs text-ink-muted">
            {row.accountTitle}
            {row.branchNameOfBank === null ? '' : ` · ${row.branchNameOfBank}`}
          </span>
        </>
      ),
    },
    {
      id: 'accountNumber',
      header: 'Account',
      muted: true,
      sortValue: (row) => row.accountNumber,
      cell: (row) => (
        <>
          <span className="block font-mono text-xs">{row.accountNumber}</span>
          {row.iban === null ? null : (
            <span className="block font-mono text-xs text-ink-muted">{row.iban}</span>
          )}
        </>
      ),
    },
    {
      id: 'purpose',
      header: 'For',
      muted: true,
      sortValue: (row) => BANK_PURPOSE_LABELS[row.purpose],
      cell: (row) => BANK_PURPOSE_LABELS[row.purpose],
    },
    {
      id: 'campus',
      header: 'Campus',
      muted: true,
      sortValue: (row) => row.branchName ?? '',
      // Null means shared, at every school in production today. Saying "All
      // campuses" rather than leaving the cell blank is the whole reading of
      // decision D1 — a blank cell reads as a row nobody set up.
      cell: (row) => row.branchName ?? 'All campuses',
    },
    {
      id: 'currency',
      header: 'Currency',
      muted: true,
      sortValue: (row) => row.currency,
      cell: (row) => row.currency,
    },
    {
      id: 'sortOrder',
      header: 'Print order',
      kind: 'number',
      sortValue: (row) => row.sortOrder,
      cell: (row) => row.sortOrder,
    },
    {
      id: 'isActive',
      header: 'On vouchers',
      sortValue: (row) => (row.isActive ? 1 : 0),
      cell: (row) =>
        canEdit ? (
          <Toggle
            checked={row.isActive}
            disabled={busy}
            label={row.isActive ? 'Printing' : 'Not printing'}
            onChange={(next) => {
              void toggle(row, next);
            }}
          />
        ) : (
          <Badge variant={row.isActive ? 'success' : 'neutral'}>
            {row.isActive ? 'Printing' : 'Not printing'}
          </Badge>
        ),
    },
  ];

  if (canEdit) {
    columns.push({
      id: 'actions',
      header: 'Actions',
      align: 'end',
      cell: (row) => (
        <div className="flex flex-nowrap justify-end gap-2">
          <Button
            size="sm"
            variant="secondary"
            disabled={busy}
            onClick={() => {
              setError(null);
              setNotice(null);
              setDraft(draftFrom(row));
            }}
          >
            Edit
          </Button>
          <Button
            size="sm"
            variant="ghost"
            disabled={busy}
            onClick={() => {
              setError(null);
              setNotice(null);
              setDeleting(row);
            }}
          >
            Delete
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
        <p
          role="status"
          className="rounded-lg bg-status-success-subtle px-3 py-2 text-sm text-status-success-onSubtle"
        >
          {notice}
        </p>
      )}

      {canEdit ? (
        <div className="flex justify-end">
          <Button
            size="sm"
            disabled={busy}
            onClick={() => {
              setError(null);
              setNotice(null);
              setDraft(emptyDraft());
            }}
          >
            Add bank account
          </Button>
        </div>
      ) : null}

      <DataTable
        caption="Bank accounts"
        columns={columns}
        rows={accounts ?? []}
        getRowKey={(row) => row.id}
        pending={accounts === null}
        search={{ placeholder: 'Bank, title, account number or IBAN' }}
        filters={[
          {
            id: 'purpose',
            label: 'For',
            allLabel: 'Any purpose',
            options: BANK_PURPOSES.map((value) => ({
              value,
              label: BANK_PURPOSE_LABELS[value],
            })),
            rowValue: (row) => row.purpose,
          },
        ]}
        itemNoun={{ singular: 'account', plural: 'accounts' }}
        emptyTitle="No bank accounts yet"
        emptyDescription="Add the account parents pay fees into, and the one salaries are paid from. Student-facing accounts print on every fee voucher."
        noResultTitle="No accounts match that"
        noResultDescription="Clear the search box or widen the purpose filter."
      />

      <Modal
        open={draft !== null}
        size="lg"
        title={draft?.id === null ? 'Add bank account' : 'Edit bank account'}
        description="These details print on every fee voucher raised for a student-facing account. Vouchers already printed carry whatever was here at the time and do not change."
        onClose={() => {
          if (!busy) setDraft(null);
        }}
        footer={
          <>
            <Button
              variant="secondary"
              disabled={busy}
              onClick={() => {
                setDraft(null);
              }}
            >
              Cancel
            </Button>
            <Button
              isLoading={busy}
              disabled={
                draft === null ||
                draft.bankName.trim() === '' ||
                draft.accountTitle.trim() === '' ||
                draft.accountNumber.trim() === ''
              }
              onClick={() => {
                void save();
              }}
            >
              Save account
            </Button>
          </>
        }
      >
        {draft === null ? null : (
          <div className="grid gap-4 sm:grid-cols-2">
            {/*
              Purpose first, and as a radio group (item 10). It decides whether
              this number reaches a parent at all, which is the one thing on
              this form somebody must not answer by accident.
            */}
            <fieldset className="sm:col-span-2">
              <legend className="mb-1.5 block text-sm font-medium text-ink">
                This account is for
              </legend>
              <div className="flex flex-col gap-2">
                {BANK_PURPOSES.map((value) => (
                  <label key={value} className="flex items-start gap-2 text-sm text-ink">
                    <input
                      type="radio"
                      name="bankPurpose"
                      value={value}
                      checked={draft.purpose === value}
                      disabled={busy}
                      className="mt-0.5 h-4 w-4 accent-brand-primary"
                      onChange={() => {
                        setDraft({ ...draft, purpose: value });
                      }}
                    />
                    <span>
                      <span className="block">{BANK_PURPOSE_LABELS[value]}</span>
                      <span className="block text-xs text-ink-muted">
                        {BANK_PURPOSE_HINTS[value]}
                      </span>
                    </span>
                  </label>
                ))}
              </div>
            </fieldset>

            <Input
              label="Account title"
              required
              hint="Exactly as the bank holds it — this is who a cheque is made out to."
              value={draft.accountTitle}
              disabled={busy}
              onChange={(event) => {
                setDraft({ ...draft, accountTitle: event.target.value });
              }}
            />

            <Input
              label="Bank name"
              required
              value={draft.bankName}
              disabled={busy}
              onChange={(event) => {
                setDraft({ ...draft, bankName: event.target.value });
              }}
            />

            <Input
              label="Account number"
              required
              value={draft.accountNumber}
              disabled={busy}
              onChange={(event) => {
                setDraft({ ...draft, accountNumber: event.target.value });
              }}
            />

            <Input
              label="IBAN"
              hint="Optional. Printed under the account number when set."
              value={draft.iban}
              disabled={busy}
              onChange={(event) => {
                setDraft({ ...draft, iban: event.target.value });
              }}
            />

            <Input
              label="Bank branch"
              hint="The bank's branch, not your campus."
              value={draft.branchNameOfBank}
              disabled={busy}
              onChange={(event) => {
                setDraft({ ...draft, branchNameOfBank: event.target.value });
              }}
            />

            <Input
              label="Branch code"
              value={draft.branchCode}
              disabled={busy}
              onChange={(event) => {
                setDraft({ ...draft, branchCode: event.target.value });
              }}
            />

            <Input
              label="Currency"
              hint="Three letters, e.g. PKR."
              value={draft.currency}
              disabled={busy}
              onChange={(event) => {
                setDraft({ ...draft, currency: event.target.value });
              }}
            />

            <Input
              label="Print order"
              type="number"
              min={0}
              max={999}
              hint="Lower prints first on the voucher."
              value={draft.sortOrder}
              disabled={busy}
              onChange={(event) => {
                setDraft({ ...draft, sortOrder: event.target.value });
              }}
            />

            {branches.length > 0 ? (
              <div className="sm:col-span-2">
                <Select
                  label="Campus"
                  hint="An account left as All campuses prints on every campus's vouchers."
                  options={[
                    ...(canShare ? [{ value: '', label: 'All campuses' }] : []),
                    ...branches.map((branch) => ({
                      value: branch.id,
                      label: branch.name,
                    })),
                  ]}
                  value={draft.branchId}
                  disabled={busy}
                  onChange={(event) => {
                    setDraft({ ...draft, branchId: event.target.value });
                  }}
                />
              </div>
            ) : null}

            {/*
              The international block. A school that banks only in Pakistan
              leaves all three blank and nothing about them reaches the paper.
            */}
            <Input
              label="SWIFT / BIC"
              hint="For an overseas transfer. Printed only when set."
              value={draft.swiftCode}
              disabled={busy}
              onChange={(event) => {
                setDraft({ ...draft, swiftCode: event.target.value });
              }}
            />

            <Input
              label="Intermediary SWIFT"
              value={draft.intermediarySwift}
              disabled={busy}
              onChange={(event) => {
                setDraft({ ...draft, intermediarySwift: event.target.value });
              }}
            />

            <div className="sm:col-span-2">
              <Input
                label="Intermediary bank"
                value={draft.intermediaryBank}
                disabled={busy}
                onChange={(event) => {
                  setDraft({ ...draft, intermediaryBank: event.target.value });
                }}
              />
            </div>

            <div className="sm:col-span-2">
              {/*
                `AddressAutocomplete`, like every address field in this product
                — CLAUDE.md's rule and `npm run check-address-phone`. A bank's
                branch address is a postal address and the search helps somebody
                type one; `withCoordinates={false}` because `bank_accounts` has
                no latitude or longitude to save a pin into, and offering one
                would read as data loss on the next Save.
              */}
              <AddressAutocomplete
                label="Bank address"
                multiline
                rows={2}
                withCoordinates={false}
                value={{ address: draft.bankAddress, latitude: null, longitude: null }}
                disabled={busy}
                onChange={(next) => {
                  setDraft({ ...draft, bankAddress: next.address });
                }}
              />
            </div>

            <div className="sm:col-span-2">
              <Textarea
                label="Instructions"
                rows={2}
                hint="Printed under this account on the voucher, e.g. how to reference a transfer."
                value={draft.instructions}
                disabled={busy}
                onChange={(event) => {
                  setDraft({ ...draft, instructions: event.target.value });
                }}
              />
            </div>

            <div className="sm:col-span-2">
              <Toggle
                checked={draft.isActive}
                disabled={busy}
                label="Print this account on vouchers"
                description="Switch it off to take the number off new vouchers without losing the record of it."
                onChange={(next) => {
                  setDraft({ ...draft, isActive: next });
                }}
              />
            </div>
          </div>
        )}
      </Modal>

      <Modal
        open={deleting !== null}
        title="Remove this bank account?"
        description="This cannot be undone."
        onClose={() => {
          if (!busy) setDeleting(null);
        }}
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
        {deleting === null ? null : (
          <div className="space-y-3 text-sm text-ink">
            <p>
              <span className="font-medium">{deleting.bankName}</span> —{' '}
              <span className="font-mono text-xs">{deleting.accountNumber}</span>
            </p>
            {/*
              Said plainly, because it cannot be enforced. Nothing records that
              a voucher was printed and a voucher snapshots none of these
              details, so the confirmation is the only place this fact exists.
            */}
            <p className="text-ink-muted">
              Vouchers already printed carry these details and will not change.
              Removing the account only stops it appearing on new ones.
            </p>
            <p className="rounded-lg bg-surface-sunken px-3 py-2 text-ink-muted">
              If the school has simply closed this account,{' '}
              <span className="font-medium text-ink">switching it off</span> is the
              safer act: the number comes off new vouchers straight away and the
              record of where last month&apos;s money went stays.
            </p>
          </div>
        )}
      </Modal>
    </div>
  );
}
