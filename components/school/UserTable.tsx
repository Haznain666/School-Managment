'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';

import { Badge } from '@/components/ui/Badge';
import { Card } from '@/components/ui/Card';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { Button } from '@/components/ui/Button';
import { ROLE_LABELS, USER_ROLES, isUserRole } from '@/types/school-auth';

export interface UserRow {
  id: string;
  name: string;
  email: string | null;
  phone: string;
  role: string;
  branchId: string | null;
  branchName: string | null;
  isActive: boolean;
  joinedAt: string | null;
}

export interface BranchOption {
  id: string;
  name: string;
}

export interface UserTableProps {
  branches: readonly BranchOption[];
  /** branch_admin is pinned to one branch and cannot widen the filter. */
  lockedBranchId: string | null;
}

interface UsersResponse {
  ok: boolean;
  data?: { users: UserRow[]; total: number; page: number; limit: number };
  error?: { message: string };
}

const ROLE_OPTIONS = [
  { value: '', label: 'All roles' },
  ...USER_ROLES.map((role) => ({ value: role, label: ROLE_LABELS[role] })),
];

const STATUS_OPTIONS = [
  { value: '', label: 'All statuses' },
  { value: 'true', label: 'Active only' },
  { value: 'false', label: 'Inactive only' },
];

export function UserTable({ branches, lockedBranchId }: UserTableProps) {
  const [search, setSearch] = useState('');
  const [role, setRole] = useState('');
  const [branchId, setBranchId] = useState(lockedBranchId ?? '');
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);

  const [data, setData] = useState<UsersResponse['data'] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(
    async (signal: AbortSignal) => {
      const query = new URLSearchParams({ page: String(page), limit: '20' });
      if (search.trim() !== '') query.set('search', search.trim());
      if (role !== '') query.set('role', role);
      if (branchId !== '') query.set('branchId', branchId);
      if (status !== '') query.set('isActive', status);

      try {
        const response = await fetch(`/api/school/users?${query.toString()}`, { signal });
        const payload = (await response.json()) as UsersResponse;

        if (!response.ok || payload.ok !== true || payload.data === undefined) {
          setError(payload.error?.message ?? 'Could not load users.');
          return;
        }

        setData(payload.data);
        setError(null);
      } catch (caught) {
        if (caught instanceof DOMException && caught.name === 'AbortError') return;
        setError('Could not load users.');
      }
    },
    [search, role, branchId, status, page],
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

  const branchOptions = [
    { value: '', label: 'All branches' },
    ...branches.map((branch) => ({ value: branch.id, label: branch.name })),
  ];

  const totalPages =
    data === undefined || data === null ? 1 : Math.max(Math.ceil(data.total / data.limit), 1);

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Input
          label="Search"
          placeholder="Name or phone"
          value={search}
          onChange={(event) => {
            setPage(1);
            setSearch(event.target.value);
          }}
        />
        <Select
          label="Role"
          options={ROLE_OPTIONS}
          value={role}
          onChange={(event) => {
            setPage(1);
            setRole(event.target.value);
          }}
        />
        <Select
          label="Branch"
          options={branchOptions}
          value={branchId}
          disabled={lockedBranchId !== null}
          onChange={(event) => {
            setPage(1);
            setBranchId(event.target.value);
          }}
        />
        <Select
          label="Status"
          options={STATUS_OPTIONS}
          value={status}
          onChange={(event) => {
            setPage(1);
            setStatus(event.target.value);
          }}
        />
      </div>

      {error !== null ? (
        <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </p>
      ) : null}

      {data === null || data === undefined ? (
        <Card>
          <p className="text-sm text-slate-500">Loading users…</p>
        </Card>
      ) : data.users.length === 0 ? (
        <Card>
          <p className="text-sm text-slate-600">No users match those filters.</p>
        </Card>
      ) : (
        <>
          <Card className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-500">
                  <tr>
                    <th scope="col" className="px-4 py-3 font-medium">Name</th>
                    <th scope="col" className="px-4 py-3 font-medium">Role</th>
                    <th scope="col" className="px-4 py-3 font-medium">Branch</th>
                    <th scope="col" className="px-4 py-3 font-medium">Phone</th>
                    <th scope="col" className="px-4 py-3 font-medium">Status</th>
                    <th scope="col" className="px-4 py-3 font-medium">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {data.users.map((user) => (
                    <tr key={user.id}>
                      <td className="px-4 py-3 font-medium text-slate-900">{user.name}</td>
                      <td className="px-4 py-3 text-slate-600">
                        {isUserRole(user.role) ? ROLE_LABELS[user.role] : user.role}
                      </td>
                      <td className="px-4 py-3 text-slate-600">
                        {user.branchName ?? 'All branches'}
                      </td>
                      <td className="px-4 py-3 font-mono text-xs text-slate-600">
                        {user.phone}
                      </td>
                      <td className="px-4 py-3">
                        {user.joinedAt === null ? (
                          <Badge variant="warning">Pending</Badge>
                        ) : (
                          <Badge variant={user.isActive ? 'success' : 'danger'}>
                            {user.isActive ? 'Active' : 'Inactive'}
                          </Badge>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <Link
                          href={`/dashboard/users/${user.id}`}
                          className="text-sm font-medium text-brand-primary hover:underline"
                        >
                          View
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>

          <div className="flex items-center justify-between text-sm text-slate-600">
            <span>
              {data.total} user{data.total === 1 ? '' : 's'} · page {data.page} of{' '}
              {totalPages}
            </span>
            <div className="flex gap-2">
              <Button
                variant="secondary"
                size="sm"
                disabled={data.page <= 1}
                onClick={() => {
                  setPage((current) => Math.max(current - 1, 1));
                }}
              >
                Previous
              </Button>
              <Button
                variant="secondary"
                size="sm"
                disabled={data.page >= totalPages}
                onClick={() => {
                  setPage((current) => current + 1);
                }}
              >
                Next
              </Button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
