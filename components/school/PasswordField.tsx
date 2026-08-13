'use client';

import { useId, useState } from 'react';

import { cn } from '@/lib/utils';
import {
  PASSWORD_MIN_LENGTH,
  PASSWORD_SCORE_LABELS,
  passwordScore,
} from '@/lib/password-strength';

export interface PasswordFieldProps {
  label: string;
  name: string;
  value: string;
  onChange: (value: string) => void;
  /** Renders the 0-4 meter under the field. For "choose a password", not "enter it". */
  showStrength?: boolean;
  error?: string | undefined;
  hint?: string;
  disabled?: boolean;
  autoComplete?: string;
  autoFocus?: boolean;
  required?: boolean;
}

const METER_COLORS = [
  'bg-line',
  'bg-red-500',
  'bg-amber-500',
  'bg-lime-500',
  'bg-status-success',
];

/**
 * A password field with a show/hide toggle, and optionally a strength meter.
 *
 * The toggle exists because the alternative is people choosing shorter
 * passwords they can type blind. It is a `<button>` rather than a checkbox so
 * it does not enter the tab order between the two password fields, and it
 * announces its state to screen readers.
 *
 * The meter is advisory. `/api/school/auth/password` calls
 * `validatePasswordStrength` from the same module this meter reads, so the two
 * cannot drift apart.
 */
export function PasswordField({
  label,
  name,
  value,
  onChange,
  showStrength = false,
  error,
  hint,
  disabled = false,
  autoComplete = 'current-password',
  autoFocus = false,
  required = false,
}: PasswordFieldProps) {
  const [revealed, setRevealed] = useState(false);
  const id = useId();
  const messageId = `${id}-message`;
  const hasError = error !== undefined && error !== '';
  const score = passwordScore(value);

  return (
    <div className="w-full">
      <label htmlFor={id} className="mb-1.5 block text-sm font-medium text-ink">
        {label}
      </label>

      <div className="relative">
        <input
          id={id}
          name={name}
          type={revealed ? 'text' : 'password'}
          value={value}
          autoComplete={autoComplete}
          autoFocus={autoFocus}
          required={required}
          disabled={disabled}
          aria-invalid={hasError}
          aria-describedby={hasError || hint !== undefined ? messageId : undefined}
          onChange={(event) => {
            onChange(event.target.value);
          }}
          className={cn(
            'block w-full rounded-lg border bg-surface-raised py-2 pl-3 pr-16 text-sm text-ink',
            'placeholder:text-ink-muted',
            'focus:outline focus:outline-2 focus:outline-offset-0',
            'disabled:cursor-not-allowed disabled:bg-surface-sunken disabled:text-ink-muted',
            hasError
              ? 'border-status-danger focus:outline-red-500'
              : 'border-line-strong focus:outline-brand-primary',
          )}
        />

        <button
          type="button"
          // Excluded from the tab order: tabbing from "new password" should
          // land on "confirm password", not on a display toggle.
          tabIndex={-1}
          disabled={disabled}
          aria-pressed={revealed}
          aria-label={revealed ? 'Hide password' : 'Show password'}
          onClick={() => {
            setRevealed((current) => !current);
          }}
          className="absolute inset-y-0 right-0 px-3 text-xs font-medium text-ink-muted hover:text-ink disabled:text-ink-faint"
        >
          {revealed ? 'Hide' : 'Show'}
        </button>
      </div>

      {showStrength ? (
        <div className="mt-2" aria-live="polite">
          <div className="flex gap-1">
            {[1, 2, 3, 4].map((step) => (
              <span
                key={step}
                className={cn(
                  'h-1 flex-1 rounded-full transition-colors',
                  score >= step ? METER_COLORS[score] : 'bg-line',
                )}
              />
            ))}
          </div>
          <p className="mt-1 text-xs text-ink-muted">
            {value === ''
              ? `At least ${PASSWORD_MIN_LENGTH} characters, with a letter and a number.`
              : (PASSWORD_SCORE_LABELS[score] ?? '')}
          </p>
        </div>
      ) : null}

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
