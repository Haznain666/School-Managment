'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';

import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
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
      try {
        await superAdminFetch(
          `/api/super-admin/schools/${school.id}/provision-subdomain`,
          { method: 'POST' },
        );
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
        <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </p>
      ) : null}

      {rows === null ? (
        <Card>
          <p className="text-sm text-slate-500">Loading schools…</p>
        </Card>
      ) : rows.length === 0 ? (
        <Card>
          <p className="text-sm text-slate-600">
            No schools match those filters.
          </p>
        </Card>
      ) : (
        <Card className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th scope="col" className="px-4 py-3 font-medium">Name</th>
                  <th scope="col" className="px-4 py-3 font-medium">City</th>
                  <th scope="col" className="px-4 py-3 font-medium">Slug</th>
                  {/*
                    Named "Tenant ID", not "GHL Location ID". The column holds
                    `schools.location_id`, which stopped being a GoHighLevel
                    identifier when GHL became an opt-in integration — the GHL
                    sub-account now lives in `ghl_location_id` and is shown on
                    the school's Integrations tab. The old heading labelled a
                    plain uuid as something it is not.
                  */}
                  <th scope="col" className="px-4 py-3 font-medium">Tenant ID</th>
                  <th scope="col" className="px-4 py-3 font-medium">Subdomain</th>
                  <th scope="col" className="px-4 py-3 font-medium">Active</th>
                  <th scope="col" className="px-4 py-3 text-right font-medium">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {rows.map((school) => (
                  <tr key={school.id}>
                    <td className="px-4 py-3">
                      <Link
                        href={`/super-admin/schools/${school.id}`}
                        className="font-medium text-slate-900 hover:text-brand-primary"
                      >
                        {school.name}
                      </Link>
                    </td>
                    <td className="px-4 py-3 text-slate-600">{school.city}</td>
                    <td className="px-4 py-3 font-mono text-xs text-slate-600">
                      {school.slug}
                    </td>
                    {/*
                      Truncated with CSS rather than by slicing the string, so
                      the full uuid is still in the DOM: selecting the cell
                      copies all 36 characters, and the title shows them on
                      hover. Slicing would have made the one thing this column
                      is for — copying the id — impossible.
                    */}
                    <td
                      title={school.locationId}
                      className="max-w-[10rem] truncate px-4 py-3 font-mono text-xs text-slate-600"
                    >
                      {school.locationId}
                    </td>
                    {/*
                      The error, when there is one, is shown on the row rather
                      than behind a tooltip: a failed provision is the reason
                      the school is unreachable, and an operator should not have
                      to hover to discover why.
                    */}
                    <td className="px-4 py-3">
                      {(() => {
                        const state = describeSubdomainStatus(school.subdomainStatus);
                        return (
                          <div className="space-y-1">
                            <Badge variant={state.variant}>{state.label}</Badge>
                            {school.subdomainError != null &&
                              school.subdomainError !== '' && (
                                <p className="max-w-[16rem] text-xs text-red-700">
                                  {school.subdomainError}
                                </p>
                              )}
                          </div>
                        );
                      })()}
                    </td>
                    <td className="px-4 py-3">
                      <Badge variant={school.isActive ? 'success' : 'danger'}>
                        {school.isActive ? 'Active' : 'Inactive'}
                      </Badge>
                    </td>
                    <td className="px-4 py-3">
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
                          Hidden only for `unmanaged`, where no token is
                          configured and the request could not change anything.
                          Every other state is retryable, including `ready` —
                          re-checking a school that has since broken is exactly
                          when an operator reaches for this.
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
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  );
}
