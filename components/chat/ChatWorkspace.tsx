'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { Input } from '@/components/ui/Input';
import { Textarea } from '@/components/ui/Textarea';
import { schoolErrorMessage, schoolFetch } from '@/lib/school-client';
import { cn } from '@/lib/utils';
import { ROLE_LABELS, type UserRole } from '@/types/school-auth';

import { ChatNotificationControls } from './ChatNotificationControls';
import { useChatSignals } from './ChatStreamProvider';

/**
 * The chat screen, shared by all four portals.
 *
 * One component rather than four, because the differences between what a
 * parent, a pupil, a teacher and an administrator see are differences in *what
 * the server answers*, not in what the screen does. `resolveReachable` returns
 * an empty list for a pupil with no live grant and four desks for a parent, and
 * this renders whichever it gets. Four copies of this file would be four places
 * for the composer's refusal handling to drift.
 *
 * ── The refusals are the interface ───────────────────────────────────────
 * Nearly everything this module does is say no: the window has closed, you have
 * three unanswered messages, students cannot be messaged at this hour, that ban
 * was set by the principal. Every one of those arrives from the server as a
 * sentence meant to be read by the person who hit it, and this renders it
 * verbatim rather than mapping it to "Something went wrong". A refusal a person
 * cannot act on is the same as a bug to them.
 *
 * ── One pane at a time on a phone, two on a desk ─────────────────────────
 * Sprint 26. Below `lg` the list and the thread used to stack, so a phone
 * showed a 32rem-tall inbox and the conversation began somewhere past the fold
 * — every reply meant scrolling past the whole list to find the box, and the
 * transcript's own scroll fought the page's. It is now master/detail: the list
 * until something is open, the thread once something is, and a Back control
 * that is the only way between them. Above `lg` both are visible and nothing
 * has changed; `hidden lg:flex` rather than a media-query hook, so the two
 * panes are one DOM and a resize does not remount the composer mid-draft.
 *
 * ── The banner is a safeguarding control, not decoration ─────────────────
 * A thread involving a pupil says who can read it, to everybody in it.
 * `ROADMAP.md` agreed that administrators may read pupil conversations; the
 * disclosure is what makes that a deterrent rather than surveillance, and it is
 * the half that is easy to leave out.
 */

export interface ChatConversationRow {
  conversationId: string;
  kind: string;
  subject: string | null;
  roleInbox: string | null;
  status: string;
  lastMessageAt: string | null;
  unread: boolean;
  canPost: boolean;
  counterparty: string;
  claimedByName: string | null;
  claimable: boolean;
}

export interface ChatMessageRow {
  id: string;
  senderSchoolUserId: string | null;
  senderName: string;
  senderRole: string;
  kind: string;
  body: string | null;
  redactedAt: string | null;
  redactionReason: string | null;
  createdAt: string;
}

export interface ReachableTarget {
  kind: 'person' | 'inbox';
  id: string;
  name: string;
  detail: string;
  /** Sprint 33c. Null for a desk — it is not a role and is not held by one. */
  role: UserRole | null;
  /** Null means the whole school, as `branch_id` has since Sprint 19a. */
  branchName: string | null;
}

/** The chip a target sits under. A desk is its own group, not a role. */
const DESK_GROUP = 'inbox';

function groupOf(target: ReachableTarget): string {
  return target.kind === 'inbox' ? DESK_GROUP : (target.role ?? 'other');
}

function groupLabel(group: string): string {
  if (group === DESK_GROUP) return 'School offices';
  if (group === 'other') return 'Other';
  return ROLE_LABELS[group as UserRole] ?? group.replace(/_/g, ' ');
}

/**
 * Does this target match what was typed? Sprint 33c, C3.
 *
 * Over the **name, the detail and the campus** — because the detail is now the
 * thing a person actually remembers. A teacher looking for a father types the
 * child's name, not the father's; a head looking for a pupil types "5 A". Both
 * of those are in `detail` and neither is in `name`.
 *
 * Client-side, over a list the server already derived for this one caller.
 * `GET /api/school/chat/reachable` takes no search term and its docblock says
 * at length why — it is not a directory, it answers for the caller and nobody
 * else — and adding a query parameter would turn it into one. The list is small
 * by construction for a parent and a pupil, and for staff it is the school's
 * own directory, which they already have on the users screen.
 */
