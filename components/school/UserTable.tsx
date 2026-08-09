'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { Badge } from '@/components/ui/Badge';
import { Card } from '@/components/ui/Card';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { Button } from '@/components/ui/Button';
import { MAX_BULK_DELETE, type DeletionOutcome } from '@/lib/user-deletion';
import { ROLE_LABELS, isUserRole } from '@/types/school-auth';

export interface UserRow {
  id: string;
  authUserId: string | null;
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
  /** Whether the viewer holds `users.write`, which is what delete is gated on. */
  canManage: boolean;
}

interface FacetCount {
  value: string;
  label: string;
  count: number;
}

interface UsersResponse {
  ok: boolean;
  data?: {
    users: UserRow[];
    total: number;
    page: number;
    limit: number;
    facets: { roles: FacetCount[]; branches: FacetCount[]; statuses: FacetCount[] };
  };
  error?: { message: string };
}

/** Mirrors `USER_STATUSES` in `lib/school-queries.ts`. */
const STATUS_LABELS: Record<string, string> = {
  active: 'Active',
  pending: 'Never signed in',
  inactive: 'Deactivated',
};

const UNASSIGNED_BRANCH = 'unassigned';

/**
 * The school's directory: filter, select, open, delete.
 *
 * ── The filters are faceted, and that is the fix ─────────────────────────
 * Each dropdown offers only the values that still return rows under the *other*
 * filters, with the count beside each. Previously all four were independent, so
 * choosing a branch and then a role routinely produced "No users match those
 * filters" with no clue which of the two was at fault — the operator had to
 * clear filters one at a time to find out. The server computes each facet with
 * its own dimension excluded (see `UserFacets`), which is what lets you change
 * your mind about a filter you have already applied.
 *
 * ── Status has three values, not two ─────────────────────────────────────
 * The table has always drawn three badges. The filter offered two, both read
 * from `is_active`, so "Active only" also returned everyone who had never
 * signed in — the state this table labels Pending. All three now come from one
 * definition on the server.
 *
 * ── Selection survives paging but not filtering ──────────────────────────
 * The same rule, for the same reason, as `ChallanTable` (STATE.md §5e): a batch
 * worth acting on spans pages, but after a filter change the rows chosen from
 * are no longer on screen, and carrying an invisible selection into a new
 * result set is how somebody deletes people they never looked at. The header
 * checkbox acts on the current page only.
 */
