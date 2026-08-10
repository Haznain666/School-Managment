'use client';

import { useId, useState, type CSSProperties, type InputHTMLAttributes } from 'react';

import { cn } from '@/lib/utils';

/**
 * A text field whose value is obscured until the user asks to see it.
 *
 * ── Why not `type="password"` ────────────────────────────────────────────
 * Switching `type` mid-life makes browsers offer to save the value as a
 * password and, on some, resets the caret. This is an identity number on an
 * admissions form, not a credential: it wants the dots, not the password
 * manager.
 *
 * ── Why CSS, and not a masked string ─────────────────────────────────────
 * The first attempt rendered a *derived* string — `•••••-•••••67-1` — while
 * hidden, which meant the field had to be read-only or typing would have been
 * editing the mask. That is unusable: the field is empty and editable, the
 * first digit lands, and the second is refused because the value is no longer
 * empty. It survived automated testing only because scripted typing outran
 * React's re-render, which is exactly the kind of pass that hides a defect
 * rather than finding one.
 *
 * `text-security` obscures what is painted and leaves the input alone, so the
 * real value is always what is being edited: it can be typed into, reformatted
 * as `42101-1234567-1` on the way in, and corrected — all without ever being
 * legible over the clerk's shoulder.
 */

export interface SecretInputProps
  extends Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'type'> {
  label: string;
  value: string;
  error?: string;
  hint?: string;
  /** Accessible name for the toggle, e.g. "CNIC". Defaults to the label. */
  revealLabel?: string;
}

export function SecretInput({
  label,
  value,
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
          value={value}
          disabled={disabled}
          aria-invalid={hasError}
          aria-describedby={hasError || hint !== undefined ? messageId : undefined}
          // Both spellings: the unprefixed property is the one the CSS Working
          // Group settled on, the prefixed one is what shipping browsers
          // actually implement. `hidden` is never the only protection — the
          // value is masked again wherever it is merely displayed.
          style={
            revealed
              ? undefined
              : ({
                  WebkitTextSecurity: 'disc',
                  textSecurity: 'disc',
                } as CSSProperties)
          }
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
