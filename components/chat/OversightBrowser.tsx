'use client';

import { useCallback, useEffect, useState } from 'react';

import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { Input } from '@/components/ui/Input';
import { schoolErrorMessage, schoolFetch } from '@/lib/school-client';
import { cn } from '@/lib/utils';

/**
 * Reading the school's correspondence, for the people accountable for it.
 *
 * ── Read-only, and not by hiding a button ────────────────────────────────
 * There is no composer here at all, and that is the smaller half. The larger
 * half is that posting goes through `sendProblem`, which requires a seat in the
 * conversation, and an overseer is never seated — so this screen could not
 * write into a thread even if somebody added a box to it.
 *
 * ── Two fetches, because they are two decisions ──────────────────────────
 * The list comes from `/chat/oversight`, which returns metadata and no message
 * bodies. Opening one goes to the ordinary transcript route, which asks
 * `oversightAdmits` again about that id. A client that guessed a conversation
 * id gets a 404 from the second call, not a transcript.
 *
 * ── The filter is local, and only the filter ─────────────────────────────
 * Typing narrows the rows already fetched. It is not a search — the server
 * decides what may be listed and this decides which of those to draw, so a
 * filter that matched nothing can never reveal something the scope excluded.
 */

interface OversightRow {
  conversationId: string;
  kind: string;
  subject: string | null;
  status: string;
  lastMessageAt: string | null;
  branchName: string | null;
  studentName: string | null;
  gradeName: string | null;
  participants: string;
}

interface TranscriptRow {
  id: string;
  senderName: string;
  senderRole: string;
  kind: string;
  body: string | null;
  redactedAt: string | null;
  redactionReason: string | null;
  createdAt: string;
}

function when(value: string | null): string {
  if (value === null) return 'No messages';
  return new Date(value).toLocaleString('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function OversightBrowser() {
  const [rows, setRows] = useState<OversightRow[] | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [filter, setFilter] = useState('');
  const [openId, setOpenId] = useState<string | null>(null);
  const [transcript, setTranscript] = useState<TranscriptRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (): Promise<void> => {
    try {
      const result = await schoolFetch<{
        conversations: OversightRow[];
        scope: { kind: string; note: string | null };
      }>('/api/school/chat/oversight');

      setRows(result.conversations);
      setNote(result.scope.note);
    } catch (caught) {
      setError(schoolErrorMessage(caught, 'The conversations could not be loaded.'));
      setRows([]);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function open(conversationId: string): Promise<void> {
    setOpenId(conversationId);
    setTranscript(null);
    setError(null);

    try {
      const result = await schoolFetch<{ messages: TranscriptRow[] }>(
        `/api/school/chat/conversations/${conversationId}/messages`,
      );
      setTranscript(result.messages);
    } catch (caught) {
      setError(schoolErrorMessage(caught, 'That conversation could not be opened.'));
      setTranscript([]);
    }
  }

  if (rows === null) {
    return <p className="text-sm text-ink-muted">Loading conversations…</p>;
  }

  const needle = filter.trim().toLowerCase();
  const shown =
    needle === ''
      ? rows
      : rows.filter((row) =>
          [row.participants, row.subject, row.studentName, row.gradeName, row.branchName]
            .filter((value): value is string => value !== null)
            .some((value) => value.toLowerCase().includes(needle)),
        );

  return (
    <div className="space-y-4">
      {note !== null ? (
        <p className="rounded-card border border-line bg-surface px-3 py-2 text-sm text-ink-muted">
          {note}
        </p>
      ) : null}

      {error !== null ? (
        <p
          role="alert"
          className="rounded-card bg-status-danger-soft px-3 py-2 text-sm text-status-danger-onSoft"
        >
          {error}
        </p>
      ) : null}

      <Input
        label="Filter"
        value={filter}
        placeholder="A name, a subject, a class…"
        onChange={(event) => {
          setFilter(event.target.value);
        }}
      />

      {rows.length === 0 ? (
        <EmptyState
          title="No conversations in reach"
          description="Nothing has been written yet in the campuses and classes you cover."
        />
      ) : null}

      <div className="grid gap-4 lg:grid-cols-[24rem_1fr]">
        <ul className="max-h-[36rem] divide-y divide-line overflow-y-auto rounded-card border border-line bg-surface-raised">
          {shown.map((row) => (
            <li key={row.conversationId}>
              <button
                type="button"
                onClick={() => void open(row.conversationId)}
                className={cn(
                  'flex w-full flex-col gap-1 px-3 py-3 text-left hover:bg-surface-hover',
                  row.conversationId === openId ? 'bg-surface-hover' : '',
                )}
              >
                <span className="text-sm font-medium text-ink">{row.participants}</span>
                <span className="text-xs text-ink-muted">
                  {row.subject ?? 'No subject'} · {when(row.lastMessageAt)}
                </span>
                <span className="flex flex-wrap gap-1">
                  {row.studentName !== null ? (
                    <Badge variant="neutral">
                      {row.studentName}
                      {row.gradeName === null ? '' : ` · ${row.gradeName}`}
                    </Badge>
                  ) : (
                    <Badge variant="neutral">Staff only</Badge>
                  )}
                  {row.branchName !== null ? (
                    <Badge variant="neutral">{row.branchName}</Badge>
                  ) : null}
                  {row.status === 'frozen' ? <Badge variant="neutral">Closed</Badge> : null}
                </span>
              </button>
            </li>
          ))}

          {shown.length === 0 && rows.length > 0 ? (
            <li className="px-3 py-4 text-sm text-ink-muted">
              Nothing here matches “{filter}”.
            </li>
          ) : null}
        </ul>

        <section className="min-h-[24rem] rounded-card border border-line bg-surface-raised p-4">
          {openId === null ? (
            <EmptyState
              bare
              title="Nothing open"
              description="Choose a conversation to read it. You cannot write into one from here."
            />
          ) : transcript === null ? (
            <p className="text-sm text-ink-muted">Loading the conversation…</p>
          ) : transcript.length === 0 ? (
            <p className="text-sm text-ink-muted">This conversation has no messages.</p>
          ) : (
            <ol className="space-y-3">
              {transcript.map((message) => (
                <li key={message.id} className="rounded-card bg-surface px-3 py-2">
                  <p className="text-xs font-medium text-ink-muted">
                    {message.senderName} ({message.senderRole}) ·{' '}
                    {when(message.createdAt)}
                  </p>
                  {message.redactedAt === null ? (
                    <p className="whitespace-pre-wrap break-words text-sm text-ink">
                      {message.body}
                    </p>
                  ) : (
                    <p className="text-sm italic text-ink-muted">
                      Message removed
                      {message.redactionReason === null
                        ? ''
                        : ` — ${message.redactionReason}`}
                    </p>
                  )}
                </li>
              ))}
            </ol>
          )}

          {openId !== null ? (
            <div className="mt-4 border-t border-line pt-3">
              <Button
                variant="secondary"
                size="sm"
                onClick={() => {
                  setOpenId(null);
                  setTranscript(null);
                }}
              >
                Close
              </Button>
            </div>
          ) : null}
        </section>
      </div>
    </div>
  );
}