export function UserTable({ branches, lockedBranchId, canManage }: UserTableProps) {
  const [search, setSearch] = useState('');
  const [role, setRole] = useState('');
  const [branchId, setBranchId] = useState(lockedBranchId ?? '');
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);

  const [data, setData] = useState<UsersResponse['data'] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [confirming, setConfirming] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [refusals, setRefusals] = useState<DeletionOutcome[]>([]);
  const [notice, setNotice] = useState<string | null>(null);

  const headerCheckbox = useRef<HTMLInputElement>(null);

  const load = useCallback(
    async (signal: AbortSignal) => {
      const query = new URLSearchParams({ page: String(page), limit: '20' });
      if (search.trim() !== '') query.set('search', search.trim());
      if (role !== '') query.set('role', role);
      if (branchId !== '') query.set('branchId', branchId);
      if (status !== '') query.set('status', status);

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

  /** Any filter change invalidates the selection — see the docblock. */
  const changeFilter = useCallback((apply: () => void) => {
    apply();
    setPage(1);
    setSelected(new Set());
    setConfirming(false);
    setRefusals([]);
    setNotice(null);
  }, []);

  const users = useMemo(() => data?.users ?? [], [data]);

  const pageIds = useMemo(() => users.map((user) => user.id), [users]);
  const selectedOnPage = pageIds.filter((id) => selected.has(id)).length;

  // React has no attribute for the indeterminate state, so it is set here.
  useEffect(() => {
    if (headerCheckbox.current === null) return;
    headerCheckbox.current.indeterminate =
      selectedOnPage > 0 && selectedOnPage < pageIds.length;
  }, [selectedOnPage, pageIds.length]);

  const toggle = useCallback((id: string) => {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
    setConfirming(false);
  }, []);

  const togglePage = useCallback(() => {
    setSelected((current) => {
      const next = new Set(current);
      const allOn = pageIds.every((id) => next.has(id));
      for (const id of pageIds) {
        if (allOn) next.delete(id);
        else next.add(id);
      }
      return next;
    });
    setConfirming(false);
  }, [pageIds]);

  const deleteSelected = useCallback(async () => {
    setDeleting(true);
    setError(null);
    setNotice(null);
    setRefusals([]);

    try {
      const response = await fetch('/api/school/users/bulk-delete', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ userIds: [...selected] }),
      });

      const payload = (await response.json()) as {
        ok: boolean;
        data?: { outcomes: DeletionOutcome[]; deleted: number; summary: string };
        error?: { message: string };
      };

      if (!response.ok || payload.ok !== true || payload.data === undefined) {
        setError(payload.error?.message ?? 'Could not delete those users.');
        return;
      }

      // A partial result is the normal outcome here, not a failure: a member
      // whose name is on a register cannot be deleted at all. The refusals are
      // listed with their reasons rather than folded into the count.
      setNotice(payload.data.summary);
      setRefusals(payload.data.outcomes.filter((outcome) => !outcome.deleted));
      setSelected(new Set());
      setConfirming(false);

      const controller = new AbortController();
      await load(controller.signal);
    } catch {
      setError('Could not delete those users.');
    } finally {
      setDeleting(false);
    }
  }, [selected, load]);

  /**
   * Turns a facet into `<Select>` options.
   *
   * The current value is always present even when it has no matches, so a
   * filter can never become impossible to clear from the control that set it.
   */
  const facetOptions = useCallback(
    (
      facets: readonly FacetCount[] | undefined,
      current: string,
      allLabel: string,
      labelFor: (facet: FacetCount) => string,
    ) => {
      const options = [{ value: '', label: allLabel }];
      const seen = new Set<string>();

      for (const facet of facets ?? []) {
        seen.add(facet.value);
        options.push({ value: facet.value, label: `${labelFor(facet)} (${facet.count})` });
      }

      if (current !== '' && !seen.has(current)) {
        options.push({ value: current, label: `${current} (0)` });
      }

      return options;
    },
    [],
  );

  const branchNames = useMemo(
    () => new Map(branches.map((branch) => [branch.id, branch.name])),
    [branches],
  );

  const roleOptions = facetOptions(data?.facets.roles, role, 'All roles', (facet) =>
    isUserRole(facet.value) ? ROLE_LABELS[facet.value] : facet.value,
  );

  const branchOptions = facetOptions(
    data?.facets.branches,
    branchId,
    'All branches',
    (facet) =>
      facet.value === UNASSIGNED_BRANCH
        ? 'No branch (school-wide)'
        : (branchNames.get(facet.value) ?? facet.label),
  );

  const statusOptions = facetOptions(
    data?.facets.statuses,
    status,
    'All statuses',
    (facet) => STATUS_LABELS[facet.value] ?? facet.value,
  );

  const totalPages =
    data === undefined || data === null ? 1 : Math.max(Math.ceil(data.total / data.limit), 1);

  const overCap = selected.size > MAX_BULK_DELETE;

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Input
          label="Search"
          placeholder="Name, phone or email"
          value={search}
          onChange={(event) => {
            const next = event.target.value;
            changeFilter(() => {
              setSearch(next);
            });
          }}
        />
        <Select
          label="Role"
          options={roleOptions}
          value={role}
          onChange={(event) => {
            const next = event.target.value;
            changeFilter(() => {
              setRole(next);
            });
          }}
        />
        <Select
          label="Branch"
          options={branchOptions}
          value={branchId}
          disabled={lockedBranchId !== null}
          onChange={(event) => {
            const next = event.target.value;
            changeFilter(() => {
              setBranchId(next);
            });
          }}
        />
        <Select
          label="Status"
          options={statusOptions}
          value={status}
          onChange={(event) => {
            const next = event.target.value;
            changeFilter(() => {
              setStatus(next);
            });
          }}
        />
      </div>

      {error !== null ? (
        <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </p>
      ) : null}

      {notice !== null ? (
        <p
          role="status"
          className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-700"
        >
          {notice}
        </p>
      ) : null}

      {refusals.length > 0 ? (
        <div className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">
          <p className="font-medium">These were kept:</p>
          <ul className="mt-1 space-y-1">
            {refusals.map((outcome) => (
              <li key={outcome.id}>
                <span className="font-medium">{outcome.name}</span> — {outcome.reason}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {canManage && selected.size > 0 ? (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-slate-200 bg-white px-4 py-3">
          <span className="text-sm text-slate-700">
            {selected.size} user{selected.size === 1 ? '' : 's'} selected
            {overCap ? ` — the limit is ${MAX_BULK_DELETE} at a time` : ''}
          </span>

          <div className="flex flex-nowrap items-center gap-2 whitespace-nowrap">
            {confirming ? (
              <>
                <span className="text-sm text-red-700">
                  Delete {selected.size} user{selected.size === 1 ? '' : 's'} permanently?
                </span>
                <Button
                  variant="danger"
                  size="sm"
                  isLoading={deleting}
                  onClick={() => {
                    void deleteSelected();
                  }}
                >
                  Delete
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={deleting}
                  onClick={() => {
                    setConfirming(false);
                  }}
                >
                  Cancel
                </Button>
              </>
            ) : (
              <>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => {
                    setSelected(new Set());
                  }}
                >
                  Clear
                </Button>
                <Button
                  variant="danger"
                  size="sm"
                  disabled={overCap}
                  onClick={() => {
                    setConfirming(true);
                  }}
                >
                  Delete selected
                </Button>
              </>
            )}
          </div>
        </div>
      ) : null}

      {data === null || data === undefined ? (
        <Card>
          <p className="text-sm text-slate-500">Loading users…</p>
        </Card>
      ) : users.length === 0 ? (
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
                    {canManage ? (
                      <th scope="col" className="w-10 px-4 py-3">
                        <input
                          ref={headerCheckbox}
                          type="checkbox"
                          aria-label="Select every user on this page"
                          className="h-4 w-4 rounded border-slate-300"
                          checked={pageIds.length > 0 && selectedOnPage === pageIds.length}
                          onChange={togglePage}
                        />
                      </th>
                    ) : null}
                    <th scope="col" className="px-4 py-3 font-medium">Name</th>
                    <th scope="col" className="px-4 py-3 font-medium">Role</th>
                    <th scope="col" className="px-4 py-3 font-medium">Branch</th>
                    <th scope="col" className="px-4 py-3 font-medium">Phone</th>
                    <th scope="col" className="px-4 py-3 font-medium">Status</th>
                    <th scope="col" className="px-4 py-3 font-medium">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {users.map((user) => (
                    <tr key={user.id} className={selected.has(user.id) ? 'bg-slate-50' : undefined}>
                      {canManage ? (
                        <td className="px-4 py-3">
                          <input
                            type="checkbox"
                            aria-label={`Select ${user.name}`}
                            className="h-4 w-4 rounded border-slate-300"
                            checked={selected.has(user.id)}
                            onChange={() => {
                              toggle(user.id);
                            }}
                          />
                        </td>
                      ) : null}
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
                        {/*
                          Read from `authUserId`, not `joinedAt` — having a
                          Supabase identity is what "has signed in" means, and
                          it is the same source the filter groups on, so the
                          badge and the filter cannot disagree.
                        */}
                        {!user.isActive ? (
                          <Badge variant="danger">Deactivated</Badge>
                        ) : user.authUserId === null ? (
                          <Badge variant="warning">Never signed in</Badge>
                        ) : (
                          <Badge variant="success">Active</Badge>
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
