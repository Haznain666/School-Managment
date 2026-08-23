import Link from 'next/link';

import { Card, CardTitle } from '@/components/ui/Card';
import type { NoticeRow } from '@/lib/announcement-queries';

const DATE = new Intl.DateTimeFormat('en-GB', {
  day: 'numeric',
  month: 'short',
});

export interface DashboardNoticesProps {
  notices: readonly NoticeRow[];
  /** Where the full board lives for this portal. */
  href: string;
  /** What to say when there is nothing, in the reader's own terms. */
  emptyMessage: string;
}

/**
 * The three most recent notices, on a dashboard.
 *
 * ── Why this is not `NoticeBoard` ────────────────────────────────────────
 * `NoticeBoard` mounts `MarkNoticesRead`, which is correct on the announcements
 * screen — opening it *is* reading them — and wrong here. A dashboard is landed
 * on several times a day without being read, and a board that cleared the
 * unread badge on arrival would quietly guarantee that the one notice that
 * mattered was the one nobody opened.
 *
 * So this is a preview with a link, and the link is where the reading happens.
 * Unread notices are marked in words as well as weight, because a bold title is
 * not a status anyone can rely on seeing.
 */
export function DashboardNotices({ notices, href, emptyMessage }: DashboardNoticesProps) {
  const recent = notices.slice(0, 3);
  const unread = notices.filter((notice) => !notice.isRead).length;

  return (
    <Card
      header={
        <CardTitle
          title="Announcements"
          description={
            unread === 0
              ? 'Notices from your school, newest first.'
              : `${unread} unread notice${unread === 1 ? '' : 's'}.`
          }
          action={
            <Link href={href} className="text-sm font-medium text-brand-primary hover:underline">
              All notices
            </Link>
          }
        />
      }
      className="p-0"
    >
      {recent.length === 0 ? (
        <p className="px-5 py-4 text-sm text-ink-muted">{emptyMessage}</p>
      ) : (
        <ul className="divide-y divide-line">
          {recent.map((notice) => (
            <li key={notice.id} className="px-5 py-3">
              <Link href={href} className="block">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <span className="font-medium text-ink">{notice.title}</span>
                  <span className="text-xs text-ink-muted">
                    {notice.sentAt === null ? '' : DATE.format(notice.sentAt)}
                    {notice.isRead ? '' : ' · Unread'}
                  </span>
                </div>
                <p className="mt-0.5 line-clamp-2 text-sm text-ink-muted">{notice.body}</p>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
