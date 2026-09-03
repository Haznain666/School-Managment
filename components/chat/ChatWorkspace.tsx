'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { Input } from '@/components/ui/Input';
import { Textarea } from '@/components/ui/Textarea';
import { schoolErrorMessage, schoolFetch } from '@/lib/school-client';
import { cn } from '@/lib/utils';

import { useChatStream } from './useChatStream';

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
}

export interface ChatWorkspaceProps {
  /** The caller's own `school_users.id`, to put their messages on the right. */
  meId: string;
  /** Shown above a thread that involves a pupil. */
  auditNotice: string | null;
  /** Whether the composer offers to start a new conversation at all. */
  canInitiate: boolean;
  /** What to say when there is nothing and nothing can be started. */
  emptyMessage: string;
}

interface InboxResponse {
  conversations: ChatConversationRow[];
  unread: number;
}

export function ChatWorkspace({
  meId,
  auditNotice,
  canInitiate,
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

  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const transcriptEnd = useRef<HTMLDivElement | null>(null);

  const loadInbox = useCallback(async (): Promise<ChatConversationRow[]> => {
    const result = await schoolFetch<InboxResponse>('/api/school/chat/conversations');
    setConversations(result.conversations);
    return result.conversations;
  }, []);

  const loadMessages = useCallback(async (conversationId: string): Promise<void> => {
    const result = await schoolFetch<{ messages: ChatMessageRow[] }>(
      `/api/school/chat/conversations/${conversationId}/messages`,
    );
    setMessages(result.messages);

    // Fire-and-forget, in the shape `components/comms/MarkNoticesRead.tsx` uses.
    void schoolFetch(`/api/school/chat/conversations/${conversationId}/read`, {
      method: 'POST',
    }).catch(() => {
      /* A read marker that did not save is not worth telling anybody about. */
    });
  }, []);

  useEffect(() => {
    void (async () => {
      try {
        const rows = await loadInbox();
        const first = rows[0];
        if (first !== undefined) setSelectedId(first.conversationId);
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

  useEffect(() => {
    transcriptEnd.current?.scrollIntoView({ block: 'end' });
  }, [messages]);

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

  useChatStream(onSignal);

  const selected = useMemo(
    () => conversations?.find((row) => row.conversationId === selectedId) ?? null,
    [conversations, selectedId],
  );

  async function send(): Promise<void> {
    const body = draft.trim();
    if (body === '' || busy) return;

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

      await schoolFetch(`/api/school/chat/conversations/${selectedId}/messages`, {
        method: 'POST',
        body: JSON.stringify({ body }),
      });

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

  return (
    <div className="grid gap-4 lg:grid-cols-[20rem_1fr]">
      <aside className="rounded-card border border-line bg-surface-raised">
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

      <section className="flex min-h-[24rem] flex-col rounded-card border border-line bg-surface-raised">
        {composing ? (
          <div className="space-y-3 border-b border-line p-4">
            <label className="block text-sm font-medium text-ink" htmlFor="chat-target">
              To
            </label>
            <select
              id="chat-target"
              value={targetKey}
              onChange={(event) => {
                setTargetKey(event.target.value);
              }}
              className="h-10 w-full rounded-input border border-line-strong bg-surface px-3 text-sm text-ink"
            >
              <option value="">Choose…</option>
              {(targets ?? []).map((target) => (
                <option key={`${target.kind}:${target.id}`} value={`${target.kind}:${target.id}`}>
                  {target.name} — {target.detail}
                </option>
              ))}
            </select>

            {targets !== null && targets.length === 0 ? (
              <p className="text-sm text-ink-muted">
                There is nobody you can start a conversation with right now. You can
                still reply to anything the school sends you.
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

            <div className="mt-2 flex justify-end">
              <Button onClick={() => void send()} disabled={busy || draft.trim() === ''}>
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
