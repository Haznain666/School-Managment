'use client';

import { useCallback, useEffect, useState } from 'react';

import { FamilyVoucherRegister } from '@/components/fees/FamilyVoucherRegister';
import { Button } from '@/components/ui/Button';
import { Card, CardTitle } from '@/components/ui/Card';
import { DataTable, type DataTableColumn } from '@/components/ui/DataTable';
import { Input } from '@/components/ui/Input';
import { Modal } from '@/components/ui/Modal';
import { formatDateOnly, formatMonthYear } from '@/lib/dates';
import { formatPkr, toPaise } from '@/lib/money';
import { formatPhoneForDisplay } from '@/lib/phone-formats';
import { schoolErrorMessage, schoolFetch } from '@/lib/school-client';

/**
 * Family vouchers: one slip for a parent with several children.
 *
 * ── The shape of the screen, and why it changed ──────────────────────────
 * The listing of families that could take one voucher **this month** is now the
 * first thing on the page, most children first and then largest total. That is
 * the whole reason the screen exists and it was buried under a month picker,
 * below a table whose widest column was a list of children's names — a list of
 * *pupils* where the reader wanted a list of *families*. The names belong in
 * step 3, where somebody is choosing between them.
 *
 * ── The wizard is three questions, in the order a clerk asks them ────────
 * *Which family* — a real search with a button, because it is a server round
 * trip over every open voucher in the school and a debounce firing per keystroke
 * against that is what "the search does not work" describes.
 *
 * *Which month* — a family with three children owing since June has three
 * months to choose between, and clubbing across months would produce a total
 * that matches no set of slips the parent is holding.
 *
 * *What to club* — every open voucher for that month, each one selectable, with
 * a running total. The generator re-reads them anyway; the selection is what
 * the clerk means, not what the browser last saw.
 */

interface FamilyCandidate {
  guardianId: string;
  guardianName: string;
  phone: string;
  email: string | null;
  children: Array<{ studentProfileId: string; studentName: string; studentNumber: string }>;
  openMonths: Array<{
    billingMonth: number;
    billingYear: number;
    count: number;
    total: string;
  }>;
  openTotal: string;
}

interface FamilyVoucher {
  challanId: string;
  studentProfileId: string;
  studentName: string;
  studentNumber: string;
  challanNumber: string;
  dueDate: string;
  totalAmount: string;
  paidAmount: string;
  status: string;
}

export interface FamilyVouchersProps {
  canWrite: boolean;
  defaultMonth: number;
  defaultYear: number;
}

