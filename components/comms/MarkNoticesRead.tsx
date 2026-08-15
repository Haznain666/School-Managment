'use client';

import { useEffect, useRef } from 'react';

/**
 * Marks the notices on screen as read, once, after the page has rendered.
 *
 * ── Why this is a component and not part of the page ─────────────────────
 * Opening the board is what marks it read, and that is a write. A server
 * component cannot do it during render — a GET that mutates is a page that
 * changes what it shows every time a bot or a prefetch touches it. So the
 * marking happens after paint, from the browser, exactly once.
 *
 * ── Why nothing is shown when it fails ───────────────────────────────────
 * The reader has already read the notice; the badge is the only thing at
 * stake. An error toast for a failed read marker would interrupt somebody to
 * report a problem they cannot act on and do not care about. It is left
 * unread, and the next visit tries again.
 *
 * `useRef` rather than a state flag: React runs effects twice in development
 * and the guard has to survive that without causing a re-render of its own.
 */
export function MarkNoticesRead({
  announcementIds,
}: {
  announcementIds: readonly string[];
}) {
  const done = useRef(false);

  useEffect(() => {
    if (done.current || announcementIds.length === 0) return;
    done.current = true;

    void fetch('/api/school/notices/read', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ announcementIds }),
    }).catch(() => {
      // Deliberately silent. See the docblock.
    });
  }, [announcementIds]);

  return null;
}
