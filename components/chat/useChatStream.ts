'use client';

import { createClient, type RealtimeChannel, type SupabaseClient } from '@supabase/supabase-js';
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
 * Because the contract carries no content, what delivers it is an
 * implementation detail. This hook has now had two implementations and the
 * screens above it did not change for either.
 *
 * ── Two transports, and the fallback is not decoration ───────────────────
 * **Socket:** Supabase Realtime, `postgres_changes` INSERT on `chat_signals`,
 * filtered server-side by that table's RLS policy so a subscriber receives only
 * their own rows.
 *
 * **Poll:** the Sprint 24 implementation, every 8 seconds against
 * `/chat/signals?since=`.
 *
 * The poll stays because the socket has several ways to be silently useless
 * here and only one of them is visible. If `chat_signals` is not in the
 * `supabase_realtime` publication, the channel reports `SUBSCRIBED` and
 * delivers nothing, forever. If the access token is missing or expired, the
 * connection authenticates as `anon`, matches no row under the policy, and
 * again delivers nothing while looking healthy.
 *
 * So the socket is **proven, not assumed**: nothing switches the poll off until
 * a real signal has arrived over the wire, and any error, close or timeout puts
 * the poll straight back. `transport` reports which is live so QA can see it
 * and a support call can ask.
 *
 * ── The access token is held in a closure and nowhere else ───────────────
 * `/api/school/chat/realtime-config` explains at length why the token is handed
 * to the browser at all. The obligation that comes with it lives here: it is
 * assigned to a local, **never** written to `localStorage`, `sessionStorage`, a
 * cookie or the DOM, never logged, and re-fetched on every reconnect rather
 * than cached against its own expiry.
 */

/** How often to ask, while polling and the tab is visible. */
const POLL_SECONDS = 8;

/** How long to let the socket prove itself before the poll stops backing it. */
const SOCKET_PROVE_MS = 20_000;

export interface ChatSignal {
  conversationId: string;
  messageId: string;
  createdAt: string;
}

interface SignalResponse {
  signals: ChatSignal[];
  from: string;
}

interface RealtimeConfig {
  supabaseUrl: string | null;
  anonKey: string | null;
  accessToken: string | null;
  vapidPublicKey: string | null;
}

export type ChatTransport = 'connecting' | 'socket' | 'polling';

/** The shape `chat_signals` arrives in over the wire. Snake case, from Postgres. */
interface SignalRow {
  conversation_id?: unknown;
  message_id?: unknown;
  created_at?: unknown;
}

