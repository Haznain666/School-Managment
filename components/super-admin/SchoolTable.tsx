'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';

import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
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
import { describeSubdomainStatus } from '@/lib/subdomain-status';
import { superAdminFetch, SuperAdminApiError } from '@/lib/super-admin-client';

export interface SchoolRow {
  id: string;
  name: string;
  city: string;
  slug: string;
  locationId: string;
  isActive: boolean;
  subdomainStatus?: string | null;
  subdomainError?: string | null;
}

const STATUS_OPTIONS = [
  { value: 'all', label: 'All schools' },
  { value: 'active', label: 'Active only' },
  { value: 'inactive', label: 'Inactive only' },
];

/**
 * Searchable school list.
 *
 * Filtering is done server-side so the panel stays usable as the tenant count
 * grows, rather than shipping every row and filtering in the browser.
 */
export function SchoolTable() {
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('all');
  const [rows, setRows] = useState<SchoolRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  /** What the last provision attempt actually did, in the server's own words. */
  const [provisionNotice, setProvisionNotice] = useState<string | null>(null);
  const [pendingId, setPendingId] = useState<string | null>(null);

  const load = useCallback(
    async (signal?: AbortSignal) => {
      const query = new URLSearchParams();
      if (search.trim() !== '') query.set('search', search.trim());
      if (status !== 'all') query.set('status', status);

      try {
        const data = await superAdminFetch<{ schools: SchoolRow[] }>(
          `/api/super-admin/schools?${query.toString()}`,
          signal === undefined ? {} : { signal },
        );
        setRows(data.schools);
        setError(null);
      } catch (caught) {
        if (caught instanceof DOMException && caught.name === 'AbortError') return;
        setError('Could not load schools.');
      }
    },
    [search, status],
  );

  // Debounced so typing in the search box does not fire a request per keystroke.
  useEffect(() => {
    const controller = new AbortController();
    const timer = setTimeout(() => {
      void load(controller.signal);
    }, 250);

    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [load]);

  const handleDeactivate = useCallback(
    async (school: SchoolRow) => {
      setPendingId(school.id);
      try {
        await superAdminFetch(`/api/super-admin/schools/${school.id}`, {
          method: 'DELETE',
        });
        await load();
      } catch (caught) {
        setError(
          caught instanceof SuperAdminApiError
            ? caught.message
            : 'Could not deactivate the school.',
        );
      } finally {
        setPendingId(null);
      }
    },
    [load],
  );

  /**
   * The school the operator has asked to erase, and what they have typed to
   * confirm it.
   *
   * Held here rather than as a `window.confirm`, because a yes/no dialog is
   * muscle memory by the third time it is seen. Retyping the school's name
   * cannot be done absent-mindedly, and — the part that matters — cannot be
   * done at all against the wrong row, which is the mistake worth preventing on
   * a screen that lists every tenant on the platform.
   */
  const [deleting, setDeleting] = useState<SchoolRow | null>(null);
  const [confirmName, setConfirmName] = useState('');

  const handleDeleteForever = useCallback(
    async (school: SchoolRow) => {
      setPendingId(school.id);
      try {
        await superAdminFetch(
          `/api/super-admin/schools/${school.id}?permanent=true`,
          { method: 'DELETE', body: JSON.stringify({ confirmName }) },
        );
        setDeleting(null);
        setConfirmName('');
        await load();
      } catch (caught) {
        setError(
          caught instanceof SuperAdminApiError
            ? caught.message
            : 'Could not delete the school.',
        );
      } finally {
        setPendingId(null);
      }
    },
    [load, confirmName],
  );

  const handleReactivate = useCallback(
    async (school: SchoolRow) => {
      setPendingId(school.id);
      try {
        await superAdminFetch(`/api/super-admin/schools/${school.id}`, {
          method: 'PATCH',
          body: JSON.stringify({ isActive: true }),
        });
        await load();
      } catch (caught) {
        setError(
          caught instanceof SuperAdminApiError
            ? caught.message
            : 'Could not reactivate the school.',
        );
      } finally {
        setPendingId(null);
      }
    },
    [load],
  );

  /**
   * Create the school's subdomain, or ask whether it has come up yet.
   *
   * One control for both, because they are one idempotent operation on the
   * server — see the route's docblock. Separate "provision" and "check"
   * buttons would only make the operator decide which of two identical
   * requests to send.
   */
  const handleProvision = useCallback(
    async (school: SchoolRow) => {
      setPendingId(school.id);
      setProvisionNotice(null);
      try {
        /*
          The response was discarded until 2026-08-16, which meant provisioning
          reported itself only as a badge changing colour. That is not enough to
          act on: "parked, and a DNS record was created" and "parked, and a DNS
          record already existed" are different situations with different next
          steps, and the difference between them is the whole reason a school
          resolves or does not. It is shown verbatim now.
        */
        const result = await superAdminFetch<{
          subdomain?: { host?: string; message?: string; status?: string };
        }>(`/api/super-admin/schools/${school.id}/provision-subdomain`, {
          method: 'POST',
        });

        const message = result.subdomain?.message;
        if (typeof message === 'string' && message !== '') {
          setProvisionNotice(`${school.slug}: ${message}`);
        }

        await load();
      } catch (caught) {
        setError(
          caught instanceof SuperAdminApiError
            ? caught.message
            : 'Could not provision the subdomain.',
        );
      } finally {
        setPendingId(null);
      }
    },
    [load],
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
        <div className="flex-1">
          <Input
            label="Search"
            placeholder="Search by name, city or subdomain"
            value={search}
            onChange={(event) => {
              setSearch(event.target.value);
            }}
          />
        </div>
        <div className="sm:w-48">
          <Select
            label="Status"
            options={STATUS_OPTIONS}
            value={status}
            onChange={(event) => {
              setStatus(event.target.value);
            }}
          />
        </div>
      </div>

      {error !== null ? (
        <p role="alert" className="rounded-lg bg-status-danger-subtle px-3 py-2 text-sm text-status-danger-ink">
          {error}
        </p>
      ) : null}

      {provisionNotice !== null ? (
        <p className="rounded-lg bg-status-info-subtle px-3 py-2 text-sm text-status-info-onSubtle">
          {provisionNotice}
        </p>
      ) : null}

      {rows === null ? (
        <Card>
          <p className="text-sm text-ink-muted">Loading schools…</p>
        </Card>
      ) : rows.length === 0 ? (
        <Card>
          <p className="text-sm text-ink-muted">
            No schools match those filters.
          </p>
        </Card>
      ) : (
        <Card className="p-0">
          <div className="overflow-x-auto">
            <Table caption="Schools" className="rounded-none border-0">
              <TableHead>
                <TableRow>
                  <TableHeaderCell>Name</TableHeaderCell>
                  <TableHeaderCell>City</TableHeaderCell>
                  <TableHeaderCell>Slug</TableHeaderCell>
                  {/*
                    Named "Tenant ID", not "GHL Location ID". The column holds
                    `schools.location_id`, which stopped being a GoHighLevel
                    identifier when GHL became an opt-in integration — the GHL
                    sub-account now lives in `ghl_location_id` and is shown on
                    the school's Integrations tab. The old heading labelled a
                    plain uuid as something it is not.
                  */}
                  <TableHeaderCell>Tenant ID</TableHeaderCell>
                  <TableHeaderCell>Subdomain</TableHeaderCell>
                  <TableHeaderCell>Active</TableHeaderCell>
                  <TableHeaderCell align="numeric">Actions</TableHeaderCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {rows.map((school) => (
                  <TableRow key={school.id}>
                    <TableCell>
                      <Link
                        href={`/super-admin/schools/${school.id}`}
                        className="font-medium text-ink hover:text-brand-primary"
                      >
                        {school.name}
                      </Link>
                    </TableCell>
                    <TableCell muted>{school.city}</TableCell>
                    <TableCell muted className="font-mono text-xs">
                      {school.slug}
                    </TableCell>
                    {/*
                      Truncated with CSS rather than by slicing the string, so
                      the full uuid is still in the DOM: selecting the cell
                      copies all 36 characters, and the title shows them on
                      hover. Slicing would have made the one thing this column
                      is for — copying the id — impossible.
                    */}
                    <TableCell muted className="max-w-[10rem] truncate font-mono text-xs" title={school.locationId}>
                      {school.locationId}
                    </TableCell>
                    {/*
                      The error, when there is one, is shown on the row rather
                      than behind a tooltip: a failed provision is the reason
                      the school is unreachable, and an operator should not have
                      to hover to discover why.
                    */}
                    <TableCell>
                      {(() => {
                        const state = describeSubdomainStatus(school.subdomainStatus);
                        return (
                          <div className="space-y-1">
                            <Badge variant={state.variant}>{state.label}</Badge>
                            {school.subdomainError != null &&
                              school.subdomainError !== '' && (
                                <p className="max-w-[16rem] text-xs text-status-danger-ink">
                                  {school.subdomainError}
                                </p>
                              )}
                          </div>
                        );
                      })()}
                    </TableCell>
                    <TableCell>
                      <Badge variant={school.isActive ? 'success' : 'danger'}>
                        {school.isActive ? 'Active' : 'Inactive'}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      {/*
                        All three are buttons of the same size and variant, on
                        one baseline. Two links and a button meant three
                        different heights and two different hit areas for
                        actions of equal weight; "Login as Admin" in particular
                        reads as a control, not as prose.

                        `justify-end` with the header right-aligned to match, so
                        the column stays tidy when a row offers Reactivate only.
                      */}
                      {/*
                        `flex-nowrap`, not wrap. Wrapping dropped "Deactivate"
                        onto a second line whenever the row was tight, which is
                        the misalignment this was meant to remove. The table is
                        already inside `overflow-x-auto`, so the honest failure
                        mode for a narrow window is a scrollbar rather than a
                        ragged action column.
                      */}
                      <div className="flex flex-nowrap items-center justify-end gap-2 whitespace-nowrap">
                        <Link href={`/super-admin/schools/${school.id}/edit`}>
                          <Button variant="secondary" size="sm">
                            Edit
                          </Button>
                        </Link>

                        {/*
                          Offered in every state, including `ready` — re-checking
                          a school that has since broken is exactly when an
                          operator reaches for this — and, since 2026-08-16,
                          including `unmanaged` too. That one used to be hidden;
                          `lib/subdomain-status.ts` records why hiding it
                          stranded every school created before the hosting token
                          was set.
                        */}
                        {describeSubdomainStatus(school.subdomainStatus).retryable ? (
                          <Button
                            variant="secondary"
                            size="sm"
                            disabled={pendingId === school.id}
                            onClick={() => void handleProvision(school)}
                            title={describeSubdomainStatus(school.subdomainStatus).hint}
                          >
                            {pendingId === school.id
                              ? 'Working…'
                              : school.subdomainStatus === 'ready'
                                ? 'Re-check'
                                : 'Provision'}
                          </Button>
                        ) : null}

                        {/*
                          Only offered for a live tenant: a deactivated school's
                          portal is closed to everyone, and the API refuses it
                          too rather than trusting this to be the only guard.
                        */}
                        {school.isActive ? (
                          <Link href={`/super-admin/schools/${school.id}/login-as`}>
                            <Button variant="secondary" size="sm">
                              Login as Admin
                            </Button>
                          </Link>
                        ) : null}

                        {school.isActive ? (
                          <Button
                            variant="ghost"
                            size="sm"
                            isLoading={pendingId === school.id}
                            onClick={() => {
                              void handleDeactivate(school);
                            }}
                          >
                            Deactivate
                          </Button>
                        ) : (
                          <Button
                            variant="ghost"
                            size="sm"
                            isLoading={pendingId === school.id}
                            onClick={() => {
                              void handleReactivate(school);
                            }}
                          >
                            Reactivate
                          </Button>
                        )}

                        {/*
                          Erasure, offered on every row rather than only on
                          deactivated ones. A tenant created by mistake should
                          not have to be deactivated first as a ceremony — the
                          typed-name confirmation is the guard, not the order of
                          operations.
                        */}
                        <Button
                          variant="ghost"
                          size="sm"
                          disabled={pendingId === school.id}
                          onClick={() => {
                            setConfirmName('');
                            setError(null);
                            setDeleting(school);
                          }}
                          className="text-status-danger-ink hover:bg-status-danger-subtle"
                        >
                          Delete
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </Card>
      )}

      {/*
        The erasure dialog. Deliberately spells out what goes, in the school's
        own numbers where it has them, because "this cannot be undone" is a
        sentence people have learned to click past — a list of what is about to
        be destroyed is not.
      */}
      {deleting !== null ? (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="delete-school-title"
          className="fixed inset-0 z-50 flex items-center justify-center bg-[rgb(0_0_0/0.45)] p-4"
        >
          <Card className="w-full max-w-lg space-y-4">
            <h2 id="delete-school-title" className="text-lg font-semibold text-ink">
              Delete {deleting.name} permanently?
            </h2>

            <div className="rounded-lg bg-status-danger-subtle px-3 py-2 text-sm text-status-danger-ink">
              <p className="font-medium">This erases the tenant and everything in it.</p>
              <p className="mt-1">
                Branches, students, staff, enrolments, fee challans and payments,
                exams and results, payroll, and announcements all go with it. The
                subdomain{' '}
                <code className="font-mono">{deleting.slug}</code> becomes free
                for re-use. Supabase accounts are released for anyone who does
                not also belong to another school.
              </p>
              <p className="mt-1 font-medium">There is no undo and no backup taken.</p>
            </div>

            <p className="text-sm text-ink-muted">
              To deactivate instead — closing the portal but keeping every record
              — cancel and use <span className="font-medium text-ink">Deactivate</span>.
            </p>

            <Input
              label={`Type ${deleting.name} to confirm`}
              value={confirmName}
              onChange={(event) => {
                setConfirmName(event.target.value);
              }}
              disabled={pendingId === deleting.id}
              autoComplete="off"
              placeholder={deleting.name}
            />

            {error !== null ? (
              <p role="alert" className="text-sm text-status-danger-ink">
                {error}
              </p>
            ) : null}

            <div className="flex justify-end gap-3">
              <Button
                variant="secondary"
                disabled={pendingId === deleting.id}
                onClick={() => {
                  setDeleting(null);
                  setConfirmName('');
                  setError(null);
                }}
              >
                Cancel
              </Button>
              <Button
                variant="danger"
                isLoading={pendingId === deleting.id}
                // The server checks this too. Disabling here is courtesy, not
                // the guard -- see the route's docblock.
                disabled={confirmName !== deleting.name}
                onClick={() => {
                  void handleDeleteForever(deleting);
                }}
              >
                Delete permanently
              </Button>
            </div>
          </Card>
        </div>
      ) : null}
    </div>
  );
}
