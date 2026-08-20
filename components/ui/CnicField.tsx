'use client';

import { SecretInput } from '@/components/ui/SecretInput';
import { cnicProblem, formatCnic, isValidCnic } from '@/lib/national-id';

/**
 * The CNIC / Smart Card field, defined once for the whole product.
 *
 * ── Why this is a component and not a `<Input label="CNIC">` ─────────────
 * It was four `<Input>`s — on the enrolment guardian step, the guardian panel,
 * the public application form and the staff record — and only the student's
 * own document had the mask, the reveal and the validation, because that one
 * went through `NationalIdField`. So the same number was refused on one screen
 * and stored as `4210112345671` on the next, and nothing on either screen said
 * which behaviour was the intended one.
 *
 * That is now a defect rather than an inconsistency. A guardian's CNIC is the
 * key that makes two enrolled children siblings (`lib/siblings.ts`); a column
 * holding three spellings of one number cannot answer that. The mask is
 * therefore not cosmetic — it is what makes the value comparable.
 *
 * ── What it inherits from the student's field ────────────────────────────
 * Everything visible: `SecretInput`'s dots and eye toggle, `formatCnic`'s
 * as-you-type 5-7-1 grouping, the same hint and the same refusal message. A
 * clerk who has learned the field on the enrolment screen has learned it
 * everywhere. `scripts/check-cnic.ts` is what keeps that true for screens
 * nobody has written yet.
 *
 * ── Blank is always allowed ──────────────────────────────────────────────
 * No screen may refuse to record a person because the card is not to hand. See
 * `cnicProblem` for why an invented number is worse than an absent one.
 */

export interface CnicFieldProps {
  value: string;
  onChange: (value: string) => void;
  /** Overrides the default "CNIC / Smart Card". */
  label?: string;
  disabled?: boolean;
  required?: boolean;
  /** Shown instead of the hint. Set when the step has been validated. */
  error?: string;
  /** Replaces the default hint while there is no error. */
  hint?: string;
  /**
   * Called once, on each transition into a complete and well-formed number.
   *
   * This is what the enrolment form hangs its family lookup on. It fires on
   * completion rather than on blur because the clerk's next action after the
   * thirteenth digit is to type the guardian's name — which is precisely the
   * field the lookup is about to fill in for them.
   */
  onComplete?: (cnic: string) => void;
}

export function CnicField({
  value,
  onChange,
  label = 'CNIC / Smart Card',
  disabled = false,
  required = false,
  error,
  hint,
  onComplete,
}: CnicFieldProps) {
  return (
    <SecretInput
      label={required ? `${label} *` : label}
      revealLabel={label}
      value={value}
      error={error}
      hint={error === undefined ? (hint ?? 'Digits only — 5, then 7, then 1.') : undefined}
      placeholder="42101-1234567-1"
      inputMode="numeric"
      disabled={disabled}
      // Fifteen: thirteen digits and the two hyphens the mask inserts.
      maxLength={15}
      onChange={(event) => {
        const next = formatCnic(event.target.value);
        onChange(next);

        // Only on the transition, so holding the caret at the end of a finished
        // number does not re-fire the lookup on every keystroke that changes
        // nothing.
        if (onComplete !== undefined && isValidCnic(next) && !isValidCnic(value)) {
          onComplete(next);
        }
      }}
    />
  );
}

/** Re-exported so a form validating a step imports one module, not two. */
export { cnicProblem };
