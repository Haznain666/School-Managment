'use client';

import { useRef } from 'react';

import { SecretInput } from '@/components/ui/SecretInput';
import { cnicProblem, formatCnic, isValidCnic } from '@/lib/national-id';

/**
 * The CNIC / Smart Card field, defined once for the whole product.
 *
 * ── Why this is a component and not a `<Input label="CNIC">` ─────────────
 * It was four `<Input>`s — on the enrollment guardian step, the guardian panel,
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
 * clerk who has learned the field on the enrollment screen has learned it
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
   * Called once per complete, well-formed number — every *different* one.
   *
   * This is what the enrollment form hangs its family lookup on. It fires on
   * completion rather than on blur because the clerk's next action after the
   * thirteenth digit is to type the guardian's name — which is precisely the
   * field the lookup is about to fill in for them.
   *
   * ── What it used to be, and the correction it swallowed ─────────────────
   * The guard was `isValidCnic(next) && !isValidCnic(value)` — the *invalid to
   * valid* edge. The field is `maxLength={15}`, so the only three ways to
   * change a number that is already complete are deleting from it, typing over
   * a selection, and pasting over one; and the last two arrive as a single
   * change event whose previous value was **also** a valid CNIC. The edge test
   * read that as "nothing has changed" and suppressed the lookup.
   *
   * `GuardianForm`'s own `onChange` had meanwhile already cleared `matched` and
   * `known` — correctly, because the number no longer names the person the card
   * was filled from. So a clerk who selected a wrong digit and typed the right
   * one over it was left with no sibling banner, no prefill, and no way to get
   * either back short of reloading the page. The screen looked like a family
   * that is not a family, which is the failure CLAUDE.md's CNIC rule exists to
   * prevent, arriving from the opposite direction.
   *
   * The ref keeps the original intent — a keystroke that changes nothing does
   * not re-fire — and expresses it as what it always meant: the last number we
   * asked about. Every genuinely new number fires; the same one never fires
   * twice; and clearing the field forgets it, so retyping the same number after
   * a correction asks again.
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
  /**
   * The last complete number this field asked about, or null.
   *
   * A ref rather than state: nothing renders from it, and re-rendering on it
   * would put the lookup one paint behind the typing.
   */
  const lastCompleted = useRef<string | null>(null);

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

        if (onComplete === undefined) return;

        // An incomplete number is not a question, and it forgets the last one:
        // deleting a digit and retyping it is a clerk correcting themselves,
        // and they should get an answer for it.
        if (!isValidCnic(next)) {
          lastCompleted.current = null;
          return;
        }

        // The same number, asked again — a caret move, a re-paste of what is
        // already there. This is the case the old edge test was written for.
        if (lastCompleted.current === next) return;

        lastCompleted.current = next;
        onComplete(next);
      }}
    />
  );
}

/** Re-exported so a form validating a step imports one module, not two. */
export { cnicProblem };
