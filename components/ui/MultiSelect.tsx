'use client';

import { useId } from 'react';

import { cn } from '@/lib/utils';

export interface MultiSelectOption {
  value: string;
  label: string;
}

export interface MultiSelectProps {
  label: string;
  options: readonly MultiSelectOption[];
  /** The chosen values. Order is the caller's business, not this component's. */
  value: readonly string[];
  onChange: (next: string[]) => void;
  error?: string;
  hint?: string;
  disabled?: boolean;
  required?: boolean;
  /** Shown in place of the options when there are none to offer. */
  emptyMessage?: string;
  className?: string;
}

/**
 * Pick several from a short, known list.
 *
 * ── Why checkboxes rather than a `<select multiple>` ─────────────────────
 * The native multi-select is the worst-known control in HTML: choosing a second
 * option requires ctrl-click, which nobody discovers, and clicking a second
 * option without it silently *replaces* the first. An operator ticking eleven
 * classes would end up with one and no indication anything went wrong. It also
 * renders as a fixed-height scroller on desktop and a modal list on mobile, so
 * it looks like two different controls.
 *
 * Checkboxes have none of those problems, cost nothing to make accessible — a
 * `fieldset` with a `legend` is already the right structure for "several
 * related choices" — and are what every design system reaches for at this list
 * length. Above roughly twenty options this stops being true and a searchable
 * combobox earns its complexity; the class ladder tops out at sixteen.
 *
 * ── Select-all ───────────────────────────────────────────────────────────
 * A campus that teaches the whole ladder is the ordinary case, not the
 * exception, and making that operator tick sixteen boxes one at a time is the
 * kind of small cruelty that gets a form abandoned halfway.
 */
export function MultiSelect({
  label,
  options,
  value,
  onChange,
  error,
  hint,
  disabled = false,
  required = false,
  emptyMessage,
  className,
}: MultiSelectProps) {
  const groupId = useId();
  const messageId = `${groupId}-message`;
  const hasError = error !== undefined && error !== '';

  const chosen = new Set(value);
  const allChosen = options.length > 0 && options.every((option) => chosen.has(option.value));

  const toggle = (optionValue: string) => {
    const next = new Set(chosen);
    if (next.has(optionValue)) {
      next.delete(optionValue);
    } else {
      next.add(optionValue);
    }

    // Emitted in option order rather than click order, so two operators who
    // tick the same boxes in different sequences produce the same value.
    onChange(options.filter((option) => next.has(option.value)).map((option) => option.value));
  };

  return (
    <fieldset
      className={cn('w-full', className)}
      aria-describedby={hasError || hint !== undefined ? messageId : undefined}
      aria-invalid={hasError}
      disabled={disabled}
    >
      <div className="mb-1.5 flex items-baseline justify-between gap-3">
        <legend className="text-sm font-medium text-ink">
          {label}
          {required ? <span aria-hidden="true"> *</span> : null}
        </legend>

        {options.length > 0 ? (
          <button
            type="button"
            disabled={disabled}
            onClick={() => {
              onChange(allChosen ? [] : options.map((option) => option.value));
            }}
            className="text-xs font-medium text-brand-primary hover:underline disabled:cursor-not-allowed disabled:text-ink-muted disabled:no-underline"
          >
            {allChosen ? 'Clear all' : 'Select all'}
          </button>
        ) : null}
      </div>

      {options.length === 0 ? (
        <p className="rounded-lg border border-dashed border-line px-3 py-4 text-sm text-ink-muted">
          {emptyMessage ?? 'Nothing to choose from yet.'}
        </p>
      ) : (
        <div
          className={cn(
            'grid grid-cols-2 gap-x-4 gap-y-2 rounded-lg border bg-surface-raised px-3 py-3 sm:grid-cols-3',
            hasError ? 'border-status-danger' : 'border-line-strong',
          )}
        >
          {options.map((option) => (
            <label
              key={option.value}
              className={cn(
                'flex items-center gap-2 text-sm text-ink',
                disabled ? 'cursor-not-allowed text-ink-muted' : 'cursor-pointer',
              )}
            >
              <input
                type="checkbox"
                checked={chosen.has(option.value)}
                disabled={disabled}
                onChange={() => {
                  toggle(option.value);
                }}
                className="h-4 w-4 shrink-0 rounded border-line-strong text-brand-primary focus:outline focus:outline-2 focus:outline-brand-primary"
              />
              {option.label}
            </label>
          ))}
        </div>
      )}

      {hasError ? (
        <p id={messageId} role="alert" className="mt-1.5 text-sm text-status-danger-ink">
          {error}
        </p>
      ) : hint !== undefined ? (
        <p id={messageId} className="mt-1.5 text-sm text-ink-muted">
          {hint}
        </p>
      ) : null}
    </fieldset>
  );
}
