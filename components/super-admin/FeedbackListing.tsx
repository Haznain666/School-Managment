'use client';

import { Bug, MessageSquareText } from 'lucide-react';
import Link from 'next/link';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { Badge } from '@/components/ui/Badge';
import { DataTable, type DataTableSort } from '@/components/ui/DataTable';
import { Icon } from '@/components/ui/Icon';
import { Toggle } from '@/components/ui/Toggle';
import {
  FEEDBACK_DECISION_STATUSES,
  FEEDBACK_NATURES,
  FEEDBACK_NATURE_LABELS,
  FEEDBACK_STATUS_LABELS,
  type FeedbackDecisionStatus,
} from '@/db/schema';
import { formatDateOnly } from '@/lib/dates';
import {
  FEEDBACK_SECTION_DESCRIPTIONS,
  FEEDBACK_SECTION_LABELS,
  FEEDBACK_SECTIONS,
  natureBadgeVariant,
  statusBadgeVariant,
  type FeedbackSection,
} from '@/lib/feedback';
import type { FeedbackListRow, FeedbackSectionCounts } from '@/lib/feedback-queries';
import { cn } from '@/lib/utils';

/**
 * The platform's feedback queue.
 *
 * ── Four sections, one table ─────────────────────────────────────────────
 * Active, Work in progress, Future development and Resolved are tabs over one
 * server-mode `DataTable`, not four tables. They differ only by a `status IN
 * (…)` predicate, and four components would be four places for the filters, the
 * sorting and the pagination to drift apart — which is exactly what §5bb spent
 * a sprint undoing across thirty listings.
 *
 * ── The counter is a toggle, and it is off by default ────────────────────
 * The product owner asked for a switch. Off by default because a permanent "0"
 * beside three of the four headings is three numbers that never change, and a
 * badge that never changes stops being read — which would cost the fourth one
 * its meaning too. The preference is remembered in `localStorage`, read after
 * mount so the server and the first client render agree (§5bc's `getFullYear`
 * lesson: a differing text node discards the whole tree).
 *
 * ── Bugs are marked, and never by colour alone ───────────────────────────
 * The row carries a danger-tinted left edge *and* a "Bug" badge with the word
 * in it. Somebody who cannot distinguish the tint reads the badge; somebody
 * scanning the list sees the edge. Colour is the second signal on a fact
 * already in words, which is the rule §5ba's charts follow.
 */

export interface FeedbackListingProps {
  initialRows: readonly FeedbackListRow[];
  initialTotal: number;
  initialCounts: FeedbackSectionCounts;
  schools: ReadonlyArray<{ locationId: string; name: string }>;
}

interface ApiEnvelope {
  ok: boolean;
  data?: {
    tickets: FeedbackListRow[];
    total: number;
    counts: FeedbackSectionCounts;
  };
  error?: { message: string };
}

const COUNTER_KEY = 'sms:feedback-counters';