function matchesSearch(target: ReachableTarget, needle: string): boolean {
  if (needle === '') return true;
  const hay = `${target.name} ${target.detail} ${target.branchName ?? ''}`.toLowerCase();
  return needle
    .toLowerCase()
    .split(/\s+/)
    .filter((word) => word !== '')
    .every((word) => hay.includes(word));
}

export interface ChatAttachmentRow {
  id: string;
  messageId: string;
  fileName: string;
  contentType: string;
  sizeBytes: number;
}

export interface ChatWorkspaceProps {
  /** The caller's own `school_users.id`, to put their messages on the right. */
  meId: string;
  /** Staff may attach a file; pupils and parents are text-only. */
  canAttach?: boolean;
  /** Shown above a thread that involves a pupil. */
  auditNotice: string | null;
  /** Whether the composer offers to start a new conversation at all. */
  canInitiate: boolean;
  /**
   * The desks this reader may take an enquiry from — `claimableInboxes(role)`,
   * resolved on the server.
   *
   * A list rather than a boolean because the answer is per desk: a teacher
   * holds none of them, an accountant holds Accounts, a head holds their own
   * office. A button offered to somebody the route will refuse is worse than no
   * button.
   *
   * `POST …/claim` has existed since Sprint 24 and **had no caller anywhere in
   * the product** — the same shape as Sprint 27's orphaned holiday notice, and
   * the reason the rule in `STATE.md` is *open the screen and look for the
   * button*. This prop is that button.
   */
  claimableDesks?: readonly string[];
  /** What to say when there is nothing and nothing can be started. */
  emptyMessage: string;
}

interface InboxResponse {
  conversations: ChatConversationRow[];
  unread: number;
}

