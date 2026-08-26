'use client';

import { Bell } from 'lucide-react';
import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';

import { Icon } from '@/components/ui/Icon';
import { cn } from '@/lib/utils';

/**
 * The in-app bell, on the platform surface and inside every school portal.
 *
 * ── The unread count arrives from the server, and then updates itself ────
 * `initialUnread` is read in the layout, so the badge is correct in the first
 * painted frame rather than appearing a second later — which on a portal people
 * land on six times a day is the difference between a feature and a flicker.
 * After that the panel refreshes on open, which is the only moment a stale
 * count is about to be looked at closely.
 *
 * There is deliberately **no polling**. A 30-second interval on a layout that
 * renders on every page of five portals is a request per user per half minute,
 * against an origin measured at ~1s per uncached hit (§5aq), for a number that
 * changes a handful of times a week. The email is what makes a notification
 * timely; the bell is what makes it findable.
 *
 * ── Opening it marks everything read ─────────────────────────────────────
 * Not clicking an individual row. A bell is a glance, and a person who opens it
 * has seen what is in it — leaving items unread because they did not click each
 * one turns the badge into a number that only ever grows, which is how a badge
 * stops being read at all. The write is fire-and-forget for the same reason the
 * count is not polled: nothing depends on it having landed, and the local state
 * has already moved.
 */

export interface NotificationItem {
  id: string;
  title: string;
  body: string;
  href: string;
  readAt: string | null;
  createdAt: string;
}

export interface NotificationBellProps {
  /** `/api/school/notifications` or `/api/super-admin/notifications`. */
  endpoint: string;
  initialUnread: number;
  /** Matches the surface it sits on — see `GlobalSearch` for the same split. */
  tone?: 'brand' | 'neutral';
}

interface ApiEnvelope {
  ok: boolean;
  data?: { notifications: NotificationItem[]; unread: number };
}

export function NotificationBell({
  endpoint,
  initialUnread,
  tone = 'brand',
}: NotificationBellProps) {
  const [open, setOpen] = useState(false);
  const [unread, setUnread] = useState(initialUnread);
  const [items, setItems] = useState<NotificationItem[] | null>(null);
  const [failed, setFailed] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  /*
   * The server's count wins whenever the layout re-renders — a navigation, a
   * `router.refresh()`. Without this the badge would keep whatever the last
   * open left it at for the rest of the session.
   */
  useEffect(() => {
    setUnread(initialUnread);
  }, [initialUnread]);

  useEffect(() => {
    if (!open) return;

    const onPointerDown = (event: PointerEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };

    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  const onOpen = useCallback(() => {
    setOpen(true);
    setFailed(false);

    void (async () => {
      try {
        const response = await fetch(endpoint);
        const payload = (await response.json()) as ApiEnvelope;

        if (!payload.ok || payload.data === undefined) {
          setFailed(true);
          return;
        }

        setItems(payload.data.notifications);

        // Only now is the count cleared: the rows are on screen, so "read" is
        // a true statement rather than an optimistic one.
        if (payload.data.unread > 0) {
          setUnread(0);
          void fetch(endpoint, { method: 'POST' }).catch(() => {
            // Nothing depends on this landing. The next server render restores
            // the real count if it did not.
          });
        }
      } catch {
        setFailed(true);
      }
    })();
  }, [endpoint]);

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={() => {
          if (open) setOpen(false);
          else onOpen();
        }}
        aria-expanded={open}
        className={cn(
          'relative rounded-control p-2 transition-colors duration-fast',
          tone === 'brand'
            ? 'text-brand-onPrimary hover:bg-brand-onPrimary/15'
            : 'text-ink-muted hover:bg-surface-hover hover:text-ink',
        )}
      >
        <Icon
          as={Bell}
          size="md"
          label={unread === 0 ? 'Notifications' : `Notifications, ${unread} unread`}
        />

        {unread > 0 ? (
          // The number is inside the button's accessible name above, so this is
          // decorative: a screen reader hears "Notifications, 3 unread" once
          // rather than the digit twice.
          <span
            aria-hidden="true"
            className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-status-danger px-1 text-[10px] font-bold leading-none text-status-danger-on"
          >
            {unread > 99 ? '99+' : unread}
          </span>
        ) : null}
      </button>

      {open ? (
        <div className="absolute right-0 top-full z-dropdown mt-2 max-h-[70vh] w-80 overflow-y-auto rounded-card border border-line bg-surface-raised text-ink shadow-modal">
          <p className="border-b border-line bg-surface-sunken px-4 py-2 text-xs font-semibold uppercase tracking-wide text-ink-muted">
            Notifications
          </p>

          {failed ? (
            <p className="px-4 py-6 text-center text-sm text-ink-muted">
              These could not be loaded. Everything else on this page is current.
            </p>
          ) : items === null ? (
            <p className="px-4 py-6 text-center text-sm text-ink-muted">Loading…</p>
          ) : items.length === 0 ? (
            <p className="px-4 py-6 text-center text-sm text-ink-muted">
              Nothing yet. Anything that needs you will appear here.
            </p>
          ) : (
            <ul className="divide-y divide-line">
              {items.map((item) => (
                <li key={item.id}>
                  <Link
                    href={item.href}
                    onClick={() => {
                      setOpen(false);
                    }}
                    className={cn(
                      'block px-4 py-3 transition-colors duration-fast hover:bg-surface-hover',
                      // A left edge rather than a coloured background: the row
                      // still has to be legible on a school's own palette, and
                      // a tinted row on a tinted surface is neither.
                      item.readAt === null && 'border-l-2 border-brand-primary',
                    )}
                  >
                    <span className="block text-sm font-medium text-ink">{item.title}</span>
                    <span className="mt-0.5 block text-sm text-ink-muted">{item.body}</span>
                    <span className="mt-1 block text-xs text-ink-faint">
                      {formatWhen(item.createdAt)}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : null}
    </div>
  );
}

/**
 * "3 hours ago", and an absolute date past a week.
 *
 * Relative time is what a bell wants — "is this new" is the only question — and
 * absolute time is what anything older wants, because "23 days ago" is a number
 * nobody converts. Computed in the browser from an ISO string, so there is no
 * server/client timezone disagreement to discard a render over; the panel does
 * not exist in the server HTML at all.
 */
function formatWhen(iso: string): string {
  const then = new Date(iso);
  const minutes = Math.round((Date.now() - then.getTime()) / 60000);

  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? '' : 's'} ago`;

  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`;

  const days = Math.round(hours / 24);
  if (days <= 7) return `${days} day${days === 1 ? '' : 's'} ago`;

  return then.toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}
