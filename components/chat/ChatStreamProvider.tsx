'use client';

import { useRouter } from 'next/navigation';
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

import { schoolFetch } from '@/lib/school-client';

import { useChatSound } from './useChatSound';
import {
  type ChatTransport,
  EAGER_POLL_SECONDS,
  IDLE_POLL_SECONDS,
  useChatStream,
} from './useChatStream';

/**
 * One chat stream per portal, mounted in the layout, listened to everywhere.
 *
 * ── The gap this closes ──────────────────────────────────────────────────
 * Sprint 25 gave chat a websocket and Sprint 24 gave it a poll, and both were
 * mounted inside `ChatWorkspace` — the chat screen. Every other page of every
 * portal was deaf. The product owner's report against Lahore Grammar is the
 * whole specification: a principal wrote to a parent, the parent was signed in
 * and looking at their dashboard, and *nothing* on that screen changed. No
 * bell, no badge, no sound. The only thing that ever reached them was the
 * digest email an hour later.
 *
 * So the stream moves up into the layout, where it runs on every page, and the
 * chat screen becomes one of its subscribers rather than its owner.
 *
 * ── One socket, not two ──────────────────────────────────────────────────
 * `ChatWorkspace` no longer calls `useChatStream` itself. If it did, the chat
 * screen would hold two Supabase clients, two channels and two poll loops
 * against the same table, and the second would be invisible — it would work,
 * which is what makes it the kind of waste nobody finds. It subscribes here
 * instead, through `useChatSignals`, and gets exactly the callback it had.
 *
 * ── What a signal does, in order ─────────────────────────────────────────
 * 1. **The chime**, if this person has not switched it off. It is the only one
 *    of the three that reaches somebody who is not looking at the screen.
 * 2. **The subscribers** — the chat screen, when it is open, refetching the
 *    thread and the inbox exactly as it always did.
 * 3. **`router.refresh()`**, debounced. This is what moves the bell and the
 *    sidebar badge, and it is deliberately not a fourth fetch endpoint: the
 *    counts already exist, computed in the layout on every render, and a
 *    refresh recomputes all three of them — bell, Messages, Announcements —
 *    from the code that was already the single source of truth for them. A new
 *    `/api/school/unread-counts` would be a second place for those numbers to
 *    be wrong.
 *
 * Debounced because a broadcast to a class arrives as a burst: five signals in
 * two seconds should be one re-render, not five.
 *
 * ── The socket is cheap and the fallback is not ──────────────────────────
 * The poll only stops once a real event has arrived over the wire, so somebody
 * who never receives a message never stops polling. On one screen that was
 * free; on every screen of every portal it is not, which is why this runs at
 * `IDLE_POLL_SECONDS` and hands `EAGER_POLL_SECONDS` to the chat screen while
 * it is mounted. See `useChatStream` for why that does not restart the socket.
 */

type Subscriber = (conversationIds: string[]) => void;

interface ChatStreamValue {
  /** Registers a listener. Returns its own unsubscribe. */
  subscribe: (fn: Subscriber) => () => void;
  /**
   * Declares this screen the reason latency matters, which speeds the poll up
   * while it is mounted. Returns the release.
   */
  claimEager: () => () => void;
  /** Recomputes the layout's counts now. For "I have just read this thread". */
  refreshCounts: () => void;
  /** Which transport is live, for the indicator the chat screen already shows. */
  transport: ChatTransport;
  /** Whether a chime plays. Owned here so one preference drives every screen. */
  soundEnabled: boolean;
  setSoundEnabled: (enabled: boolean) => void;
  /** Call from a real user gesture so the browser will let us have audio. */
  armSound: () => void;
}

const ChatStreamContext = createContext<ChatStreamValue | null>(null);

/** How long to gather a burst of signals into one re-render. */
const REFRESH_DEBOUNCE_MS = 700;

interface RealtimeConfig {
  soundEnabled?: boolean;
}

