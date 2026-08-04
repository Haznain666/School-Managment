'use client';

import { useCallback, useEffect, useRef, type ChangeEvent, type ClipboardEvent, type KeyboardEvent } from 'react';

import { cn } from '@/lib/utils';

export interface OtpCodeInputProps {
  /** The code so far. Always six characters or fewer, digits only. */
  value: string;
  onChange: (value: string) => void;
  /** Fired when the sixth digit lands, so the form can submit itself. */
  onComplete?: (value: string) => void;
  disabled?: boolean;
  error?: string | undefined;
  label?: string;
  autoFocus?: boolean;
}

const LENGTH = 6;

/**
 * Six separate boxes for a six-digit code.
 *
 * One `<input>` per digit rather than one field, because that is what makes the
 * phone keyboard behave: each box is `inputMode="numeric"`, and the first
 * carries `autocomplete="one-time-code"` so iOS and Android offer the code from
 * the notification rather than a saved password.
 *
 * The awkward parts are deliberate:
 *
 *   - Paste is handled on every box, not just the first. People paste onto
 *     whichever one their cursor happens to be in, and a paste handler on the
 *     first box alone silently drops five of the six digits.
 *   - Backspace on an empty box moves left and clears the one before it, which
 *     is what everyone expects and what no browser does for free.
 *   - The value is the single source of truth; the boxes only render it. That
 *     is what keeps a paste, a keystroke and a programmatic reset from
 *     disagreeing about what has been typed.
 */
export function OtpCodeInput({
  value,
  onChange,
  onComplete,
  disabled = false,
  error,
  label = 'Six-digit code',
  autoFocus = false,
}: OtpCodeInputProps) {
  const inputs = useRef<Array<HTMLInputElement | null>>([]);
  const hasError = error !== undefined && error !== '';

  useEffect(() => {
    if (autoFocus) inputs.current[0]?.focus();
  }, [autoFocus]);

  const commit = useCallback(
    (next: string) => {
      const digits = next.replace(/\D/g, '').slice(0, LENGTH);
      onChange(digits);
      if (digits.length === LENGTH) onComplete?.(digits);
      return digits;
    },
    [onChange, onComplete],
  );

  const handleChange = useCallback(
    (index: number, event: ChangeEvent<HTMLInputElement>) => {
      const typed = event.target.value.replace(/\D/g, '');
      if (typed === '') return;

      // Overwrite from this position rather than inserting, so retyping a digit
      // in the middle replaces it instead of pushing the rest along.
      const chars = value.padEnd(LENGTH, ' ').split('');
      let cursor = index;

      for (const char of typed) {
        if (cursor >= LENGTH) break;
        chars[cursor] = char;
        cursor += 1;
      }

      const next = commit(chars.join('').replace(/ /g, ''));
      inputs.current[Math.min(cursor, LENGTH - 1)]?.focus();

      if (next.length === LENGTH) inputs.current[LENGTH - 1]?.blur();
    },
    [commit, value],
  );

  const handleKeyDown = useCallback(
    (index: number, event: KeyboardEvent<HTMLInputElement>) => {
      if (event.key === 'Backspace') {
        event.preventDefault();

        if (value[index] !== undefined && value[index] !== '') {
          commit(value.slice(0, index) + value.slice(index + 1));
          return;
        }

        if (index > 0) {
          commit(value.slice(0, index - 1) + value.slice(index));
          inputs.current[index - 1]?.focus();
        }
        return;
      }

      if (event.key === 'ArrowLeft' && index > 0) {
        event.preventDefault();
        inputs.current[index - 1]?.focus();
      }

      if (event.key === 'ArrowRight' && index < LENGTH - 1) {
        event.preventDefault();
        inputs.current[index + 1]?.focus();
      }
    },
    [commit, value],
  );

  const handlePaste = useCallback(
    (event: ClipboardEvent<HTMLInputElement>) => {
      event.preventDefault();
      const pasted = event.clipboardData.getData('text');
      const next = commit(pasted);
      inputs.current[Math.min(next.length, LENGTH - 1)]?.focus();
    },
    [commit],
  );

  return (
    <div className="w-full">
      <span className="mb-1.5 block text-sm font-medium text-slate-700">{label}</span>

      <div className="flex gap-2" role="group" aria-label={label}>
        {Array.from({ length: LENGTH }, (_, index) => (
          <input
            key={index}
            ref={(element) => {
              inputs.current[index] = element;
            }}
            type="text"
            inputMode="numeric"
            // Only the first box offers the SMS/email code; repeating the hint
            // on all six makes browsers fill the same digit into each one.
            autoComplete={index === 0 ? 'one-time-code' : 'off'}
            maxLength={1}
            aria-label={`Digit ${index + 1}`}
            aria-invalid={hasError}
            disabled={disabled}
            value={value[index] ?? ''}
            onChange={(event) => {
              handleChange(index, event);
            }}
            onKeyDown={(event) => {
              handleKeyDown(index, event);
            }}
            onPaste={handlePaste}
            onFocus={(event) => {
              event.target.select();
            }}
            className={cn(
              'h-12 w-full min-w-0 rounded-lg border bg-white text-center text-lg font-semibold text-slate-900',
              'focus:outline focus:outline-2 focus:outline-offset-0',
              'disabled:cursor-not-allowed disabled:bg-slate-50 disabled:text-slate-500',
              hasError
                ? 'border-red-400 focus:outline-red-500'
                : 'border-slate-300 focus:outline-brand-primary',
            )}
          />
        ))}
      </div>

      {hasError ? (
        <p role="alert" className="mt-1.5 text-sm text-red-600">
          {error}
        </p>
      ) : null}
    </div>
  );
}