export function FamilyVouchers({
  canWrite,
  defaultMonth,
  defaultYear,
}: FamilyVouchersProps) {
  /* ---------------------------------------------------------- the listing */
  const [candidates, setCandidates] = useState<FamilyCandidate[] | null>(null);
  const [listError, setListError] = useState<string | null>(null);
  const [issuedToken, setIssuedToken] = useState(0);

  const loadCandidates = useCallback(async () => {
    setCandidates(null);
    try {
      const payload = await schoolFetch<{ families: FamilyCandidate[] }>(
        `/api/school/family-challans?month=${String(defaultMonth)}&year=${String(defaultYear)}`,
      );
      setCandidates(payload.families);
      setListError(null);
    } catch (caught) {
      setListError(schoolErrorMessage(caught, 'Could not read this month’s vouchers.'));
      setCandidates([]);
    }
  }, [defaultMonth, defaultYear]);

  useEffect(() => {
    void loadCandidates();
  }, [loadCandidates, issuedToken]);

  /* ----------------------------------------------------------- the wizard */
  const [query, setQuery] = useState('');
  const [searching, setSearching] = useState(false);
  const [results, setResults] = useState<FamilyCandidate[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  /** Step 2: the family whose months are being chosen between. */
  const [family, setFamily] = useState<FamilyCandidate | null>(null);
  /** Step 3: the chosen month, and that family's vouchers in it. */
  const [period, setPeriod] = useState<{ month: number; year: number } | null>(null);
  const [vouchers, setVouchers] = useState<FamilyVoucher[] | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [dueDate, setDueDate] = useState('');
  const [issuing, setIssuing] = useState(false);

  const search = async (): Promise<void> => {
    setSearching(true);
    setError(null);
    setNotice(null);

    try {
      const payload = await schoolFetch<{ families: FamilyCandidate[] }>(
        `/api/school/family-challans/search?q=${encodeURIComponent(query.trim())}`,
      );
      setResults(payload.families);
    } catch (caught) {
      setResults([]);
      setError(schoolErrorMessage(caught, 'Could not search for that family.'));
    } finally {
      setSearching(false);
    }
  };

  const openMonths = (candidate: FamilyCandidate): void => {
    setError(null);
    setNotice(null);
    setFamily(candidate);
    setPeriod(null);
    setVouchers(null);
    setSelected([]);
  };

  const chooseMonth = async (month: number, year: number): Promise<void> => {
    if (family === null) return;

    setPeriod({ month, year });
    setVouchers(null);

    try {
      const payload = await schoolFetch<{ vouchers: FamilyVoucher[] }>(
        `/api/school/family-challans?month=${String(month)}&year=${String(year)}&guardianId=${family.guardianId}`,
      );
      setVouchers(payload.vouchers);
      // Everything ticked to begin with: clubbing all of a month is the
      // ordinary case, and un-ticking one is easier than ticking four.
      setSelected(payload.vouchers.map((voucher) => voucher.challanId));
    } catch (caught) {
      setVouchers([]);
      setError(schoolErrorMessage(caught, 'Could not read that family’s vouchers.'));
    }
  };

  const issue = async (): Promise<void> => {
    if (family === null) return;

    setIssuing(true);
    setError(null);

    try {
      const payload = await schoolFetch<{
        result: { challanNumber: string; total: string; members: number };
      }>('/api/school/family-challans', {
        method: 'POST',
        body: JSON.stringify({
          guardianId: family.guardianId,
          challanIds: selected,
          dueDate,
        }),
      });

      setNotice(
        `${payload.result.challanNumber} issued for ${family.guardianName} — ` +
          `${String(payload.result.members)} children, ${formatPkr(payload.result.total)}.`,
      );
      setFamily(null);
      setPeriod(null);
      setVouchers(null);
      setSelected([]);
      setResults(null);
      setQuery('');
      setIssuedToken((token) => token + 1);
    } catch (caught) {
      setError(schoolErrorMessage(caught, 'Could not issue that voucher.'));
    } finally {
      setIssuing(false);
    }
  };

  const selectedTotalPaise = (vouchers ?? [])
    .filter((voucher) => selected.includes(voucher.challanId))
    .reduce((sum, voucher) => sum + toPaise(voucher.totalAmount), 0);

  /*
   * No Children column.
   *
   * A list of families answers "which family", and four names in a cell is what
   * pushed the total — the figure the reader is comparing rows on — off the
   * right of the screen. The names are in step 3, where they are being chosen
   * between rather than read past.
   */
  const candidateColumns: Array<DataTableColumn<FamilyCandidate>> = [
    {
      id: 'family',
      header: 'Family',
      rowHeader: true,
      sortValue: (row) => row.guardianName,
      searchValue: (row) =>
        `${row.guardianName} ${row.phone} ${row.children
          .map((child) => `${child.studentName} ${child.studentNumber}`)
          .join(' ')}`,
      cell: (row) => (
        <>
          {row.guardianName}
          <span className="block font-mono text-xs font-normal text-ink-muted">
            {formatPhoneForDisplay(row.phone)}
          </span>
        </>
      ),
    },
    {
      id: 'children',
      header: 'Children',
      kind: 'number',
      sortValue: (row) => row.children.length,
      cell: (row) => row.children.length,
    },
    {
      id: 'total',
      header: 'Open total',
      kind: 'money',
      className: 'font-mono',
      sortValue: (row) => toPaise(row.openTotal),
      cell: (row) => formatPkr(row.openTotal),
    },
  ];

  if (canWrite) {
    candidateColumns.push({
      id: 'club',
      header: 'Action',
      align: 'end',
      cell: (row) => (
        <Button
          size="sm"
          variant="secondary"
          onClick={() => {
            openMonths(row);
          }}
        >
          Club these
        </Button>
      ),
    });
  }

  return (
    <div className="space-y-6">
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

      <Card
        className="p-0"
        header={
          <CardTitle
            title={`Families that could take one voucher — ${formatMonthYear(defaultMonth, defaultYear)}`}
            description="Most children first, then the largest total. Two or more children with something open this month, sharing a contact."
          />
        }
      >
        {listError === null ? null : (
          <p className="px-5 pt-4 text-sm text-status-danger-ink">{listError}</p>
        )}

        <DataTable
          caption="Families that could share one voucher"
          columns={candidateColumns}
          rows={candidates ?? []}
          getRowKey={(row) => row.guardianId}
          pending={candidates === null}
          search={{ placeholder: 'Guardian, phone or child' }}
          itemNoun={{ singular: 'family', plural: 'families' }}
          emptyTitle="Nothing to combine this month"
          emptyDescription="No family has more than one open voucher for this month."
          noResultTitle="No families match that search"
          noResultDescription="Clear it, or use the search below to look across every month."
        />
      </Card>

      {canWrite ? (
        <Card
          header={
            <CardTitle
              title="Find a family"
              description="Search a parent or a child by name, admission number or phone — across every month, not only this one."
            />
          }
        >
          <div className="flex flex-wrap items-end gap-3">
            <div className="w-full sm:w-96">
              <Input
                label="Search"
                placeholder="e.g. Ahmed, GVS-2025-0011, 0321"
                value={query}
                disabled={searching}
                onChange={(event) => {
                  setQuery(event.target.value);
                }}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' && query.trim().length >= 2) void search();
                }}
              />
            </div>
            <Button
              isLoading={searching}
              disabled={query.trim().length < 2}
              onClick={() => {
                void search();
              }}
            >
              Search
            </Button>
          </div>

          {results === null ? null : results.length === 0 ? (
            <p className="mt-4 text-sm text-ink-muted">
              No family with more than one child matched that. A single child does
              not need a family voucher.
            </p>
          ) : (
            <ul className="mt-4 divide-y divide-line">
              {results.map((candidate) => (
                <li
                  key={candidate.guardianId}
                  className="flex flex-wrap items-center justify-between gap-3 py-3"
                >
                  <div className="min-w-0">
                    <p className="font-medium text-ink">{candidate.guardianName}</p>
                    <p className="font-mono text-xs text-ink-muted">
                      {formatPhoneForDisplay(candidate.phone)}
                      {candidate.email === null ? '' : ` · ${candidate.email}`}
                    </p>
                    <p className="mt-0.5 text-sm text-ink-muted">
                      {candidate.children
                        .map((child) => child.studentName)
                        .join(', ')}
                    </p>
                  </div>

                  <div className="flex items-center gap-3">
                    <span className="font-mono text-sm text-ink">
                      {formatPkr(candidate.openTotal)}
                    </span>
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() => {
                        openMonths(candidate);
                      }}
                    >
                      Choose month
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>
      ) : null}

      <Card className="p-0" header={<CardTitle title="Issued family vouchers" />}>
        <div className="p-5 pt-0">
          <FamilyVoucherRegister canWrite={canWrite} reloadToken={issuedToken} />
        </div>
      </Card>

      {/* Step 2 — which month. */}
      <Modal
        open={family !== null && period === null}
        title={family === null ? 'Choose a month' : `${family.guardianName} — which month?`}
        description="A family voucher covers one billing month, so its total matches the slips the parent is holding."
        onClose={() => {
          setFamily(null);
        }}
      >
        {family === null ? null : family.openMonths.length === 0 ? (
          <p className="text-sm text-ink-muted">
            This family has nothing open in a billing month. One-off vouchers are
            never clubbed — they have no month to share.
          </p>
        ) : (
          <ul className="space-y-2">
            {family.openMonths.map((month) => (
              <li key={`${String(month.billingYear)}-${String(month.billingMonth)}`}>
                <button
                  type="button"
                  className="flex w-full items-center justify-between rounded-lg border border-line px-3 py-2 text-left hover:border-brand-primary"
                  onClick={() => {
                    void chooseMonth(month.billingMonth, month.billingYear);
                  }}
                >
                  <span className="text-sm font-medium text-ink">
                    {formatMonthYear(month.billingMonth, month.billingYear)}
                  </span>
                  <span className="text-sm text-ink-muted">
                    {month.count} voucher{month.count === 1 ? '' : 's'} ·{' '}
                    {formatPkr(month.total)}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </Modal>

      {/* Step 3 — what to club. */}
      <Modal
        open={period !== null}
        size="lg"
        title="What goes on the voucher?"
        description="Untick anything the family is paying separately. The total below is what the slip will demand."
        onClose={() => {
          if (!issuing) setPeriod(null);
        }}
        footer={
          <>
            <Button
              variant="secondary"
              disabled={issuing}
              onClick={() => {
                setPeriod(null);
              }}
            >
              Back
            </Button>
            <Button
              isLoading={issuing}
              disabled={selected.length < 2 || dueDate === ''}
              title={
                dueDate === ''
                  ? 'Choose a due date first'
                  : selected.length < 2
                    ? 'A family voucher needs at least two vouchers'
                    : undefined
              }
              onClick={() => {
                void issue();
              }}
            >
              Generate family voucher
            </Button>
          </>
        }
      >
        {vouchers === null ? (
          <p className="text-sm text-ink-muted">Reading that month’s vouchers…</p>
        ) : (
          <div className="space-y-4">
            <ul className="divide-y divide-line">
              {vouchers.map((voucher) => (
                <li key={voucher.challanId} className="flex items-center gap-3 py-2">
                  <input
                    type="checkbox"
                    className="h-4 w-4"
                    checked={selected.includes(voucher.challanId)}
                    aria-label={`Include ${voucher.studentName}'s voucher`}
                    onChange={(event) => {
                      setSelected((current) =>
                        event.target.checked
                          ? [...current, voucher.challanId]
                          : current.filter((id) => id !== voucher.challanId),
                      );
                    }}
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm text-ink">{voucher.studentName}</span>
                    <span className="block font-mono text-xs text-ink-muted">
                      {voucher.challanNumber} · due {formatDateOnly(voucher.dueDate)}
                    </span>
                  </span>
                  <span className="font-mono text-sm text-ink">
                    {formatPkr(voucher.totalAmount)}
                  </span>
                </li>
              ))}
            </ul>

            <p className="text-sm font-medium text-ink">
              {selected.length} selected · {formatPkr(selectedTotalPaise / 100)}
            </p>

            <Input
              label="Voucher due date"
              type="date"
              hint="Printed on the slip the parent takes to the bank."
              value={dueDate}
              disabled={issuing}
              onChange={(event) => {
                setDueDate(event.target.value);
              }}
            />
          </div>
        )}
      </Modal>
    </div>
  );
}