export function FeedbackListing({
  initialRows,
  initialTotal,
  initialCounts,
  schools,
}: FeedbackListingProps) {
  const [section, setSection] = useState<FeedbackSection>('active');
  const [nature, setNature] = useState('');
  const [school, setSchool] = useState('');
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState<DataTableSort>({
    columnId: 'createdAt',
    direction: 'desc',
  });
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);

  const [rows, setRows] = useState<readonly FeedbackListRow[]>(initialRows);
  const [total, setTotal] = useState(initialTotal);
  const [counts, setCounts] = useState(initialCounts);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [showCounters, setShowCounters] = useState(false);

  // Read after mount, never during render: reading localStorage while
  // rendering produces different markup on the server than in the browser and
  // React discards the tree over it.
  useEffect(() => {
    try {
      setShowCounters(window.localStorage.getItem(COUNTER_KEY) === '1');
    } catch {
      // Private browsing. The default is fine.
    }
  }, []);

  const load = useCallback(async () => {
    setPending(true);
    setError(null);

    try {
      const params = new URLSearchParams({
        section,
        sort: sort.columnId,
        direction: sort.direction,
        page: String(page),
        limit: String(pageSize),
      });
      if (nature !== '') params.set('nature', nature);
      if (school !== '') params.set('school', school);
      if (search.trim() !== '') params.set('q', search.trim());

      const response = await fetch(`/api/super-admin/feedback?${params.toString()}`);
      const payload = (await response.json()) as ApiEnvelope;

      if (!payload.ok || payload.data === undefined) {
        setError(payload.error?.message ?? 'The feedback could not be loaded.');
        return;
      }

      setRows(payload.data.tickets);
      setTotal(payload.data.total);
      setCounts(payload.data.counts);
    } catch {
      setError('The feedback could not be loaded. Check your connection and try again.');
    } finally {
      setPending(false);
    }
  }, [nature, page, pageSize, school, search, section, sort]);

  /*
   * The first render already holds the server's rows, so this effect must not
   * re-fetch page 1 on mount.
   *
   * ── Why a ref and not a piece of state ─────────────────────────────────
   * The first version used `useState`, and it did exactly what it was written
   * to prevent: `setMounted(true)` is itself a state change, so the effect ran
   * again immediately with `mounted === true` and issued the very request the
   * guard existed to skip. A ref does not re-render, so the second run never
   * happens and the first user interaction is the first request.
   */
  const hasMounted = useRef(false);
  useEffect(() => {
    if (!hasMounted.current) {
      hasMounted.current = true;
      return;
    }
    void load();
  }, [load]);

  const filtersActive = nature !== '' || school !== '' || search.trim() !== '';

  const clearFilters = useCallback(() => {
    setNature('');
    setSchool('');
    setSearch('');
    setPage(1);
  }, []);

  const schoolOptions = useMemo(
    () => schools.map((entry) => ({ value: entry.locationId, label: entry.name })),
    [schools],
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <nav aria-label="Feedback sections" className="flex flex-wrap gap-2">
          {FEEDBACK_SECTIONS.map((entry) => {
            const active = entry === section;

            return (
              <button
                key={entry}
                type="button"
                aria-current={active ? 'page' : undefined}
                title={FEEDBACK_SECTION_DESCRIPTIONS[entry]}
                onClick={() => {
                  setSection(entry);
                  setPage(1);
                }}
                className={cn(
                  'flex items-center gap-2 rounded-control border px-3 py-1.5 text-sm font-medium transition-colors duration-fast',
                  active
                    ? 'border-brand-primary bg-brand-primarySubtle text-brand-onPrimarySubtle'
                    : 'border-line bg-surface-raised text-ink-muted hover:bg-surface-hover hover:text-ink',
                )}
              >
                {FEEDBACK_SECTION_LABELS[entry]}
                {showCounters ? (
                  <span
                    className={cn(
                      'rounded-full px-1.5 py-0.5 text-xs font-bold tabular-nums',
                      active
                        ? 'bg-brand-primary text-brand-onPrimary'
                        : 'bg-surface-sunken text-ink-muted',
                    )}
                  >
                    {counts[entry]}
                  </span>
                ) : null}
              </button>
            );
          })}
        </nav>

        <Toggle
          label="Show counters"
          checked={showCounters}
          onChange={(next) => {
            setShowCounters(next);
            try {
              window.localStorage.setItem(COUNTER_KEY, next ? '1' : '0');
            } catch {
              // Not worth surfacing: it still works for this session.
            }
          }}
        />
      </div>

      {error === null ? null : (
        <p
          role="alert"
          className="rounded-control border border-status-danger bg-status-danger-subtle px-3 py-2 text-sm text-status-danger-onSubtle"
        >
          {error}
        </p>
      )}

      <DataTable<FeedbackListRow>
        caption={`${FEEDBACK_SECTION_LABELS[section]} feedback`}
        mode="server"
        rows={rows}
        getRowKey={(row) => row.id}
        pending={pending}
        page={page}
        pageSize={pageSize}
        totalItems={total}
        onPageChange={setPage}
        onPageSizeChange={(size) => {
          setPageSize(size);
          setPage(1);
        }}
        sort={sort}
        onSortChange={(next) => {
          setSort(next);
          setPage(1);
        }}
        search={{
          value: search,
          onChange: (value) => {
            setSearch(value);
            setPage(1);
          },
          placeholder: 'Search titles, messages, schools…',
        }}
        filters={[
          {
            id: 'nature',
            label: 'Nature',
            // `DataTable` defaults the no-choice option to `All <label>`
            // lowercased, which reads "All nature". Both of these are named
            // rather than left to that.
            allLabel: 'Every nature',
            value: nature,
            onChange: (value) => {
              setNature(value);
              setPage(1);
            },
            options: FEEDBACK_NATURES.map((value) => ({
              value,
              label: FEEDBACK_NATURE_LABELS[value],
            })),
          },
          {
            id: 'school',
            label: 'School',
            allLabel: 'Every school',
            value: school,
            onChange: (value) => {
              setSchool(value);
              setPage(1);
            },
            options: schoolOptions,
          },
        ]}
        filtersActive={filtersActive}
        onClearFilters={clearFilters}
        itemNoun={{ singular: 'ticket', plural: 'tickets' }}
        emptyIcon={MessageSquareText}
        emptyTitle={`Nothing under ${FEEDBACK_SECTION_LABELS[section]}`}
        emptyDescription="Feedback a school sends arrives here the moment it is written."
        noResultTitle="Nothing matches those filters"
        noResultDescription="Clear them to see everything in this section."
        // A tinted left edge, alongside the "Bug" badge in the row. Never the
        // only carrier of the fact.
        rowClassName={(row) =>
          row.nature === 'bug'
            ? 'border-l-2 border-status-danger bg-status-danger-subtle/40'
            : undefined
        }
        columns={[
          {
            id: 'title',
            header: 'Feedback',
            rowHeader: true,
            sortable: true,
            cell: (row) => (
              <span className="flex items-baseline gap-2">
                {row.nature === 'bug' ? (
                  <Icon as={Bug} size="sm" className="text-status-danger-ink" />
                ) : null}
                <Link
                  href={`/super-admin/feedback/${row.id}`}
                  className="font-medium text-brand-primaryInk hover:underline"
                >
                  {/*
                    "Title – School name", exactly as the requirement asks. One
                    line, because an operator scanning forty rows is reading the
                    pair as one phrase.
                  */}
                  {row.title} — {row.schoolName}
                </Link>
              </span>
            ),
          },
          {
            id: 'nature',
            header: 'Nature',
            sortable: true,
            cell: (row) => (
              <Badge variant={natureBadgeVariant(row.nature)}>
                {FEEDBACK_NATURE_LABELS[row.nature]}
              </Badge>
            ),
          },
          {
            id: 'status',
            header: 'Status',
            sortable: true,
            cell: (row) => (
              <StatusControl
                ticketId={row.id}
                status={row.status}
                onChanged={() => {
                  void load();
                }}
              />
            ),
          },
          {
            id: 'school',
            header: 'School',
            sortable: true,
            muted: true,
            cell: (row) => row.schoolName,
          },
          {
            id: 'createdAt',
            header: 'Received',
            kind: 'date',
            sortable: true,
            muted: true,
            cell: (row) => formatDateOnly(row.createdAt),
          },
        ]}
      />
    </div>
  );
}

