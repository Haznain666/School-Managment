'use client';

import { useId, useState, type InputHTMLAttributes } from 'react';

import { cn } from '@/lib/utils';

/**
 * A text field whose value is hidden until the user asks to see it.
 *
 * ── Why not `type="password"` ────────────────────────────────────────────
 * A password field hides *everything* and lets nothing be formatted as it is
 * typed. This is used for identity numbers, which need both: the last four
 * characters stay readable so a clerk can confirm they are on the right record,
 * and the field still reformats to `42101-1234567-1` while it is being typed.
 * So the masking is done on the displayed string, and the real value is what is
 * held in state and submitted.
 *
 * The consequence worth knowing: while hidden, the input shows a *derived*
 * string. Typing into it would be editing the mask, so it is read-only until
 * revealed — the eye is not decoration, it is how you get to edit the field.
 * Browsers also cannot autofill or password-manage it, which for a child's
 * B-Form number is the outcome we want.
 */

export interface SecretInputProps
  extends Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'type'> {
  label: string;
  value: string;
  /** How the value reads while hidden. Given the current value. */
  mask: (value: string) => string;
  error?: string;
  hint?: string;
  /** Accessible name for the toggle, e.g. "CNIC". Defaults to the label. */
  revealLabel?: string;
}

export function SecretInput({
  label,
  value,
  mask,
  error,
  hint,
  revealLabel,
  className,
  id,
  disabled,
  ...rest
}: SecretInputProps) {
  const generatedId = useId();
  const inputId = id ?? generatedId;
  const messageId = `${inputId}-message`;
  const hasError = error !== undefined && error !== '';

  const [revealed, setRevealed] = useState(false);
  const name = revealLabel ?? label;

  return (
    <div className="w-full">
      <label
        htmlFor={inputId}
        className="mb-1.5 block text-sm font-medium text-slate-700"
      >
        {label}
      </label>

      <div className="relative">
        <input
          id={inputId}
          type="text"
          inputMode="numeric"
          autoComplete="off"
          value={revealed || value === '' ? value : mask(value)}
          readOnly={!revealed && value !== ''}
          disabled={disabled}
          aria-invalid={hasError}
          aria-describedby={hasError || hint !== undefined ? messageId : undefined}
          className={cn(
            'block w-full rounded-lg border bg-white py-2 pl-3 pr-11 text-sm text-slate-900',
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

        <button
          type="button"
          disabled={disabled}
          aria-pressed={revealed}
          aria-controls={inputId}
          aria-label={revealed ? `Hide ${name}` : `Show ${name}`}
          title={revealed ? `Hide ${name}` : `Show ${name}`}
          onClick={() => {
            setRevealed((current) => !current);
          }}
          className={cn(
            'absolute inset-y-0 right-0 flex w-10 items-center justify-center',
            'rounded-r-lg text-slate-500 hover:text-slate-800',
            'focus:outline focus:outline-2 focus:outline-brand-primary',
            'disabled:cursor-not-allowed disabled:text-slate-300',
          )}
        >
          <EyeIcon crossed={revealed} />
        </button>
      </div>

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

/** Open eye when hidden, struck-through eye when revealed. */
function EyeIcon({ crossed }: { crossed: boolean }) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="h-5 w-5"
    >
      <path d="M2 12s3.6-6.5 10-6.5S22 12 22 12s-3.6 6.5-10 6.5S2 12 2 12Z" />
      <circle cx="12" cy="12" r="2.75" />
      {crossed ? <path d="m3.5 3.5 17 17" /> : null}
    </svg>
  );
}
