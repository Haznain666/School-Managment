'use client';

import { Send } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useCallback, useState, type FormEvent } from 'react';

import { Button } from '@/components/ui/Button';
import { Textarea } from '@/components/ui/Textarea';
import { REPLY_MAX } from '@/lib/feedback';
import type { FeedbackReplyRow } from '@/lib/feedback-queries';
import { cn } from '@/lib/utils';

/**
 * The conversation on a ticket, and the box to add to it.
 *
 * One component for both sides. The only differences are which endpoint it
 * posts to and which author kind is drawn as "us" — and both are props, because
 * two near-identical thread components would be two places to fix the next
 * thing wrong with either.
 *
 * ── Replies are never edited or deleted ──────────────────────────────────
 * The value of a reply is that it is what was said at the time. Deleting the
 * *ticket* takes its replies with it, which is the one deletion the product
 * owner asked for and the only one that makes sense: a conversation with half
 * of it removed is worse evidence than no conversation.
 */

export interface FeedbackThreadProps {
  replies: readonly FeedbackReplyRow[];
  /** `/api/school/feedback/…/replies` or the platform equivalent. */
  endpoint: string;
  /** Which side is reading. Their own messages are aligned and tinted. */
  viewer: 'school' | 'super_admin';
}

export function FeedbackThread({ replies, endpoint, viewer }: FeedbackThreadProps) {
  const router = useRouter();
  const [body, setBody] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);

  const onSubmit = useCallback(
    async (event: FormEvent) => {
      event.preventDefault();

      const message = body.trim();
      if (message === '') {
        setError('Write a reply first.');
        return;
      }

      setError(null);
      setSending(true);

      try {
        const response = await fetch(endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ body: message }),
        });

        const payload = (await response.json()) as {
          ok: boolean;
          error?: { message: string };
        };

        if (!payload.ok) {
          setError(payload.error?.message ?? 'The reply could not be sent.');
          return;
        }

        setBody('');
        // The thread is server-rendered, so a refresh is what draws the new
        // message. Appending it locally would mean two sources of truth for
        // the same list and a duplicate on the next navigation.
        router.refresh();
      } catch {
        setError('The reply could not be sent. Check your connection and try again.');
      } finally {
        setSending(false);
      }
    },
    [body, endpoint, router],
  );

  return (
    <div className="space-y-4">
      {replies.length === 0 ? (
        <p className="text-sm text-ink-muted">No replies yet.</p>
      ) : (
        <ul className="space-y-3">
          {replies.map((reply) => {
            const mine = reply.authorKind === viewer;

            return (
              <li
                key={reply.id}
                className={cn(
                  'rounded-card border px-4 py-3',
                  mine
                    ? 'border-brand-primary/30 bg-brand-primarySubtle'
                    : 'border-line bg-surface-sunken',
                )}
              >
                <p className="flex flex-wrap items-baseline justify-between gap-2">
                  <span className="text-sm font-semibold text-ink">{reply.authorName}</span>
                  <span className="text-xs text-ink-faint">
                    {new Date(reply.createdAt).toLocaleString()}
                  </span>
                </p>
                {/*
                  `whitespace-pre-wrap`: a reply is typed prose with its own
                  paragraphs, and collapsing them turns a numbered list of
                  reproduction steps into one sentence.
                */}
                <p className="mt-1.5 whitespace-pre-wrap text-sm text-ink">{reply.body}</p>
              </li>
            );
          })}
        </ul>
      )}

      <form
        onSubmit={(event) => {
          void onSubmit(event);
        }}
        className="space-y-3"
        noValidate
      >
        <Textarea
          label="Reply"
          value={body}
          rows={4}
          maxLength={REPLY_MAX}
          onChange={(event) => {
            setBody(event.target.value);
          }}
          hint={
            viewer === 'super_admin'
              ? 'The school is emailed and notified in their portal.'
              : 'We are notified straight away.'
          }
        />

        {error === null ? null : (
          <p
            role="alert"
            className="rounded-control border border-status-danger bg-status-danger-subtle px-3 py-2 text-sm text-status-danger-onSubtle"
          >
            {error}
          </p>
        )}

        <Button type="submit" icon={Send} isLoading={sending} size="sm">
          Send reply
        </Button>
      </form>
    </div>
  );
}
