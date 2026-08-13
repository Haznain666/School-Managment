'use client';

import { useId, type TextareaHTMLAttributes } from 'react';

import { cn } from '@/lib/utils';

export interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  label: string;
  /** When set, the field renders in its error state and announces the message. */
  error?: string;
  /** Helper text shown below the field when there is no error. */
  hint?: string;
}

/** Multi-line sibling of `Input`, with the same label, hint and error contract. */
export function Textarea({
  label,
  error,
  hint,
  className,
  id,
  rows = 3,
  ...rest
}: TextareaProps) {
  const generatedId = useId();
  const textareaId = id ?? generatedId;
  const messageId = `${textareaId}-message`;
  const hasError = error !== undefined && error !== '';

  return (
    <div className="w-full">
      <label
        htmlFor={textareaId}
        className="mb-1.5 block text-sm font-medium text-ink"
      >
        {label}
      </label>

      <textarea
        id={textareaId}
        rows={rows}
        aria-invalid={hasError}
        aria-describedby={hasError || hint !== undefined ? messageId : undefined}
        className={cn(
          'block w-full rounded-lg border bg-surface-raised px-3 py-2 text-sm text-ink',
          'placeholder:text-ink-muted',
          'focus:outline focus:outline-2 focus:outline-offset-0',
          'disabled:cursor-not-allowed disabled:bg-surface-sunken disabled:text-ink-muted',
          hasError
            ? 'border-status-danger focus:outline-status-danger'
            : 'border-line-strong focus:outline-brand-primary',
          className,
        )}
        {...rest}
      />

      {hasError ? (
        <p id={messageId} role="alert" className="mt-1.5 text-sm text-status-danger-ink">
          {error}
        </p>
      ) : hint !== undefined ? (
        <p id={messageId} className="mt-1.5 text-sm text-ink-muted">
          {hint}
        </p>
      ) : null}
    </div>
  );
}
