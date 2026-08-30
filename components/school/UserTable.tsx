'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { Badge } from '@/components/ui/Badge';
import {
  DataTable,
  DATA_TABLE_DEFAULT_PAGE_SIZE,
  type DataTableColumn,
  type DataTableSort,
} from '@/components/ui/DataTable';
import { Button } from '@/components/ui/Button';
import { formatPhoneForDisplay } from '@/lib/phone-formats';
import { MAX_BULK_DELETE, type DeletionOutcome } from '@/lib/user-deletion';
import { ROLE_LABELS, isUserRole } from '@/types/school-auth';

export interface UserRow {
  id: string;
  authUserId: string | null;
  name: string;
  email: string | null;
  phone: string;
  /**
   * The number to print — Sprint 20, item 1.
   *
   * For a student that is their primary guardian's, because `phone` above
   * carries `studentDirectoryPhone`'s `student:<admission number>` sentinel:
   * the column is `NOT NULL` and a seven-year-old has no telephone. Null means
   * nobody is on file, and the cell prints `—` rather than the sentinel.
   */
  contactPhone: string | null;
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
  const [pageSize, setPageSize] = useState(DATA_TABLE_DEFAULT_PAGE_SIZE);
  const [sort, setSort] = useState<DataTableSort>({ columnId: 'name', direction: 'asc' });
  const [pending, setPending] = useState(true);

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
      setPending(true);
      const query = new URLSearchParams({
        page: String(page),
        limit: String(pageSize),
        sort: sort.columnId,
        direction: sort.direction,
      });
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
      } finally {
        if (!signal.aborted) setPending(false);
      }
    },
    [search, role, branchId, status, page, pageSize, sort],
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
      labelFor: (facet: FacetCount) => string,
    ) => {
      const options: Array<{ value: string; label: string }> = [];
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

  const roleOptions = facetOptions(data?.facets.roles, role, (facet) =>
    isUserRole(facet.value) ? ROLE_LABELS[facet.value] : facet.value,
  );

  const branchOptions = facetOptions(data?.facets.branches, branchId, (facet) =>
    facet.value === UNASSIGNED_BRANCH
      ? 'No branch (school-wide)'
      : (branchNames.get(facet.value) ?? facet.label),
  );

  const statusOptions = facetOptions(data?.facets.statuses, status, (facet) =>
    STATUS_LABELS[facet.value] ?? facet.value,
  );

  const overCap = selected.size > MAX_BULK_DELETE;

  const columns: Array<DataTableColumn<UserRow>> = [];

  if (canManage) {
    columns.push({
      id: 'select',
      headerClassName: 'w-10',
      className: 'w-10',
      header: (
        <input
          ref={headerCheckbox}
          type="checkbox"
          aria-label="Select every user on this page"
          className="h-4 w-4 rounded border-line-strong"
          checked={pageIds.length > 0 && selectedOnPage === pageIds.length}
          onChange={togglePage}
        />
      ),
      cell: (user) => (
        <input
          type="checkbox"
          aria-label={`Select ${user.name}`}
          className="h-4 w-4 rounded border-line-strong"
          checked={selected.has(user.id)}
          onChange={() => {
            toggle(user.id);
          }}
        />
      ),
    });
  }

  columns.push(
    {
      id: 'name',
      header: 'Name',
      rowHeader: true,
      sortable: true,
      cell: (user) => user.name,
    },
    {
      id: 'role',
      header: 'Role',
      muted: true,
      sortable: true,
      cell: (user) => (isUserRole(user.role) ? ROLE_LABELS[user.role] : user.role),
    },
    {
      id: 'branch',
      header: 'Branch',
      muted: true,
      sortable: true,
      cell: (user) => user.branchName ?? 'All branches',
    },
    {
      id: 'phone',
      header: 'Phone',
      muted: true,
      sortable: true,
      className: 'font-mono text-xs',
      cell: (user) =>
        user.contactPhone === null ? '—' : formatPhoneForDisplay(user.contactPhone),
    },
    {
      id: 'status',
      header: 'Status',
      /*
        Read from `authUserId`, not `joinedAt` — having a Supabase identity is
        what "has signed in" means, and it is the same source the filter groups
        on, so the badge and the filter cannot disagree. Not sortable: the
        server groups on an expression rather than a column, and a sort that
        disagreed with the facet counts beside it would be worse than none.
      */
      cell: (user) =>
        !user.isActive ? (
          <Badge variant="danger">Deactivated</Badge>
        ) : user.authUserId === null ? (
          <Badge variant="warning">Never signed in</Badge>
        ) : (
          <Badge variant="success">Active</Badge>
        ),
    },
    {
      id: 'actions',
      header: 'Actions',
      cell: (user) => (
        <Link
          href={`/dashboard/users/${user.id}`}
          className="text-sm font-medium text-brand-primary hover:underline"
        >
          View
        </Link>
      ),
    },
  );

  return (
    <div className="space-y-4">
      {error !== null ? (
        <p role="alert" className="rounded-lg bg-status-danger-subtle px-3 py-2 text-sm text-status-danger-ink">
          {error}
        </p>
      ) : null}

      {notice !== null ? (
        <p
          role="status"
          className="rounded-lg bg-status-success-subtle px-3 py-2 text-sm text-status-success-ink"
        >
          {notice}
        </p>
      ) : null}

      {refusals.length > 0 ? (
        <div className="rounded-lg bg-status-warning-subtle px-3 py-2 text-sm text-status-warning-onSubtle">
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
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-line bg-surface-raised px-4 py-3">
          <span className="text-sm text-ink">
            {selected.size} user{selected.size === 1 ? '' : 's'} selected
            {overCap ? ` — the limit is ${MAX_BULK_DELETE} at a time` : ''}
          </span>

          <div className="flex flex-nowrap items-center gap-2 whitespace-nowrap">
            {confirming ? (
              <>
                <span className="text-sm text-status-danger-ink">
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

      <DataTable
        mode="server"
        caption="School users and staff"
        maxHeight="34rem"
        columns={columns}
        rows={users}
        getRowKey={(user) => user.id}
        rowSelected={(user) => selected.has(user.id)}
        pending={pending}
        sort={sort}
        onSortChange={(next) => {
          // A sort is a new result set, so it clears the selection for the same
          // reason a filter does — see the docblock at the top of this file.
          changeFilter(() => {
            setSort(next);
          });
        }}
        page={page}
        pageSize={pageSize}
        totalItems={data?.total ?? 0}
        onPageChange={setPage}
        onPageSizeChange={setPageSize}
        search={{
          value: search,
          onChange: (value) => {
            changeFilter(() => {
              setSearch(value);
            });
          },
          placeholder: 'Name, phone or email',
        }}
        /*
         * The counts on each option come from the server's facets, computed
         * with that dimension excluded, which is what lets somebody change
         * their mind about a filter they have already applied.
         */
        filters={[
          {
            id: 'role',
            label: 'Role',
            allLabel: 'All roles',
            options: roleOptions,
            value: role,
            onChange: (value) => {
              changeFilter(() => {
                setRole(value);
              });
            },
          },
          {
            id: 'branch',
            label: 'Branch',
            allLabel: 'All branches',
            options: branchOptions,
            value: branchId,
            disabled: lockedBranchId !== null,
            onChange: (value) => {
              changeFilter(() => {
                setBranchId(value);
              });
            },
          },
          {
            id: 'status',
            label: 'Status',
            allLabel: 'All statuses',
            options: statusOptions,
            value: status,
            onChange: (value) => {
              changeFilter(() => {
                setStatus(value);
              });
            },
          },
        ]}
        filtersActive={
          search.trim() !== '' ||
          role !== '' ||
          status !== '' ||
          (branchId !== '' && lockedBranchId === null)
        }
        onClearFilters={() => {
          changeFilter(() => {
            setSearch('');
            setRole('');
            setStatus('');
            // A branch-bound administrator's branch is not a filter they chose.
            if (lockedBranchId === null) setBranchId('');
          });
        }}
        itemNoun={{ singular: 'user', plural: 'users' }}
        emptyTitle="Nobody in the directory yet"
        emptyDescription="Invite a colleague, or add a member directly, and they will appear here."
        noResultTitle="No users match those filters"
        noResultDescription="Each dropdown shows how many rows it would return — widen the one with the smallest count."
      />
    </div>
  );
}