export function ChatWorkspace({
  meId,
  canAttach = false,
  auditNotice,
  canInitiate,
  claimableDesks = [],
  emptyMessage,
}: ChatWorkspaceProps) {
  const [conversations, setConversations] = useState<ChatConversationRow[] | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessageRow[]>([]);
  const [targets, setTargets] = useState<ReachableTarget[] | null>(null);

  const [draft, setDraft] = useState('');
  const [subject, setSubject] = useState('');
  const [composing, setComposing] = useState(false);
  const [targetKey, setTargetKey] = useState('');
  // Sprint 33c. The two filters over the resolved list. `null` on the chip row
  // means "everybody", which is a state and not the absence of one.
  const [targetGroup, setTargetGroup] = useState<string | null>(null);
  const [targetSearch, setTargetSearch] = useState('');

  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [attachments, setAttachments] = useState<ChatAttachmentRow[]>([]);
  const [file, setFile] = useState<File | null>(null);

  const transcriptEnd = useRef<HTMLDivElement | null>(null);
  const fileInput = useRef<HTMLInputElement | null>(null);

  /*
   * The portal's chat stream, subscribed to here rather than opened here.
   * Sprint 29 moved the socket up into the layout so every page hears a message
   * arrive; this screen is now one of its listeners.
   *
   * It is subscribed *before* `loadInbox` and `loadMessages` are defined
   * because `refreshCounts` is one of their dependencies, and a `useCallback`
   * dependency array naming a `const` declared further down is a temporal-dead-
   * zone throw on first render rather than a lint complaint. The real handler
   * is therefore reached through a ref, which is the same indirection
   * `useChatStream` uses on its own callback and for the same reason.
   *
   * `true` claims the fast poll: this is the one screen where the delay is the
   * product, and the layout's provider otherwise runs at a much slower interval
   * because it runs everywhere.
   */
  const signalHandler = useRef<(conversationIds: string[]) => void>(() => undefined);
  const { setSoundEnabled, refreshCounts, setOpenConversation } = useChatSignals(
    useCallback((conversationIds: string[]) => {
      signalHandler.current(conversationIds);
    }, []),
    true,
  );

  const loadInbox = useCallback(async (): Promise<ChatConversationRow[]> => {
    const result = await schoolFetch<InboxResponse>('/api/school/chat/conversations');
    setConversations(result.conversations);
    return result.conversations;
  }, []);

  const loadMessages = useCallback(async (conversationId: string): Promise<void> => {
    const result = await schoolFetch<{
      messages: ChatMessageRow[];
      attachments: ChatAttachmentRow[];
    }>(`/api/school/chat/conversations/${conversationId}/messages`);

    setMessages(result.messages);
    setAttachments(result.attachments ?? []);

    /*
     * Fire-and-forget, in the shape `components/comms/MarkNoticesRead.tsx`
     * uses. Since Sprint 29 this also clears the bell entries for the thread
     * server-side, so the refresh that follows is what takes the number off
     * the bell and the sidebar in the same beat — without it the badge would
     * sit there until the next navigation and read as broken.
     */
    void schoolFetch(`/api/school/chat/conversations/${conversationId}/read`, {
      method: 'POST',
    })
      .then(() => {
        refreshCounts();
      })
      .catch(() => {
        /* A read marker that did not save is not worth telling anybody about. */
      });
  }, [refreshCounts]);

  useEffect(() => {
    void (async () => {
      try {
        const rows = await loadInbox();
        const first = rows[0];

        /*
         * Opening the newest conversation is right on a desk, where both panes
         * are on screen and the right-hand one would otherwise be an empty box
         * beside a full list. It is wrong on a phone: below `lg` the panes are
         * master/detail, so pre-selecting drops somebody *inside* a thread when
         * they asked for their inbox — and the only way back to the list is a
         * button they have not been given a reason to look for.
         *
         * QA caught this by opening Messages at 375px and finding the list
         * hidden on arrival. Matching the same 1024px the `lg:` classes use,
         * read in an effect so the server render and the first client render
         * agree and nothing hydrates differently.
         */
        const roomForBoth =
          typeof window !== 'undefined' &&
          window.matchMedia('(min-width: 1024px)').matches;

        /*
         * Sprint 29. A bell entry links to `?conversation=<id>`, so arriving
         * from one opens that thread — on a phone as well, where the rule above
         * otherwise deliberately leaves you in the list. The difference is that
         * this time the person asked for a particular conversation by clicking
         * a notification about it, and dropping them in the inbox instead is
         * the notification not having worked.
         *
         * Read from `window.location` in this effect rather than through
         * `useSearchParams`, which would put a client-side bailout boundary
         * around a component four pages render. It is a one-shot read of the
         * URL that brought us here; nothing re-reads it.
         *
         * Checked against the inbox before it is trusted: an id in a query
         * string is untrusted, and selecting one this person is not seated in
         * would fetch a 404 and show them an error for a thread that may not
         * even exist.
         */
        /*
         * Two names for the same thing, and both are kept.
         *
         * `?conversation=` is what a bell entry carries (Sprint 29).
         * `?c=` is what the daily unread-message email carries (Sprint 33a) —
         * short because it is read in a mail client, where a long URL is
         * wrapped across two lines and a wrapped URL is a link that does not
         * open. Accepting one and not the other would make whichever surface
         * was forgotten drop people in an inbox instead of the thread they
         * asked for, which is the notification not having worked.
         */
        const params =
          typeof window === 'undefined' ? null : new URLSearchParams(window.location.search);

        const requested = params?.get('conversation') ?? params?.get('c') ?? null;

        const wanted =
          requested === null
            ? undefined
            : rows.find((row) => row.conversationId === requested);

        if (wanted !== undefined) {
          setSelectedId(wanted.conversationId);
          return;
        }

        if (first !== undefined && roomForBoth) setSelectedId(first.conversationId);
      } catch (caught) {
        setError(schoolErrorMessage(caught, 'Your conversations could not be loaded.'));
      }
    })();
  }, [loadInbox]);

  useEffect(() => {
    if (!canInitiate) return;

    void (async () => {
      try {
        const result = await schoolFetch<{ targets: ReachableTarget[] }>(
          '/api/school/chat/reachable',
        );
        setTargets(result.targets);
      } catch {
        setTargets([]);
      }
    })();
  }, [canInitiate]);

  useEffect(() => {
    if (selectedId === null) return;
    void loadMessages(selectedId).catch((caught: unknown) => {
      setError(schoolErrorMessage(caught, 'That conversation could not be opened.'));
    });
  }, [selectedId, loadMessages]);

  /*
   * Sprint 33a. Tell the portal's stream which thread is on screen, so it does
   * not chime for a message that arrives in the one being read.
   *
   * It is told on the way out as well: navigating away from the chat screen
   * leaves the provider mounted in the layout, and a stale id there would
   * silence a genuinely new message in that thread for the rest of the session.
   */
  useEffect(() => {
    setOpenConversation(selectedId);
    return () => {
      setOpenConversation(null);
    };
  }, [selectedId, setOpenConversation]);

  useEffect(() => {
    transcriptEnd.current?.scrollIntoView({ block: 'end' });
  }, [messages]);

  /*
   * The chime moved out of this component in Sprint 29 and into
   * `ChatStreamProvider`, which is mounted in the layout and therefore hears a
   * message arriving on every page rather than only on this one. That was the
   * defect: a parent looking at their fees learned nothing.
   *
   * The three rules it had to keep are kept by the *table* rather than by the
   * comparison that used to live here. `postMessage` writes a signal for every
   * seated participant **except the sender**, and one signal per message — so
   * "never on first paint", "never for your own message" and "never twice" are
   * properties of what arrives, not of what this screen remembers about it.
   */

  // A signal names the conversations that changed. The open one is refetched;
  // the rest are picked up by the inbox refresh, which also moves the unread
  // dot. Neither carries content — see `useChatStream`.
  const onSignal = useCallback(
    (conversationIds: string[]) => {
      void loadInbox().catch(() => {
        /* The next signal will try again. */
      });
      if (selectedId !== null && conversationIds.includes(selectedId)) {
        void loadMessages(selectedId).catch(() => {
          /* Likewise. */
        });
      }
    },
    [loadInbox, loadMessages, selectedId],
  );

  signalHandler.current = onSignal;

  const selected = useMemo(
    () => conversations?.find((row) => row.conversationId === selectedId) ?? null,
    [conversations, selectedId],
  );

  /*
   * Sprint 33c, C3. The chips, in the order a school thinks of people.
   *
   * Derived from the list rather than from `USER_ROLES`, so a chip is never
   * offered that would filter to nothing — a parent sees "Teacher" and "School
   * offices" and nothing else, because that is all their list holds. The order
   * is seniority-ish and stable; the desks go last, because they are not a
   * kind of person.
   */
  const targetGroups = useMemo(() => {
    const counts = new Map<string, number>();
    for (const target of targets ?? []) {
      const group = groupOf(target);
      counts.set(group, (counts.get(group) ?? 0) + 1);
    }

    const order = [
      'teacher',
      'coordinator',
      'section_head',
      'vice_principal',
      'principal',
      'branch_admin',
      'school_admin',
      'hr_manager',
      'accountant',
      'marketing',
      'student',
      'parent',
      'other',
      DESK_GROUP,
    ];

    return [...counts.entries()]
      .sort((left, right) => {
        const byOrder = order.indexOf(left[0]) - order.indexOf(right[0]);
        return byOrder === 0 ? left[0].localeCompare(right[0]) : byOrder;
      })
      .map(([group, total]) => ({ group, total }));
  }, [targets]);

  const visibleTargets = useMemo(
    () =>
      (targets ?? []).filter(
        (target) =>
          (targetGroup === null || groupOf(target) === targetGroup) &&
          matchesSearch(target, targetSearch.trim()),
      ),
    [targets, targetGroup, targetSearch],
  );

  /*
   * A chosen recipient who has been filtered away is cleared.
   *
   * Without this the composer keeps a hidden selection: the `<select>` shows
   * "Choose…" because the option is gone, and the send button posts to whoever
   * was picked before the filter changed. Somebody would be written to by name
   * and nobody would have read their name on screen.
   */
  useEffect(() => {
    if (targetKey === '') return;
    if (visibleTargets.some((target) => `${target.kind}:${target.id}` === targetKey)) {
      return;
    }
    setTargetKey('');
  }, [visibleTargets, targetKey]);

  /**
   * Take a desk enquiry.
   *
   * The route decides it with a conditional `UPDATE … RETURNING` and refuses
   * the second caller — three clerks with the same inbox open is the race
   * `CLAUDE.md` describes, and the loser is told who got there first by the
   * refresh rather than by a guess made here.
   */
  async function claim(conversationId: string): Promise<void> {
    if (busy) return;

    setBusy(true);
    setError(null);

    try {
      await schoolFetch(`/api/school/chat/conversations/${conversationId}/claim`, {
        method: 'POST',
      });
      await loadInbox();
    } catch (caught) {
      setError(schoolErrorMessage(caught, 'The enquiry could not be claimed.'));
      await loadInbox();
    } finally {
      setBusy(false);
    }
  }

  async function send(): Promise<void> {
    const body = draft.trim();
    if ((body === '' && file === null) || busy) return;

    setBusy(true);
    setError(null);

    try {
      if (composing) {
        const [kind, id] = targetKey.split(':');
        if (kind === undefined || id === undefined || id === '') {
          setError('Choose who the message is for.');
          return;
        }

        const created = await schoolFetch<{ conversationId: string }>(
          '/api/school/chat/conversations',
          {
            method: 'POST',
            body: JSON.stringify({
              targetKind: kind,
              targetId: id,
              subject: subject.trim() === '' ? null : subject.trim(),
              body,
            }),
          },
        );

        setComposing(false);
        setSubject('');
        setDraft('');
        await loadInbox();
        setSelectedId(created.conversationId);
        return;
      }

      if (selectedId === null) return;

      if (file !== null) {
        // `FormData` rather than JSON, and no `Content-Type` header — the
        // browser has to set the multipart boundary itself, and `schoolFetch`
        // already declines to add one for FormData.
        const form = new FormData();
        form.append('body', body);
        form.append('attachment', file);

        await schoolFetch(`/api/school/chat/conversations/${selectedId}/messages`, {
          method: 'POST',
          body: form,
        });
      } else {
        await schoolFetch(`/api/school/chat/conversations/${selectedId}/messages`, {
          method: 'POST',
          body: JSON.stringify({ body }),
        });
      }

      setFile(null);
      if (fileInput.current !== null) fileInput.current.value = '';
      setDraft('');
      await loadMessages(selectedId);
      await loadInbox();
    } catch (caught) {
      // Verbatim. Every refusal from this module is a sentence written to be
      // read by whoever hit it.
      setError(schoolErrorMessage(caught, 'Your message could not be sent.'));
    } finally {
      setBusy(false);
    }
  }

  if (conversations === null) {
    return <p className="text-sm text-ink-muted">Loading your conversations…</p>;
  }

  const nothingAtAll = conversations.length === 0 && !composing;

  /*
   * Whether the right-hand pane is the one to show on a phone.
   *
   * Composing counts: the "To" picker and the subject field are the thread
   * pane's content, and leaving the list on screen underneath them was how a
   * new conversation ended up half below the fold.
   */
  const paneOpen = composing || selectedId !== null;

  return (
    // The gesture that lets a browser make a sound is now listened for at the
    // document by `ChatStreamProvider`, because since Sprint 29 the chime has
    // to work on every page and not only on this one.
    <div className="grid gap-4 lg:grid-cols-[20rem_1fr]">
      <div className="lg:col-span-2">
        <div className="rounded-card border border-line bg-surface-raised">
          <ChatNotificationControls onSoundChange={setSoundEnabled} />
        </div>
      </div>

      <aside
        className={cn(
          'rounded-card border border-line bg-surface-raised',
          // Master/detail below `lg`: the list steps aside once something is
          // open. `lg:block` puts it back unconditionally on a desk.
          paneOpen ? 'hidden lg:block' : 'block',
        )}
      >
        {canInitiate ? (
          <div className="border-b border-line p-3">
            <Button
              variant={composing ? 'secondary' : 'primary'}
              size="sm"
              className="w-full"
              onClick={() => {
                setComposing((was) => !was);
                setError(null);
              }}
            >
              {composing ? 'Cancel' : 'New conversation'}
            </Button>
          </div>
        ) : null}

        <ul className="max-h-[32rem] overflow-y-auto">
          {conversations.map((row) => (
            <li key={row.conversationId}>
              <button
                type="button"
                onClick={() => {
                  setComposing(false);
                  setSelectedId(row.conversationId);
                  setError(null);
                }}
                className={cn(
                  'flex w-full flex-col gap-1 border-b border-line px-3 py-3 text-left last:border-0 hover:bg-surface-hover',
                  row.conversationId === selectedId && !composing ? 'bg-surface-hover' : '',
                )}
              >
                <span className="flex items-center justify-between gap-2">
                  <span className="truncate text-sm font-medium text-ink">
                    {row.counterparty}
                  </span>
                  {row.unread ? (
                    <span
                      aria-label="Unread"
                      className="h-2 w-2 shrink-0 rounded-full bg-brand-primary"
                    />
                  ) : null}
                </span>
                <span className="truncate text-xs text-ink-muted">
                  {row.subject ?? (row.roleInbox === null ? 'No subject' : 'Enquiry')}
                </span>
                {row.status === 'frozen' ? (
                  <Badge variant="neutral">Closed</Badge>
                ) : null}
              </button>
            </li>
          ))}
        </ul>

        {nothingAtAll ? (
          <p className="p-4 text-sm text-ink-muted">{emptyMessage}</p>
        ) : null}
      </aside>

      <section
        className={cn(
          'min-h-[24rem] flex-col rounded-card border border-line bg-surface-raised',
          paneOpen ? 'flex' : 'hidden lg:flex',
        )}
      >
        {/*
          The way back, and it exists only where there is somewhere to go back
          to. On a desk both panes are on screen, so a control that hides the
          one you are reading would be a control that does nothing useful.
        */}
        <div className="border-b border-line p-3 lg:hidden">
          <Button
            variant="secondary"
            size="sm"
            onClick={() => {
              setComposing(false);
              setSelectedId(null);
              setError(null);
            }}
          >
            ← All conversations
          </Button>
        </div>

        {composing ? (
          <div className="space-y-3 border-b border-line p-4">
            <label className="block text-sm font-medium text-ink" htmlFor="chat-target">
              To
            </label>

            {/*
              Sprint 33c, C3. Chips and a search box over the list the server
              already resolved for this caller.

              ── Both are drawn only when there is something to filter ───────
              A parent with two teachers and one open desk is handed a chip row
              that is longer than the list beneath it, which is a control that
              makes a short list harder to read. The thresholds below are the
              smallest honest ones: more than one group is what a chip row is
              *for*, and a handful of names needs no search.

              ── An empty list still says the sentence it always said ────────
              The `targets.length === 0` branch below is untouched. A pupil with
              no live grant is the ordinary case, not a failure, and they must
              read "you can reply to your teachers' messages" rather than an
              empty chip row above an empty dropdown.
            */}
            {targets !== null && targets.length > 0 ? (
              <>
                {targetGroups.length > 1 ? (
                  <div className="flex flex-wrap gap-1.5" role="group" aria-label="Filter by role">
                    <FilterChip
                      label={`All (${String(targets.length)})`}
                      active={targetGroup === null}
                      onClick={() => {
                        setTargetGroup(null);
                      }}
                    />
                    {targetGroups.map(({ group, total }) => (
                      <FilterChip
                        key={group}
                        label={`${groupLabel(group)} (${String(total)})`}
                        active={targetGroup === group}
                        onClick={() => {
                          setTargetGroup(targetGroup === group ? null : group);
                        }}
                      />
                    ))}
                  </div>
                ) : null}

                {targets.length > 8 ? (
                  <Input
                    label="Search"
                    placeholder="A name, a class, or a child's name"
                    value={targetSearch}
                    onChange={(event) => {
                      setTargetSearch(event.target.value);
                    }}
                    hint={`${String(visibleTargets.length)} of ${String(targets.length)}`}
                  />
                ) : null}
              </>
            ) : null}

            <select
              id="chat-target"
              value={targetKey}
              onChange={(event) => {
                setTargetKey(event.target.value);
              }}
              className="h-10 w-full rounded-input border border-line-strong bg-surface px-3 text-sm text-ink"
            >
              <option value="">Choose…</option>
              {visibleTargets.map((target) => (
                <option key={`${target.kind}:${target.id}`} value={`${target.kind}:${target.id}`}>
                  {target.name} — {target.detail}
                  {target.branchName === null ? '' : ` · ${target.branchName}`}
                </option>
              ))}
            </select>

            {targets !== null && targets.length === 0 ? (
              <p className="text-sm text-ink-muted">
                There is nobody you can start a conversation with right now. You can
                still reply to anything the school sends you.
              </p>
            ) : null}

            {/*
              The list is not empty, but the filters have emptied it. Said
              separately from the sentence above, because they are different
              facts: one is about the school, the other is about two controls
              the reader has just used and can undo.
            */}
            {targets !== null && targets.length > 0 && visibleTargets.length === 0 ? (
              <p className="text-sm text-ink-muted">
                Nobody matches that.{' '}
                <button
                  type="button"
                  className="font-medium text-brand-primary hover:underline"
                  onClick={() => {
                    setTargetGroup(null);
                    setTargetSearch('');
                  }}
                >
                  Clear the filters
                </button>
                .
              </p>
            ) : null}

            <Input
              label="Subject (optional)"
              value={subject}
              maxLength={140}
              onChange={(event) => {
                setSubject(event.target.value);
              }}
            />
          </div>
        ) : selected !== null ? (
          <header className="border-b border-line p-4">
            <h2 className="text-sm font-semibold text-ink">{selected.counterparty}</h2>
            {selected.subject !== null ? (
              <p className="text-xs text-ink-muted">{selected.subject}</p>
            ) : null}
            {/*
              Sprint 30. Who is dealing with this desk enquiry.

              Shown to everybody seated, parent included: "Claimed by the
              Defence Branch administrator" is the answer to *has anyone picked
              this up*, which is the question a parent writing to an office
              actually has. The button beside it is staff-only.
            */}
            {selected.roleInbox !== null && selected.claimedByName !== null ? (
              <p className="mt-1 text-xs text-ink-muted">
                Claimed by {selected.claimedByName}
              </p>
            ) : null}
            {selected.claimable &&
            selected.roleInbox !== null &&
            claimableDesks.includes(selected.roleInbox) ? (
              <div className="mt-2">
                <Button
                  size="sm"
                  variant="secondary"
                  isLoading={busy}
                  onClick={() => {
                    void claim(selected.conversationId);
                  }}
                >
                  Claim this enquiry
                </Button>
              </div>
            ) : null}
            {auditNotice !== null ? (
              <p className="mt-2 rounded-card bg-surface px-3 py-2 text-xs text-ink-muted">
                {auditNotice}
              </p>
            ) : null}
            {selected.status === 'frozen' ? (
              <p className="mt-2 text-xs text-ink-muted">
                This conversation has been closed. You can still read it.
              </p>
            ) : null}
          </header>
        ) : null}

        {!composing && selected === null ? (
          <div className="flex flex-1 items-center justify-center p-6">
            <EmptyState bare title="Nothing open" description={emptyMessage} />
          </div>
        ) : null}

        {!composing && selected !== null ? (
          <div className="flex-1 space-y-3 overflow-y-auto p-4">
            {messages.map((message) => {
              const mine = message.senderSchoolUserId === meId;
              const system = message.kind === 'system';

              if (system) {
                return (
                  <p
                    key={message.id}
                    className="mx-auto max-w-prose rounded-card bg-surface px-3 py-2 text-center text-xs text-ink-muted"
                  >
                    {message.body}
                  </p>
                );
              }

              return (
                <div
                  key={message.id}
                  className={cn('flex', mine ? 'justify-end' : 'justify-start')}
                >
                  <div
                    className={cn(
                      'max-w-[80%] rounded-card px-3 py-2 text-sm',
                      mine
                        ? 'bg-brand-primary text-brand-onPrimary'
                        : 'bg-surface text-ink',
                    )}
                  >
                    {!mine ? (
                      <p className="text-xs font-medium opacity-80">{message.senderName}</p>
                    ) : null}
                    {message.redactedAt === null ? (
                      // Never `dangerouslySetInnerHTML`, and never an anchor: a
                      // pupil's links render as the text they typed. It is the
                      // cheapest half of keeping this from being the notice
                      // board where a side-channel gets arranged.
                      <p className="whitespace-pre-wrap break-words">{message.body}</p>
                    ) : (
                      <p className="italic opacity-70">
                        Message removed
                        {message.redactionReason === null
                          ? ''
                          : ` — ${message.redactionReason}`}
                      </p>
                    )}

                    {message.redactedAt === null
                      ? attachments
                          .filter((entry) => entry.messageId === message.id)
                          .map((entry) => (
                            <a
                              key={entry.id}
                              href={`/api/school/chat/attachments/${entry.id}`}
                              className="mt-2 block truncate text-xs underline"
                            >
                              {entry.fileName} · {Math.max(1, Math.round(entry.sizeBytes / 1024))} KB
                            </a>
                          ))
                      : null}
                  </div>
                </div>
              );
            })}
            <div ref={transcriptEnd} />
          </div>
        ) : null}

        {(composing || (selected !== null && selected.canPost && selected.status !== 'frozen')) ? (
          <div className="border-t border-line p-3">
            {error !== null ? (
              <p
                role="alert"
                className="mb-2 rounded-card bg-status-danger-soft px-3 py-2 text-sm text-status-danger-onSoft"
              >
                {error}
              </p>
            ) : null}

            <Textarea
              label="Message"
              rows={3}
              maxLength={2000}
              value={draft}
              placeholder="Write a message…"
              onChange={(event) => {
                setDraft(event.target.value);
              }}
            />

            {canAttach ? (
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <input
                  ref={fileInput}
                  type="file"
                  accept="image/png,image/jpeg,application/pdf"
                  className="text-xs text-ink-muted"
                  onChange={(event) => {
                    setFile(event.target.files?.[0] ?? null);
                  }}
                />
                <span className="text-xs text-ink-muted">PNG, JPEG or PDF, up to 2 MB.</span>
              </div>
            ) : null}

            <div className="mt-2 flex justify-end">
              <Button
                onClick={() => void send()}
                disabled={busy || (draft.trim() === '' && file === null)}
              >
                {busy ? 'Sending…' : 'Send'}
              </Button>
            </div>
          </div>
        ) : selected !== null && !selected.canPost ? (
          <p className="border-t border-line p-3 text-sm text-ink-muted">
            You can read this conversation but not reply to it.
          </p>
        ) : null}
      </section>
    </div>
  );
}

/**
 * One role chip. Sprint 33c.
 *
 * A `<button>` with `aria-pressed`, not a checkbox dressed as a pill: a screen
 * reader is told it is a toggle and told which way it is set, which is the
 * whole accessibility content of a filter chip. Pressing the active one clears
 * it — the same gesture in both directions, so nobody has to find "All" again.
 */
function FilterChip({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        'rounded-full border px-2.5 py-1 text-xs font-medium transition-colors',
        active
          ? 'border-brand-primary bg-brand-primary text-brand-onPrimary'
          : 'border-line bg-surface text-ink-muted hover:text-ink',
      )}
    >
      {label}
    </button>
  );
}
