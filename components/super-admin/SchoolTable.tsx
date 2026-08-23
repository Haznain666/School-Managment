'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';

import { Badge, type BadgeVariant } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import {
  DataTable,
  DATA_TABLE_DEFAULT_PAGE_SIZE,
  type DataTableColumn,
  type DataTableSort,
} from '@/components/ui/DataTable';
import { Input } from '@/components/ui/Input';
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
  { value: 'active', label: 'Active only' },
  { value: 'inactive', label: 'Inactive only' },
];

/**
 * The recorded provisioning message takes its colour from the status, not from
 * a hardcoded red.
 *
 * A `throttled` row — the host answered 429 — is amber, because a rate limit is
 * transient and retryable. Painting its message red under an amber badge made
 * the row contradict itself: the badge said "wait and retry" and the sentence
 * under it said "this failed". Reading the colour off the descriptor means any
 * status added later is right here without this file being touched.
 */
const MESSAGE_TEXT: Record<BadgeVariant, string> = {
  success: 'text-status-success-ink',
  warning: 'text-status-warning-ink',
  danger: 'text-status-danger-ink',
  info: 'text-status-info-ink',
  brand: 'text-brand-primary',
  neutral: 'text-ink-muted',
};

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
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(DATA_TABLE_DEFAULT_PAGE_SIZE);
  const [sort, setSort] = useState<DataTableSort>({
    columnId: 'createdAt',
    direction: 'desc',
  });
  const [pending, setPending] = useState(true);
  const [error, setError] = useState<string | null>(null);
  /** What the last provision attempt actually did, in the server's own words. */
  const [provisionNotice, setProvisionNotice] = useState<string | null>(null);
  const [pendingId, setPendingId] = useState<string | null>(null);

  const load = useCallback(
    async (signal?: AbortSignal) => {
      setPending(true);
      const query = new URLSearchParams({
        page: String(page),
        limit: String(pageSize),
        sort: sort.columnId,
        direction: sort.direction,
      });
      if (search.trim() !== '') query.set('search', search.trim());
      if (status !== 'all') query.set('status', status);

      try {
        const data = await superAdminFetch<{ schools: SchoolRow[]; total: number }>(
          `/api/super-admin/schools?${query.toString()}`,
          signal === undefined ? {} : { signal },
        );
        setRows(data.schools);
        setTotal(data.total);
        setError(null);
      } catch (caught) {
        if (caught instanceof DOMException && caught.name === 'AbortError') return;
        setError('Could not load schools.');
      } finally {
        if (signal === undefined || !signal.aborted) setPending(false);
      }
    },
    [search, status, page, pageSize, sort],
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

  const columns: Array<DataTableColumn<SchoolRow>> = [
    {
      id: 'name',
      header: 'Name',
      sortable: true,
      cell: (school) => (
        <Link
          href={`/super-admin/schools/${school.id}`}
          className="font-medium text-ink hover:text-brand-primary"
        >
          {school.name}
        </Link>
      ),
    },
    {
      id: 'city',
      header: 'City',
      muted: true,
      sortable: true,
      cell: (school) => school.city,
    },
    {
      id: 'slug',
      header: 'Slug',
      muted: true,
      sortable: true,
      className: 'font-mono text-xs',
      cell: (school) => school.slug,
    },
    {
      /*
        Named "Tenant ID", not "GHL Location ID". The column holds
        `schools.location_id`, which stopped being a GoHighLevel identifier when
        GHL became an opt-in integration — the GHL sub-account now lives in
        `ghl_location_id` and is shown on the school's Integrations tab. The old
        heading labelled a plain uuid as something it is not.

        Truncated with CSS rather than by slicing the string, so the full uuid is
        still in the DOM: selecting the cell copies all 36 characters, and the
        title shows them on hover. Slicing would have made the one thing this
        column is for — copying the id — impossible.
      */
      id: 'locationId',
      header: 'Tenant ID',
      muted: true,
      className: 'max-w-[10rem] truncate font-mono text-xs',
      cell: (school) => <span title={school.locationId}>{school.locationId}</span>,
    },
    {
      /*
        The error, when there is one, is shown on the row rather than behind a
        tooltip: a failed provision is the reason the school is unreachable, and
        an operator should not have to hover to discover why. Its colour comes
        from the same descriptor as the badge, so the two always agree.
      */
      id: 'subdomain',
      header: 'Subdomain',
      cell: (school) => {
        const state = describeSubdomainStatus(school.subdomainStatus);
        return (
          <div className="space-y-1">
            <Badge variant={state.variant}>{state.label}</Badge>
            {school.subdomainError != null && school.subdomainError !== '' ? (
              <p className={`max-w-[16rem] text-xs ${MESSAGE_TEXT[state.variant]}`}>
                {school.subdomainError}
              </p>
            ) : null}
          </div>
        );
      },
    },
    {
      id: 'isActive',
      header: 'Active',
      sortable: true,
      cell: (school) => (
        <Badge variant={school.isActive ? 'success' : 'danger'}>
          {school.isActive ? 'Active' : 'Inactive'}
        </Badge>
      ),
    },
    {
      id: 'actions',
      header: 'Actions',
      align: 'numeric',
      cell: (school) => (
        /*
          All of them are buttons of the same size and variant, on one baseline.
          `flex-nowrap`, not wrap: wrapping dropped "Deactivate" onto a second
          line whenever the row was tight, and the table already scrolls
          sideways inside its own box.
        */
        <div className="flex flex-nowrap items-center justify-end gap-2 whitespace-nowrap">
          <Link href={`/super-admin/schools/${school.id}/edit`}>
            <Button variant="secondary" size="sm">
              Edit
            </Button>
          </Link>

          {/*
            Offered in every state, including `ready` — re-checking a school that
            has since broken is exactly when an operator reaches for this — and,
            since 2026-08-16, including `unmanaged` too. That one used to be
            hidden; `lib/subdomain-status.ts` records why hiding it stranded
            every school created before the hosting token was set.
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
            Only offered for a live tenant: a deactivated school's portal is
            closed to everyone, and the API refuses it too rather than trusting
            this to be the only guard.
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
            Erasure, offered on every row rather than only on deactivated ones. A
            tenant created by mistake should not have to be deactivated first as
            a ceremony — the typed-name confirmation is the guard, not the order
            of operations.
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
      ),
    },
  ];

  return (
    <div className="space-y-4">
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

      <DataTable
        mode="server"
        caption="Schools"
        columns={columns}
        rows={rows ?? []}
        getRowKey={(school) => school.id}
        pending={pending}
        sort={sort}
        onSortChange={(next) => {
          setPage(1);
          setSort(next);
        }}
        page={page}
        pageSize={pageSize}
        totalItems={total}
        onPageChange={setPage}
        onPageSizeChange={setPageSize}
        search={{
          value: search,
          onChange: (value) => {
            setPage(1);
            setSearch(value);
          },
          placeholder: 'Search by name, city or subdomain',
        }}
        filters={[
          {
            id: 'status',
            label: 'Status',
            allLabel: 'All schools',
            options: STATUS_OPTIONS,
            value: status === 'all' ? '' : status,
            onChange: (value) => {
              setPage(1);
              setStatus(value === '' ? 'all' : value);
            },
          },
          {
            id: 'subdomain',
            label: 'Subdomain',
            allLabel: 'Every state',
            /*
             * Filtered in the browser over the page in hand rather than on the
             * server: the status lives in `schools.subdomain_status`, and an
             * operator using this is looking for the handful of rows that need
             * a retry, not paging through them.
             */
            options: [
              ...new Set(
                (rows ?? []).map((school) => school.subdomainStatus ?? 'pending'),
              ),
            ].map((value) => ({
              value,
              label: describeSubdomainStatus(value).label,
            })),
            rowValue: (school) => school.subdomainStatus ?? 'pending',
          },
        ]}
        filtersActive={search.trim() !== '' || status !== 'all'}
        onClearFilters={() => {
          setPage(1);
          setSearch('');
          setStatus('all');
        }}
        itemNoun={{ singular: 'school', plural: 'schools' }}
        emptyTitle="No schools yet"
        emptyDescription="Create the first tenant and it will appear here."
        noResultTitle="No schools match those filters"
        noResultDescription="Widen the status, or clear the search."
      />

      {/*
        The erasure dialog. Deliberately spells out what goes, in the school's
        own numbers where it has them, because "this cannot be undone" is a
        sentence people have learned to click past — a list of what is about to
        be destroyed is not.
      */}
      {deleting !== null ? (
        // `z-backdrop`, not a raw `z-50`. This project has a named z-index
        // scale in `tailwind.config.ts`, and `z-sticky` — which the Table's own
        // sticky header uses — is 1100. A dialog at 50 was painted over by the
        // table header and the row beneath it, which is exactly how it looked:
        // table content cutting across the middle of the dialog.
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="delete-school-title"
          className="fixed inset-0 z-backdrop flex items-center justify-center overflow-y-auto bg-[rgb(2_6_23/0.55)] p-4"
        >
          {/*
            `space-y-4` belongs on a wrapper *inside* the Card, not on the Card.
            Card renders its children into its own `px-5 py-4` body div, so the
            outer element has exactly one child and `space-y-*` — which styles
            the gaps *between* siblings — had nothing to act on. Every element in
            this dialog was therefore flush against the next, which is what made
            it look broken.

            `z-modal` sits above the backdrop, and `max-h`/`overflow-y-auto`
            keep the dialog usable on a short viewport instead of pushing the
            buttons off-screen.
          */}
          <Card className="z-modal my-auto max-h-[90vh] w-full max-w-lg overflow-y-auto">
            <div className="space-y-4">
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

            <div className="flex flex-wrap items-center justify-end gap-3 pt-1">
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
            </div>
          </Card>
        </div>
      ) : null}
    </div>
  );
}