export function useChatStream(onSignal: (conversationIds: string[]) => void): {
  transport: ChatTransport;
} {
  const [transport, setTransport] = useState<ChatTransport>('connecting');

  // Held in a ref so a caller passing an inline arrow does not restart the
  // whole transport on every render — the mistake that turns an 8-second
  // interval into one request per keystroke.
  const handler = useRef(onSignal);
  handler.current = onSignal;

  const since = useRef(new Date().toISOString());

  useEffect(() => {
    let cancelled = false;
    let pollTimer: ReturnType<typeof setTimeout> | null = null;
    let proveTimer: ReturnType<typeof setTimeout> | null = null;
    let client: SupabaseClient | null = null;
    let channel: RealtimeChannel | null = null;

    /** True once a signal has actually arrived over the socket. */
    let socketProven = false;
    /** True while the poll loop should keep scheduling itself. */
    let polling = true;

    const deliver = (ids: string[]): void => {
      if (cancelled || ids.length === 0) return;
      handler.current([...new Set(ids)]);
    };

    /** Everything missed while disconnected. Runs before trusting the socket. */
    const catchUp = async (): Promise<void> => {
      const result = await schoolFetch<SignalResponse>(
        `/api/school/chat/signals?since=${encodeURIComponent(since.current)}`,
      );

      if (cancelled) return;

      const newest = result.signals[result.signals.length - 1];
      if (newest !== undefined) since.current = newest.createdAt;

      deliver(result.signals.map((signal) => signal.conversationId));
    };

    /* ---------------- the poll, which is also the fallback ------------- */

    const schedulePoll = (): void => {
      if (cancelled || !polling) return;
      pollTimer = setTimeout(() => void tick(), POLL_SECONDS * 1000);
    };

    const tick = async (): Promise<void> => {
      if (cancelled || !polling) return;

      if (document.visibilityState !== 'visible') {
        schedulePoll();
        return;
      }

      try {
        await catchUp();
        if (!socketProven) setTransport('polling');
      } catch {
        // A failed poll is not worth a message on screen: the next one is eight
        // seconds away, and a red banner every time a phone changes cell tower
        // is what teaches people to ignore banners.
      }

      schedulePoll();
    };

    const startPolling = (): void => {
      if (polling) return;
      polling = true;
      void tick();
    };

    const stopPolling = (): void => {
      polling = false;
      if (pollTimer !== null) clearTimeout(pollTimer);
      pollTimer = null;
    };

    /* ---------------------------- the socket --------------------------- */

    const fallBackToPolling = (): void => {
      if (cancelled) return;
      socketProven = false;
      setTransport('polling');
      startPolling();
    };

    const openSocket = async (): Promise<void> => {
      let config: RealtimeConfig;

      try {
        config = await schoolFetch<RealtimeConfig>('/api/school/chat/realtime-config');
      } catch {
        fallBackToPolling();
        return;
      }

      if (cancelled) return;

      const { supabaseUrl, anonKey, accessToken } = config;
      if (supabaseUrl === null || anonKey === null || accessToken === null) {
        // A deployment without the socket's prerequisites polls, and says so.
        fallBackToPolling();
        return;
      }

      client = createClient(supabaseUrl, anonKey, {
        auth: {
          // Nothing about this client is a session. It borrows a token for a
          // websocket and must never write one anywhere.
          persistSession: false,
          autoRefreshToken: false,
          detectSessionInUrl: false,
        },
        realtime: { params: { eventsPerSecond: 5 } },
      });

      // What makes `auth.uid()` resolve inside the RLS policy. Without it the
      // connection is `anon`, matches no row, and delivers nothing in silence.
      await client.realtime.setAuth(accessToken);

      channel = client
        .channel('chat-signals')
        .on(
          'postgres_changes',
          { event: 'INSERT', schema: 'public', table: 'chat_signals' },
          (payload) => {
            const row = payload.new as SignalRow;
            const conversationId = row.conversation_id;
            const createdAt = row.created_at;

            if (typeof conversationId !== 'string') return;
            if (typeof createdAt === 'string') since.current = createdAt;

            // The socket has now demonstrably delivered something, which is
            // the only evidence that it works. Only now does the poll stop.
            if (!socketProven) {
              socketProven = true;
              setTransport('socket');
              stopPolling();
            }

            deliver([conversationId]);
          },
        )
        .subscribe((status) => {
          if (cancelled) return;

          if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
            fallBackToPolling();
            return;
          }

          if (status === 'SUBSCRIBED') {
            // Deliberately NOT `setTransport('socket')`. `SUBSCRIBED` is what a
            // channel on an unpublished table reports too, and believing it is
            // exactly how this feature fails invisibly. Catch up over HTTP,
            // then wait for a real event to prove the wire.
            void catchUp().catch(() => {
              /* The poll is still running underneath. */
            });

            proveTimer = setTimeout(() => {
              if (!cancelled && !socketProven) setTransport('polling');
            }, SOCKET_PROVE_MS);
          }
        });
    };

    /* ------------------------------ start ------------------------------ */

    void tick();
    void openSocket();

    // Coming back to a tab should feel immediate rather than waiting out an
    // interval that ran while it was hidden — and a socket that died while the
    // laptop was asleep reports nothing until something is asked of it.
    const onVisible = (): void => {
      if (document.visibilityState !== 'visible') return;
      void catchUp().catch(() => {
        /* Handled by the next poll. */
      });
    };
    document.addEventListener('visibilitychange', onVisible);

    return () => {
      cancelled = true;
      stopPolling();
      if (proveTimer !== null) clearTimeout(proveTimer);
      document.removeEventListener('visibilitychange', onVisible);
      if (channel !== null && client !== null) void client.removeChannel(channel);
      void client?.realtime.disconnect();
    };
  }, []);

  return { transport };
}
