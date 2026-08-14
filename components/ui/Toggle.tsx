'use client';

import { useId } from 'react';

import { cn } from '@/lib/utils';

export interface ToggleProps {
  checked: boolean;
  onChange: (next: boolean) => void;
  /** Accessible name. Rendered visually unless `hideLabel` is set. */
  label: string;
  hideLabel?: boolean;
  description?: string;
  disabled?: boolean;
}

/** Switch control built on a real checkbox, so it is keyboard and SR friendly. */
export function Toggle({
  checked,
  onChange,
  label,
  hideLabel = false,
  description,
  disabled = false,
}: ToggleProps) {
  const id = useId();
  const descriptionId = `${id}-description`;

  return (
    <div className="flex items-center gap-3">
      <button
        type="button"
        role="switch"
        id={id}
        aria-checked={checked}
        aria-label={hideLabel ? label : undefined}
        aria-describedby={description === undefined ? undefined : descriptionId}
        disabled={disabled}
        onClick={() => {
          onChange(!checked);
        }}
        className={cn(
          'relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition',
          'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2',
          'focus-visible:outline-brand-primary',
          'disabled:cursor-not-allowed disabled:opacity-50',
          checked ? 'bg-brand-primary' : 'bg-line-strong',
        )}
      >
        <span
          aria-hidden="true"
          className={cn(
            'inline-block h-4 w-4 transform rounded-full bg-surface-raised shadow transition',
            checked ? 'translate-x-6' : 'translate-x-1',
          )}
        />
      </button>

      {hideLabel ? null : (
        <label htmlFor={id} className="cursor-pointer select-none">
          <span className="block text-sm font-medium text-ink">{label}</span>
          {description !== undefined ? (
            <span id={descriptionId} className="block text-xs text-ink-muted">
              {description}
            </span>
          ) : null}
        </label>
      )}
    </div>
  );
}
