import { Badge } from '@/components/ui/Badge';
import { Card } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/EmptyState';
import { Megaphone } from 'lucide-react';

import { MarkNoticesRead } from './MarkNoticesRead';
import type { NoticeRow } from '@/lib/announcement-queries';

/**
 * The notice board, identical on all four portals.
 *
 * One component because a notice is the same object to a parent, a student, a
 * teacher and an administrator, and four boards would drift — the one that
 * mattered least would be the one that stopped showing the unread marker.
 *
 * ── Server-rendered, with one client component inside it ─────────────────
 * The board itself is server-rendered. `MarkNoticesRead` is the only client
 * part: opening the page is what marks the notices read, and that is a write,
 * so it cannot happen during render. It has no markup of its own.
 */

const DATE = new Intl.DateTimeFormat('en-GB', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
});

export interface NoticeBoardProps {
  notices: readonly NoticeRow[];
  /** What to say when there is nothing, in the reader's own terms. */
  emptyMessage: string;
}

export function NoticeBoard({ notices, emptyMessage }: NoticeBoardProps) {
  if (notices.length === 0) {
    return (
      <EmptyState
        icon={Megaphone}
        title="Nothing on the board"
        description={emptyMessage}
      />
    );
  }

  const unread = notices.filter((notice) => !notice.isRead).map((notice) => notice.id);

  return (
    <div className="space-y-4">
      {/*
        Marks what is on screen, not everything ever sent. A reader who scrolls
        no further than the first page has not read page two, and a badge that
        cleared itself for notices they never saw would be worse than no badge.
      */}
      <MarkNoticesRead announcementIds={unread} />

      {notices.map((notice) => (
        <Card key={notice.id}>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <h3 className="text-base font-semibold text-ink">{notice.title}</h3>
              <p className="mt-0.5 text-xs text-ink-muted">
                {notice.sentAt === null ? '' : DATE.format(notice.sentAt)}
              </p>
            </div>
            {notice.isRead ? null : <Badge variant="info">New</Badge>}
          </div>

          {/*
            `whitespace-pre-line`: the body is plain text a school typed, and
            the paragraph breaks they put in are the only formatting it has.
            Rendering it as one run would turn every notice into a wall.
          */}
          <p className="mt-3 whitespace-pre-line text-sm text-ink">{notice.body}</p>
        </Card>
      ))}
    </div>
  );
}

/** The board's own icon, exported so a page header and the sidebar can match. */
export const NOTICE_ICON = Megaphone;
