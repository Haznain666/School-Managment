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
        className="mb-1.5 block text-sm font-medium text-slate-700"
      >
        {label}
      </label>

      <select
        id={selectId}
        aria-invalid={hasError}
        aria-describedby={hasError || hint !== undefined ? messageId : undefined}
        className={cn(
          'block w-full rounded-lg border bg-white px-3 py-2 text-sm text-slate-900',
          'focus:outline focus:outline-2 focus:outline-offset-0',
          'disabled:cursor-not-allowed disabled:bg-slate-50 disabled:text-slate-500',
          hasError
            ? 'border-red-400 focus:outline-red-500'
            : 'border-slate-300 focus:outline-brand-primary',
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
