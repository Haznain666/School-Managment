'use client';

import { useId, type SelectHTMLAttributes } from 'react';

import { cn } from '@/lib/utils';

export interface SelectOption {
  value: string;
  label: string;
}

export interface SelectProps
  extends Omit<SelectHTMLAttributes<HTMLSelectElement>, 'children'> {
  label: string;
  options: readonly SelectOption[];
  error?: string;
  hint?: string;
  /** Shown as a disabled first option when no value is chosen yet. */
  placeholder?: string;
}

export function Select({
  label,
  options,
  error,
  hint,
  placeholder,
  className,
  id,
  ...rest
}: SelectProps) {
  const generatedId = useId();
  const selectId = id ?? generatedId;
  const messageId = `${selectId}-message`;
  const hasError = error !== undefined && error !== '';

  return (
    <div className="w-full">
      <label
        htmlFor={selectId}
        className="mb-1.5 block text-sm font-medium text-ink"
      >
        {label}
      </label>

      <select
        id={selectId}
        aria-invalid={hasError}
        aria-describedby={hasError || hint !== undefined ? messageId : undefined}
        className={cn(
          'block w-full rounded-lg border bg-surface-raised px-3 py-2 text-sm text-ink',
          'focus:outline focus:outline-2 focus:outline-offset-0',
          'disabled:cursor-not-allowed disabled:bg-surface-sunken disabled:text-ink-muted',
          hasError
            ? 'border-status-danger focus:outline-status-danger'
            : 'border-line-strong focus:outline-brand-primary',
          className,
        )}
        {...rest}
      >
        {placeholder !== undefined ? (
          <option value="" disabled>
            {placeholder}
          </option>
        ) : null}

        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>

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
