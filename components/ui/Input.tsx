'use client';

import { useId, type InputHTMLAttributes } from 'react';

import { cn } from '@/lib/utils';

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label: string;
  /** When set, the field renders in its error state and announces the message. */
  error?: string;
  /** Helper text shown below the field when there is no error. */
  hint?: string;
  /** Hides the label visually but keeps it for screen readers. */
  hideLabel?: boolean;
}

export function Input({
  label,
  error,
  hint,
  hideLabel = false,
  className,
  id,
  ...rest
}: InputProps) {
  const generatedId = useId();
  const inputId = id ?? generatedId;
  const messageId = `${inputId}-message`;
  const hasError = error !== undefined && error !== '';

  return (
    <div className="w-full">
      <label
        htmlFor={inputId}
        className={cn(
          'mb-1.5 block text-sm font-medium text-slate-700',
          hideLabel && 'sr-only',
        )}
      >
        {label}
      </label>

      <input
        id={inputId}
        aria-invalid={hasError}
        aria-describedby={hasError || hint !== undefined ? messageId : undefined}
        className={cn(
          'block w-full rounded-lg border bg-white px-3 py-2 text-sm text-slate-900',
          'placeholder:text-slate-400',
          'focus:outline focus:outline-2 focus:outline-offset-0',
          'disabled:cursor-not-allowed disabled:bg-slate-50 disabled:text-slate-500',
          hasError
            ? 'border-red-400 focus:outline-red-500'
            : 'border-slate-300 focus:outline-brand-primary',
          className,
        )}
        {...rest}
      />

      {hasError ? (
        <p id={messageId} role="alert" className="mt-1.5 text-sm text-red-600">
          {error}
        </p>
      ) : hint !== undefined ? (
        <p id={messageId} className="mt-1.5 text-sm text-slate-500">
          {hint}
        </p>
      ) : null}
    </div>
  );
}
