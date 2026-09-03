'use client';

import { useEffect, useRef, useState } from 'react';

import { schoolFetch } from '@/lib/school-client';

/**
 * The one place chat learns that something happened.
 *
 * ── The contract, and why the transport is behind it ─────────────────────
 * A signal is `{conversationId, messageId}` and nothing readable. Whatever
 * delivers it, the caller does the same thing: fetch the content through the
 * ordinary API, where `withSchoolAuth` re-resolves membership from
 * `school_users` on that request. That is what keeps a child's privacy off a
 * JWT claim `STATE.md` says goes stale on a role change — see
 * `db/schema/chat-signals.ts` for the argument in full.
 *
 * Because the contract carries no content, the transport underneath it is an
 * implementation detail that can change without touching a single screen.
 *
 * ── What this does today, stated plainly ─────────────────────────────────
 * It **polls** `/api/school/chat/signals?since=`. It is not Supabase Realtime
 * yet.
 *
 * The server side is Realtime-ready: `chat_signals` exists, row-level security
 * is on it, and its one SELECT policy is a column comparison against
 * `auth.uid()`. What is missing is the client half, and adding it means adding
 * `@supabase/supabase-js` — which this repository has deliberately never
 * depended on (`lib/storage.ts` talks to Storage over raw REST and says why),
 * and which warns on the Node 20 the host pins. That is a dependency decision
 * to make against the real host rather than against a local dev server, so it
 * is Sprint 25's first task and this is the honest interim.
 *
 * The poll is cheap by construction: one indexed read of
 * `(recipient_auth_user_id, created_at)` that returns nothing the overwhelming
 * majority of the time. It is not free, and the interval is deliberately slow
 * enough to say so — chat here is correspondence, not instant messaging, and
 * `CLAUDE.md` measures an uncached request against this origin at ~1s.
 *
 * ── It stops when nobody is looking ──────────────────────────────────────
 * A hidden tab polls nothing. Without that, every abandoned tab in a staff room
 * is a request every eight seconds for the rest of the day, which is the shape
 * of load that makes a shared plan slow for everybody.
 */

/** How often to ask, while the tab is visible. */
const POLL_SECONDS = 8;

export interface ChatSignal {
  conversationId: string;
  messageId: string;
  createdAt: string;
}

interface SignalResponse {
  signals: ChatSignal[];
  from: string;
}

/**
 * Calls `onSignal` for every conversation that has something new.
 *
 * Deduplicated to one call per conversation per poll: five messages arriving
 * together are one reason to refetch a thread, not five.
 */
export function useChatStream(onSignal: (conversationIds: string[]) => void): {
  connected: boolean;
} {
  const [connected, setConnected] = useState(false);

  // The callback is held in a ref so a caller passing an inline arrow does not
  // restart the poll on every render — the mistake that turns an 8-second
  // interval into one request per keystroke.
  const handler = useRef(onSignal);
  handler.current = onSignal;

  const since = useRef(new Date().toISOString());

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const tick = async (): Promise<void> => {
      if (cancelled) return;

      if (document.visibilityState !== 'visible') {
        schedule();
        return;
      }

      try {
        const result = await schoolFetch<SignalResponse>(
          `/api/school/chat/signals?since=${encodeURIComponent(since.current)}`,
        );

        if (cancelled) return;
        setConnected(true);

        if (result.signals.length > 0) {
          const newest = result.signals[result.signals.length - 1];
          if (newest !== undefined) since.current = newest.createdAt;

          const ids = [...new Set(result.signals.map((signal) => signal.conversationId))];
          handler.current(ids);
        }
      } catch {
        // A failed poll is not worth a message on screen: the next one is eight
        // seconds away, and a red banner every time a phone changes cell tower
        // is what teaches people to ignore banners.
        if (!cancelled) setConnected(false);
      }

      schedule();
    };

    const schedule = (): void => {
      if (cancelled) return;
      timer = setTimeout(() => void tick(), POLL_SECONDS * 1000);
    };

    void tick();

    // Coming back to a tab should feel immediate rather than waiting out the
    // interval that was running while it was hidden.
    const onVisible = (): void => {
      if (document.visibilityState === 'visible') void tick();
    };
    document.addEventListener('visibilitychange', onVisible);

    return () => {
      cancelled = true;
      if (timer !== null) clearTimeout(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, []);

  return { connected };
}
