'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';

import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { superAdminFetch, SuperAdminApiError } from '@/lib/super-admin-client';

export interface SchoolRow {
  id: string;
  name: string;
  city: string;
  slug: string;
  locationId: string;
  isActive: boolean;
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
                  <th scope="col" className="px-4 py-3 font-medium">GHL Location ID</th>
                  <th scope="col" className="px-4 py-3 font-medium">Active</th>
                  <th scope="col" className="px-4 py-3 font-medium">Actions</th>
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
                    <td className="px-4 py-3 font-mono text-xs text-slate-600">
                      {school.locationId}
                    </td>
                    <td className="px-4 py-3">
                      <Badge variant={school.isActive ? 'success' : 'danger'}>
                        {school.isActive ? 'Active' : 'Inactive'}
                      </Badge>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex gap-2">
                        <Link
                          href={`/super-admin/schools/${school.id}/edit`}
                          className="text-sm font-medium text-brand-primary hover:underline"
                        >
                          Edit
                        </Link>
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
