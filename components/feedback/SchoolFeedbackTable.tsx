'use client';

import { MessageSquareText } from 'lucide-react';
import Link from 'next/link';

import { Badge } from '@/components/ui/Badge';
import { DataTable } from '@/components/ui/DataTable';
import {
  FEEDBACK_NATURES,
  FEEDBACK_NATURE_LABELS,
  FEEDBACK_STATUSES,
  FEEDBACK_STATUS_LABELS,
} from '@/db/schema';
import { natureBadgeVariant, statusBadgeVariant } from '@/lib/feedback';
import type { FeedbackListRow } from '@/lib/feedback-queries';

/**
 * A school's own feedback, listed.
 *
 * Client mode. A school sends a handful of these a year, so the whole list
 * arrives once and is searched, sorted and paged in the browser — the same
 * judgement §5bb made about `StaffManager`, and for the same reason: a round
 * trip per keystroke for a list that fits in memory several times over is a
 * cost with nothing on the other side of it.
 *
 * The row is not highlighted for a bug here. Urgency is a signal to the person
 * who has to act, and on this screen that is us, not them — a school marking
 * its own report urgent and then seeing it in red every day until we ship
 * learns only that the colour means nothing.
 */

export interface SchoolFeedbackTableProps {
  rows: readonly FeedbackListRow[];
}

export function SchoolFeedbackTable({ rows }: SchoolFeedbackTableProps) {
  return (
    <DataTable<FeedbackListRow>
      caption="Feedback this school has sent"
      rows={rows}
      getRowKey={(row) => row.id}
      defaultSort={{ columnId: 'createdAt', direction: 'desc' }}
      itemNoun={{ singular: 'message', plural: 'messages' }}
      search={{ placeholder: 'Search titles…' }}
      emptyIcon={MessageSquareText}
      emptyTitle="No feedback yet"
      emptyDescription="Tell us about a bug, or ask for something. Every message reaches the people who build this."
      emptyAction={
        <Link
          href="/dashboard/feedback/new"
          className="rounded-control bg-brand-primary px-3 py-2 text-sm font-medium text-brand-onPrimary"
        >
          Send feedback
        </Link>
      }
      noResultTitle="Nothing matches those filters"
      noResultDescription="Clear them to see everything this school has sent."
      filters={[
        {
          id: 'nature',
          label: 'Nature',
          // `DataTable` defaults this to `All <label>` lowercased, which reads
          // "All nature". Both filters name their own no-choice option.
          allLabel: 'Every nature',
          options: FEEDBACK_NATURES.map((value) => ({
            value,
            label: FEEDBACK_NATURE_LABELS[value],
          })),
          rowValue: (row) => row.nature,
        },
        {
          id: 'status',
          label: 'Status',
          allLabel: 'Any status',
          options: FEEDBACK_STATUSES.map((value) => ({
            value,
            label: FEEDBACK_STATUS_LABELS[value],
          })),
          rowValue: (row) => row.status,
        },
      ]}
      columns={[
        {
          id: 'title',
          header: 'Title',
          rowHeader: true,
          sortValue: (row) => row.title,
          searchValue: (row) => row.title,
          cell: (row) => (
            <Link
              href={`/dashboard/feedback/${row.id}`}
              className="font-medium text-brand-primaryInk hover:underline"
            >
              {row.title}
            </Link>
          ),
        },
        {
          id: 'nature',
          header: 'Nature',
          sortValue: (row) => row.nature,
          cell: (row) => (
            <Badge variant={natureBadgeVariant(row.nature)}>
              {FEEDBACK_NATURE_LABELS[row.nature]}
            </Badge>
          ),
        },
        {
          id: 'status',
          header: 'Status',
          sortValue: (row) => row.status,
          cell: (row) => (
            <Badge variant={statusBadgeVariant(row.status)}>
              {FEEDBACK_STATUS_LABELS[row.status]}
            </Badge>
          ),
        },
        {
          id: 'replies',
          header: 'Replies',
          kind: 'number',
          sortValue: (row) => row.replyCount,
          cell: (row) => (row.replyCount === 0 ? '—' : row.replyCount),
        },
        {
          id: 'createdAt',
          header: 'Sent',
          kind: 'date',
          sortValue: (row) => row.createdAt,
          muted: true,
          cell: (row) => new Date(row.createdAt).toLocaleDateString(),
        },
      ]}
    />
  );
}
