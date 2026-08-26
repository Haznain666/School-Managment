'use client';

import { Paperclip, Send, X } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useCallback, useRef, useState, type ChangeEvent, type FormEvent } from 'react';

import { Button } from '@/components/ui/Button';
import { Icon } from '@/components/ui/Icon';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { Textarea } from '@/components/ui/Textarea';
import { FEEDBACK_NATURES, FEEDBACK_NATURE_LABELS, type FeedbackNature } from '@/db/schema';
import {
  ATTACHMENT_ACCEPT,
  attachmentProblem,
  BODY_MAX,
  feedbackProblem,
  MAX_ATTACHMENTS,
  MAX_ATTACHMENT_BYTES,
  TITLE_MAX,
} from '@/lib/feedback';

/**
 * The school's side of feedback: a title, a description, a nature and up to
 * five files.
 *
 * ── Every rule here is also enforced in the route ────────────────────────
 * The counts, the size and the accepted types all come from `lib/feedback.ts`,
 * which has no `server-only` and no database import for exactly this reason.
 * The form's job is to say *now* what the route would say a second later; the
 * route's job is to be true. A form that accepted a sixth file and a route that
 * refused it would lose everything the person had typed.
 *
 * ── Files accumulate rather than replace ─────────────────────────────────
 * A native multi-file input replaces its whole selection on every use, so
 * picking a second screenshot silently discards the first. Somebody attaching
 * three files from three folders would end up sending one and never know. The
 * chosen files are therefore held in state, added to, and removed individually.
 */

export interface FeedbackFormProps {
  /** Where to go once it has been sent. */
  listHref: string;
}

export function FeedbackForm({ listHref }: FeedbackFormProps) {
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [nature, setNature] = useState<FeedbackNature>('suggestion');
  const [files, setFiles] = useState<File[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);

  const onPickFiles = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => {
      const chosen = Array.from(event.target.files ?? []);

      // Reset immediately, so choosing the same file twice in a row still
      // fires a change event. Without this, removing a file and re-adding it
      // does nothing and reads as the button being broken.
      event.target.value = '';

      if (chosen.length === 0) return;

      const accepted: File[] = [];
      for (const file of chosen) {
        const problem = attachmentProblem(file);
        if (problem !== null) {
          setError(problem);
          return;
        }

        // Same name and size twice is the double-click, not two files.
        const duplicate = [...files, ...accepted].some(
          (existing) => existing.name === file.name && existing.size === file.size,
        );
        if (!duplicate) accepted.push(file);
      }

      if (files.length + accepted.length > MAX_ATTACHMENTS) {
        setError(`Attach at most ${MAX_ATTACHMENTS} files.`);
        return;
      }

      setError(null);
      setFiles((current) => [...current, ...accepted]);
    },
    [files],
  );

  const onSubmit = useCallback(
    async (event: FormEvent) => {
      event.preventDefault();

      const problem = feedbackProblem({ title, body, nature });
      if (problem !== null) {
        setError(problem);
        return;
      }

      setError(null);
      setSending(true);

      try {
        const form = new FormData();
        form.set('title', title.trim());
        form.set('body', body.trim());
        form.set('nature', nature);
        for (const file of files) form.append('attachments', file);

        const response = await fetch('/api/school/feedback', {
          method: 'POST',
          body: form,
        });

        const payload = (await response.json()) as {
          ok: boolean;
          error?: { message: string };
        };

        if (!payload.ok) {
          setError(payload.error?.message ?? 'The feedback could not be sent.');
          return;
        }

        router.push(listHref);
        router.refresh();
      } catch {
        setError('The feedback could not be sent. Check your connection and try again.');
      } finally {
        setSending(false);
      }
    },
    [body, files, listHref, nature, router, title],
  );

  return (
    <form
      onSubmit={(event) => {
        void onSubmit(event);
      }}
      className="space-y-5"
      noValidate
    >
      <Input
        label="Title"
        value={title}
        maxLength={TITLE_MAX}
        onChange={(event) => {
          setTitle(event.target.value);
        }}
        hint="One line. What is wrong, or what you would like."
        required
      />

      <Select
        label="Is this a bug or a suggestion?"
        value={nature}
        onChange={(event) => {
          setNature(event.target.value as FeedbackNature);
        }}
        options={FEEDBACK_NATURES.map((value) => ({
          value,
          label: FEEDBACK_NATURE_LABELS[value],
        }))}
        hint="Bugs are marked urgent on our side. Suggestion is the default."
      />

      <Textarea
        label="Description"
        value={body}
        rows={8}
        maxLength={BODY_MAX}
        onChange={(event) => {
          setBody(event.target.value);
        }}
        hint="What you did, what happened, and what you expected instead. Screens and names help."
        required
      />

      <div>
        <p className="mb-1.5 text-sm font-medium text-ink">Attachments</p>
        <p className="mb-2 text-sm text-ink-muted">
          Up to {MAX_ATTACHMENTS} PNG, JPEG or PDF files,{' '}
          {MAX_ATTACHMENT_BYTES / (1024 * 1024)} MB each. A screenshot is usually the
          fastest way to explain a bug.
        </p>

        <input
          ref={fileInputRef}
          type="file"
          multiple
          accept={ATTACHMENT_ACCEPT}
          onChange={onPickFiles}
          className="sr-only"
        />

        <Button
          variant="secondary"
          size="sm"
          icon={Paperclip}
          disabled={files.length >= MAX_ATTACHMENTS}
          onClick={() => fileInputRef.current?.click()}
        >
          {files.length === 0 ? 'Choose files' : 'Add another file'}
        </Button>

        {files.length === 0 ? null : (
          <ul className="mt-3 space-y-2">
            {files.map((file) => (
              <li
                key={`${file.name}:${file.size}`}
                className="flex items-center justify-between gap-3 rounded-control border border-line bg-surface-sunken px-3 py-2"
              >
                <span className="min-w-0">
                  <span className="block truncate text-sm text-ink">{file.name}</span>
                  <span className="block text-xs text-ink-muted">
                    {formatBytes(file.size)}
                  </span>
                </span>

                <button
                  type="button"
                  onClick={() => {
                    setFiles((current) => current.filter((entry) => entry !== file));
                    setError(null);
                  }}
                  className="rounded-control p-1 text-ink-muted transition-colors duration-fast hover:bg-surface-hover hover:text-ink"
                >
                  <Icon as={X} size="sm" label={`Remove ${file.name}`} />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {error === null ? null : (
        // `role="alert"`, so somebody who has just pressed Send and is not
        // looking at the top of the form is told rather than left waiting.
        <p
          role="alert"
          className="rounded-control border border-status-danger bg-status-danger-subtle px-3 py-2 text-sm text-status-danger-onSubtle"
        >
          {error}
        </p>
      )}

      <div className="flex items-center gap-3">
        <Button type="submit" icon={Send} isLoading={sending}>
          Send feedback
        </Button>
        <p className="text-sm text-ink-muted">
          We will email you when the status changes or somebody replies.
        </p>
      </div>
    </form>
  );
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} bytes`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${Math.round((bytes / (1024 * 1024)) * 10) / 10} MB`;
}