export function ChatStreamProvider({ children }: { children: ReactNode }) {
  const router = useRouter();

  const subscribers = useRef<Set<Subscriber>>(new Set());
  const refreshTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const eagerCount = useRef(0);
  const [eager, setEager] = useState(false);

  /*
   * Default on, matching `chat_settings.sound_enabled`'s own default, and
   * corrected from the server a moment later. Starting from `false` would
   * silence the first message of every session for everybody — the window
   * between mount and that response is exactly when somebody lands on a portal
   * they left open.
   */
  const [soundEnabled, setSoundEnabled] = useState(true);
  const { play, arm } = useChatSound(soundEnabled);

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      try {
        const config = await schoolFetch<RealtimeConfig>('/api/school/chat/realtime-config');
        if (cancelled || typeof config.soundEnabled !== 'boolean') return;
        setSoundEnabled(config.soundEnabled);
      } catch {
        // The default stands. A preference that could not be read is not worth
        // a message on screen, and the switch on the chat screen still works.
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  /*
   * Browsers refuse a page audio until it has had a real user gesture, so the
   * `AudioContext` is created on the first one and kept — see `useChatSound`.
   *
   * Listened for at the document, once, rather than on a handler the chat
   * screen used to own: the whole point of Sprint 29 is that the chime has to
   * work for somebody who is *not* on the chat screen, and a parent reading
   * their fees has clicked something. `once: true` unbinds it after the first
   * gesture, so this costs one listener per page load and nothing after.
   */
  useEffect(() => {
    const onGesture = (): void => {
      arm();
    };

    document.addEventListener('pointerdown', onGesture, { once: true });
    document.addEventListener('keydown', onGesture, { once: true });

    return () => {
      document.removeEventListener('pointerdown', onGesture);
      document.removeEventListener('keydown', onGesture);
    };
  }, [arm]);

  const refreshCounts = useCallback(() => {
    if (refreshTimer.current !== null) clearTimeout(refreshTimer.current);
    refreshTimer.current = setTimeout(() => {
      refreshTimer.current = null;
      router.refresh();
    }, REFRESH_DEBOUNCE_MS);
  }, [router]);

  const onSignal = useCallback(
    (conversationIds: string[]) => {
      /*
       * The chime first, and unconditionally: this fires only for a signal,
       * and a signal is only ever written for somebody *else's* message — see
       * `postMessage`, which excludes the sender from the recipient list. So
       * the "never chime at your own message" rule the chat screen enforces by
       * comparing sender ids is enforced here by the table.
       */
      play();

      for (const fn of [...subscribers.current]) {
        try {
          fn(conversationIds);
        } catch {
          // One badly behaved subscriber must not stop the bell updating.
        }
      }

      refreshCounts();
    },
    [play, refreshCounts],
  );

  const { transport } = useChatStream(
    onSignal,
    eager ? EAGER_POLL_SECONDS : IDLE_POLL_SECONDS,
  );

  const subscribe = useCallback((fn: Subscriber) => {
    subscribers.current.add(fn);
    return () => {
      subscribers.current.delete(fn);
    };
  }, []);

  const claimEager = useCallback(() => {
    eagerCount.current += 1;
    setEager(true);
    return () => {
      eagerCount.current -= 1;
      if (eagerCount.current <= 0) {
        eagerCount.current = 0;
        setEager(false);
      }
    };
  }, []);

  useEffect(
    () => () => {
      if (refreshTimer.current !== null) clearTimeout(refreshTimer.current);
    },
    [],
  );

  const value = useMemo<ChatStreamValue>(
    () => ({
      subscribe,
      claimEager,
      refreshCounts,
      transport,
      soundEnabled,
      setSoundEnabled,
      armSound: arm,
    }),
    [subscribe, claimEager, refreshCounts, transport, soundEnabled, arm],
  );

  return <ChatStreamContext.Provider value={value}>{children}</ChatStreamContext.Provider>;
}

/**
 * Subscribes to the portal's chat stream.
 *
 * Returns nulls when there is no provider above it rather than throwing. A
 * screen that renders outside a portal layout — a print route, a preview —
 * should lose its live updates, not its render.
 */
export function useChatSignals(onSignal: Subscriber, eagerly = false): {
  transport: ChatTransport;
  soundEnabled: boolean;
  setSoundEnabled: (enabled: boolean) => void;
  armSound: () => void;
  refreshCounts: () => void;
} {
  const context = useContext(ChatStreamContext);

  // Held in a ref for the reason `useChatStream` holds its own: a caller
  // passing an inline arrow would otherwise re-subscribe on every render.
  const handler = useRef(onSignal);
  handler.current = onSignal;

  const subscribe = context?.subscribe;
  const claimEager = context?.claimEager;

  useEffect(() => {
    if (subscribe === undefined) return;
    return subscribe((ids) => {
      handler.current(ids);
    });
  }, [subscribe]);

  useEffect(() => {
    if (!eagerly || claimEager === undefined) return;
    return claimEager();
  }, [eagerly, claimEager]);

  const noop = useCallback(() => undefined, []);

  return {
    transport: context?.transport ?? 'connecting',
    soundEnabled: context?.soundEnabled ?? true,
    setSoundEnabled: context?.setSoundEnabled ?? noop,
    armSound: context?.armSound ?? noop,
    refreshCounts: context?.refreshCounts ?? noop,
  };
}