/**
 * Setting a decision straight from the listing.
 *
 * The product owner asked for this here as well as on the detail page, and it
 * is the right call: triaging twenty tickets by opening twenty pages is how a
 * queue stops being triaged. The current status is shown as the select's own
 * value, so the control is the state rather than a button beside it.
 *
 * `unread` and `read` appear as a disabled current value and are never
 * choosable — neither is a decision, and offering them would let an operator
 * put a ticket back into a state meaning "nobody has looked at this".
 */
function StatusControl({
  ticketId,
  status,
  onChanged,
}: {
  ticketId: string;
  status: FeedbackListRow['status'];
  onChanged: () => void;
}) {
  const [saving, setSaving] = useState(false);

  const decided = (FEEDBACK_DECISION_STATUSES as readonly string[]).includes(status);

  return (
    <span className="flex items-center gap-2">
      {decided ? null : (
        <Badge variant={statusBadgeVariant(status)}>{FEEDBACK_STATUS_LABELS[status]}</Badge>
      )}

      <select
        aria-label={`Status of ${ticketId}`}
        value={decided ? status : ''}
        disabled={saving}
        onChange={(event) => {
          const next = event.target.value as FeedbackDecisionStatus | '';
          if (next === '') return;

          setSaving(true);
          void (async () => {
            try {
              await fetch(`/api/super-admin/feedback/${ticketId}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ status: next }),
              });
              onChanged();
            } finally {
              setSaving(false);
            }
          })();
        }}
        className="rounded-control border border-line-strong bg-surface-raised px-2 py-1 text-xs text-ink disabled:opacity-60"
      >
        <option value="" disabled>
          {decided ? FEEDBACK_STATUS_LABELS[status] : 'Set status…'}
        </option>
        {FEEDBACK_DECISION_STATUSES.map((value) => (
          <option key={value} value={value}>
            {FEEDBACK_STATUS_LABELS[value]}
          </option>
        ))}
      </select>
    </span>
  );
}
