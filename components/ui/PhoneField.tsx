'use client';

import { useEffect, useState } from 'react';

import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import {
  PHONE_KIND_OPTIONS,
  detectPhoneKind,
  formatPhoneOfKind,
  isValidPhoneOfKind,
  phoneErrorOfKind,
  phoneHintOfKind,
  phonePlaceholderOfKind,
  type PhoneKind,
} from '@/lib/phone-formats';
import { cn } from '@/lib/utils';

/**
 * The phone field. **Every input labelled "Phone" in this product is this
 * component**, and every one added in future must be.
 *
 * ── What it does ─────────────────────────────────────────────────────────
 * A Mobile/Landline dropdown that decides the mask on the input beside it:
 *
 *   Mobile    (xxxx) xxx-xxxx   exactly eleven digits, grouped 4-3-4
 *   Landline  (xxx) xxxxxxxxxx  a 3-digit area code, then up to ten digits
 *
 * Digits only, in both. Everything else is discarded as it is typed rather than
 * rejected afterwards, which is what makes the mask teachable: the operator
 * watches the brackets appear and is never told where they go. The masks
 * themselves live in `lib/phone-formats.ts` — the forms import them in the
 * browser and the API routes import them on the server, and the two must agree
 * exactly or the client accepts what the server refuses.
 *
 * ── Where the kind comes from ────────────────────────────────────────────
 * Nowhere: it is derived from the value, never stored. See `detectPhoneKind`
 * for why no table gained a `phone_kind` column. The consequence to know about
 * here is that this component owns the kind as local state after the first
 * render — otherwise re-deriving it on every keystroke would flip the dropdown
 * to Landline the moment someone deleted the fourth digit of a mobile.
 *
 * ── `identity`, and the one thing this field cannot do ───────────────────
 * Some phone numbers on this platform are not contact details, they are the
 * primary key on a person: a guardian's number is the unique index on
 * `student_guardians`, it is what an invitation resolves, and it is what a
 * one-time passcode is sent to. Those pass `identity` — the dropdown is still
 * there and Landline can still be chosen, but choosing it fails validation with
 * a message that says why, because the server will refuse the value anyway
 * (`normalizePhone` accepts `+92` and ten digits and nothing else).
 *
 * Showing the option and explaining the refusal beats hiding the option: an
 * operator holding a landline-only guardian needs to learn that the platform
 * cannot reach that guardian, and a missing dropdown teaches them nothing.
 */

export interface PhoneFieldProps {
  label?: string;
  /** The formatted number, e.g. `(0321) 123-4567`. */
  value: string;
  onChange: (next: string) => void;
  /** Notified when the operator switches the dropdown. Rarely needed. */
  onKindChange?: (kind: PhoneKind) => void;
  disabled?: boolean;
  required?: boolean;
  /** Replaces the format hint. The format is still enforced. */
  hint?: string;
  /** A caller's own error. Takes precedence over the format error. */
  error?: string;
  className?: string;
  /**
   * This number identifies a person, so it must be a mobile.
   *
   * See the note above. `true` wherever the value reaches `normalizePhone`.
   */
  identity?: boolean;
  /** Forces the starting kind instead of deriving it from `value`. */
  defaultKind?: PhoneKind;
}

const IDENTITY_LANDLINE_ERROR =
  'This number identifies the person on the platform, so it has to be a mobile — ' +
  'invitations and sign-in codes are sent to it.';

export function PhoneField({
  label = 'Phone',
  value,
  onChange,
  onKindChange,
  disabled = false,
  required = false,
  hint,
  error,
  className,
  identity = false,
  defaultKind,
}: PhoneFieldProps) {
  const [kind, setKind] = useState<PhoneKind>(
    () => defaultKind ?? detectPhoneKind(value),
  );

  /**
   * Re-derive when a value arrives from outside rather than from typing.
   *
   * The case this exists for is a form whose record loads after first paint, or
   * a panel reused for a second staff member without unmounting. Keyed on the
   * value only: a keystroke also changes the value, but by then the typed text
   * already matches the current mask, so `detectPhoneKind` returns the kind
   * that is already set and the dropdown does not move.
   */
  useEffect(() => {
    if (value.trim() === '') return;
    const detected = detectPhoneKind(value);
    setKind((current) => (isValidPhoneOfKind(current, value) ? current : detected));
  }, [value]);

  const switchKind = (next: PhoneKind) => {
    setKind(next);
    onKindChange?.(next);
    // Re-masked immediately, so the digits already typed survive the switch
    // instead of the field being silently invalid until it is retyped. Digits
    // beyond the new mask's ceiling are dropped, which is the same rule that
    // applies while typing.
    if (value.trim() !== '') onChange(formatPhoneOfKind(next, value));
  };

  const identityViolation = identity && kind === 'landline' && value.trim() !== '';
  const formatViolation = !isValidPhoneOfKind(kind, value);

  const shownError =
    error ??
    (identityViolation
      ? IDENTITY_LANDLINE_ERROR
      : formatViolation
        ? phoneErrorOfKind(kind)
        : undefined);

  return (
    <div
      className={cn('w-full', className)}
      role="group"
      // The dropdown's own label is the bare word "Type", so that the two
      // labels sit on one baseline and the row reads "Type | Phone" rather than
      // "Phone type | Phone". The group carries the full name for anyone who
      // reaches the select without seeing the input beside it.
      aria-label={label}
    >
      <div className="flex items-start gap-2">
        <div className="w-32 shrink-0">
          <Select
            label="Type"
            options={PHONE_KIND_OPTIONS}
            value={kind}
            disabled={disabled}
            onChange={(event) => {
              switchKind(event.target.value as PhoneKind);
            }}
          />
        </div>

        <div className="min-w-0 flex-1">
          <Input
            label={label}
            type="tel"
            // `numeric` rather than the default: the field takes digits only,
            // and a tel keypad on Android offers `+`, `*` and `#`, all of which
            // the mask throws away the instant they are typed.
            inputMode="numeric"
            required={required}
            value={value}
            disabled={disabled}
            placeholder={phonePlaceholderOfKind(kind)}
            error={shownError}
            hint={hint ?? phoneHintOfKind(kind)}
            onChange={(event) => {
              onChange(formatPhoneOfKind(kind, event.target.value));
            }}
          />
        </div>
      </div>
    </div>
  );
}
