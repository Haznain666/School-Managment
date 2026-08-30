/**
 * The two phone shapes a school record carries, and the masks that enforce them.
 *
 * ── Why this is not `lib/phone.ts` ───────────────────────────────────────
 * `lib/phone.ts` answers "is this a Pakistani mobile, and what is its canonical
 * E.164 form" — it is the identity function, used wherever a number selects a
 * person. This module answers a different question: "is what the operator typed
 * into *this field* the shape this field accepts, and how should it look while
 * they type". The two must not be merged. Normalising strips the formatting
 * that a display field exists to keep, and a landline has no E.164 identity in
 * this product at all because nobody signs in with one.
 *
 * They do meet at one point, deliberately: a mobile written in this module's
 * display format — `(0321) 123-4567` — is accepted by `normalizePhone`, whose
 * first act is to strip spaces, dashes and parentheses. So a field formatted
 * here still resolves to `+923211234567` when it reaches the identity path.
 *
 * ── The two formats ──────────────────────────────────────────────────────
 * Landline `(xxx) xxxxxxxxxx` — a three-digit area code in brackets followed by
 * up to ten digits. The subscriber part is genuinely variable in Pakistan (021
 * numbers run to eight, some exchanges fewer), so this is a ceiling rather than
 * an exact width.
 *
 * Mobile `(xxxx) xxx-xxxx` — exactly eleven digits, grouped 4-3-4, e.g.
 * `(0321) 123-4567`. Fixed width because a Pakistani mobile is always
 * `03xx` + seven digits, and anything else is a typo rather than a variant.
 * Nothing else is accepted, per the field's specification.
 *
 * Both are pure and dependency-free: the forms import them in the browser and
 * the API routes import them on the server, and the two must agree exactly or
 * the client accepts what the server rejects.
 */

/** Everything that is not a digit. */
function digitsOf(value: string): string {
  return value.replace(/\D/g, '');
}

/* -----------------------------------------------------------------------------
 * Landline — (xxx) xxxxxxxxxx
 * -------------------------------------------------------------------------- */

/** Area code digits, then between these many subscriber digits. */
const LANDLINE_AREA_DIGITS = 3;
const LANDLINE_MAX_SUBSCRIBER_DIGITS = 10;
/**
 * The floor, and why there is one.
 *
 * There was not, and `digits.length > LANDLINE_AREA_DIGITS` alone accepted
 * `1234` — stored, after masking, as `(123) 4`. That is not a number anybody
 * can ring, and on the staff-invitation path it lands in `school_users.phone`,
 * which is `NOT NULL` and unique per school: two people typo'd the same way
 * collide on a constraint rather than on anything a clerk can read.
 *
 * Four is the smallest subscriber part worth accepting and makes the total
 * seven digits, which is exactly the floor the hand-rolled regex in
 * `POST /api/school/invitations` used to enforce before it was replaced by
 * this module. Deliberately not six or eight: Pakistani exchanges genuinely
 * vary, and a validator that refuses a real small-town number is a worse
 * failure than one that accepts an implausibly short one.
 */
const LANDLINE_MIN_SUBSCRIBER_DIGITS = 4;

export const LANDLINE_PLACEHOLDER = '(021) 3456789';
export const LANDLINE_HINT = 'Format (xxx) xxxxxxxxxx — a 3-digit area code, then 4 to 10 digits.';

/**
 * Formats as it is typed, discarding anything that is not a digit.
 *
 * Reformatting rather than validating-on-blur is what makes the mask teachable:
 * the operator sees the brackets appear at the third digit and never has to be
 * told where they go. Digits past the ceiling are dropped rather than rejected,
 * so holding a key down cannot produce a value the field would refuse.
 */
export function formatLandline(input: string): string {
  const digits = digitsOf(input).slice(
    0,
    LANDLINE_AREA_DIGITS + LANDLINE_MAX_SUBSCRIBER_DIGITS,
  );

  if (digits === '') return '';
  if (digits.length <= LANDLINE_AREA_DIGITS) return `(${digits}`;

  return `(${digits.slice(0, LANDLINE_AREA_DIGITS)}) ${digits.slice(LANDLINE_AREA_DIGITS)}`;
}

/**
 * True when the value carries enough digits to be a landline, or is empty.
 *
 * Digits only — this says nothing about the brackets. It is the question the
 * *server* asks, where a caller that is not this application may legitimately
 * send `0213456789`, and where the answer is followed by normalisation into the
 * display form. `isValidLandline` below is the stricter question the form asks.
 *
 * Empty passes because the field is optional everywhere it appears. A partial
 * value does not: `(021) 3` is a number nobody can ring.
 */
export function hasCompleteLandlineDigits(value: string): boolean {
  const trimmed = value.trim();
  if (trimmed === '') return true;

  const digits = digitsOf(trimmed);
  return (
    digits.length >= LANDLINE_AREA_DIGITS + LANDLINE_MIN_SUBSCRIBER_DIGITS &&
    digits.length <= LANDLINE_AREA_DIGITS + LANDLINE_MAX_SUBSCRIBER_DIGITS
  );
}

/**
 * True when the value is exactly the display format, or is empty.
 *
 * Shape as well as digits, because the format is a specification rather than a
 * preference and the form is where it is specified. The field reformats on
 * every keystroke, so an operator can never produce a value this refuses —
 * which is the point: the check exists to catch a value that arrived some
 * *other* way and was not put through the mask.
 */
export function isValidLandline(value: string): boolean {
  const trimmed = value.trim();
  if (trimmed === '') return true;

  return hasCompleteLandlineDigits(trimmed) && trimmed === formatLandline(trimmed);
}

/** Normalises to the stored form, so two operators typing it differently agree. */
export function normaliseLandline(value: string): string {
  return formatLandline(value);
}

/* -----------------------------------------------------------------------------
 * Mobile — (xxxx) xxx-xxxx
 * -------------------------------------------------------------------------- */

/** `03xx` + seven. Eleven digits, and never any other count. */
const MOBILE_DIGITS = 11;

export const MOBILE_PLACEHOLDER = '(0321) 123-4567';
export const MOBILE_HINT = 'Format (xxxx) xxx-xxxx, e.g. (0321) 123-4567.';

/**
 * Formats as it is typed.
 *
 * A leading `92` or `+92` is rewritten to the national `0` trunk form first, so
 * pasting `+92 321 1234567` — which is how a number arrives from a contact card
 * or an exported contact list — lands as `(0321) 123-4567` rather than being rejected
 * for having the wrong first digit.
 */
export function formatMobile(input: string): string {
  let digits = digitsOf(input);

  if (digits.startsWith('92') && !digits.startsWith('920')) {
    digits = `0${digits.slice(2)}`;
  }

  digits = digits.slice(0, MOBILE_DIGITS);

  if (digits === '') return '';
  if (digits.length <= 4) return `(${digits}`;
  if (digits.length <= 7) return `(${digits.slice(0, 4)}) ${digits.slice(4)}`;

  return `(${digits.slice(0, 4)}) ${digits.slice(4, 7)}-${digits.slice(7)}`;
}

/**
 * True when the value carries a complete set of mobile digits, or is empty.
 *
 * Digits only, after the `+92` rewrite — the server's question, for the same
 * reason as `hasCompleteLandlineDigits`. The leading `0` is required as well as
 * the length: ten digits starting `321` is a number missing its trunk prefix,
 * and accepting it would store a value `normalizePhone` later turns into a
 * different number than the one that was meant.
 */
export function hasCompleteMobileDigits(value: string): boolean {
  const trimmed = value.trim();
  if (trimmed === '') return true;

  const digits = digitsOf(formatMobile(trimmed));
  // `03` and not merely `0`. A Lahore landline is eleven digits too —
  // `042 35300000` — and a check on the leading zero alone accepted it as a
  // mobile, which then masked it as `(0423) 530-0000`: a number that does not
  // exist, derived from one that does. Every Pakistani mobile prefix is `03xx`.
  return digits.length === MOBILE_DIGITS && digits.startsWith('03');
}

/**
 * True when the value is exactly `(xxxx) xxx-xxxx`, or is empty.
 *
 * Strict on the shape, not merely the digits, because the requirement is
 * explicit that "any other format is not acceptable". `0321-1234567` has the
 * right eleven digits and is refused here — it is a different format, and a
 * validator that accepted it would leave the field's own rule unenforced
 * wherever a value bypassed the mask.
 */
export function isValidMobile(value: string): boolean {
  const trimmed = value.trim();
  if (trimmed === '') return true;

  return hasCompleteMobileDigits(trimmed) && trimmed === formatMobile(trimmed);
}

/** Normalises to the stored form. */
export function normaliseMobile(value: string): string {
  return formatMobile(value);
}

/* -----------------------------------------------------------------------------
 * Kind — which of the two masks a given field is currently wearing
 *
 * Added when the Mobile/Landline dropdown was rolled out to every field labelled
 * "Phone". Before that, School and Branch carried two separate always-visible
 * fields ("Landline" and "Mobile phone") and no field ever had to ask which
 * shape it was in. Everywhere else there was one unmasked `Phone` box.
 *
 * The kind is deliberately **not stored**. No table gained a `phone_kind`
 * column, because the format is self-describing: `(0321) 123-4567` can only be
 * a mobile and `(021) 3456789` can only be a landline. Deriving it on load
 * keeps 61 foreign keys, every import path and every existing row untouched,
 * and means a number written by an API client that never saw the dropdown
 * still displays under the right mask.
 * -------------------------------------------------------------------------- */

export type PhoneKind = 'mobile' | 'landline';

/** Dropdown contents. Mobile leads because it is the common case. */
export const PHONE_KIND_OPTIONS: readonly { value: PhoneKind; label: string }[] = [
  { value: 'mobile', label: 'Mobile' },
  { value: 'landline', label: 'Landline' },
];

/**
 * Which mask a stored value belongs under.
 *
 * Falls back to `mobile` for an empty field: a new record is far more often
 * given a mobile, and starting on the stricter mask means the operator who
 * types a landline is told to switch rather than silently storing eleven digits
 * of a number that has ten.
 *
 * The order of the tests matters. A mobile is checked first and by *digits*
 * rather than by shape, so `03001234567` pasted from a spreadsheet is
 * recognised as a mobile rather than being read as a three-digit area code
 * followed by eight subscriber digits — which is what a landline-first test
 * would conclude, and it would be wrong every time.
 */
export function detectPhoneKind(value: string): PhoneKind {
  const trimmed = value.trim();
  if (trimmed === '') return 'mobile';
  if (hasCompleteMobileDigits(trimmed)) return 'mobile';

  // An incomplete value still under the mobile mask: `(0321) 12` has the
  // four-digit bracket a landline never has.
  if (/^\(\d{4}\)/.test(trimmed)) return 'mobile';

  const digits = digitsOf(trimmed);
  if (digits.startsWith('03') && digits.length <= MOBILE_DIGITS) return 'mobile';
  if (digits.startsWith('923') || digits.startsWith('+923')) return 'mobile';

  return trimmed === '' ? 'mobile' : 'landline';
}

/** The mask for `kind`, applied as the operator types. */
export function formatPhoneOfKind(kind: PhoneKind, input: string): string {
  return kind === 'mobile' ? formatMobile(input) : formatLandline(input);
}

/** True when `value` is exactly the display format for `kind`, or is empty. */
export function isValidPhoneOfKind(kind: PhoneKind, value: string): boolean {
  return kind === 'mobile' ? isValidMobile(value) : isValidLandline(value);
}

/** Digits-only completeness for `kind` — the question the server asks. */
export function hasCompletePhoneDigits(kind: PhoneKind, value: string): boolean {
  return kind === 'mobile'
    ? hasCompleteMobileDigits(value)
    : hasCompleteLandlineDigits(value);
}

/* -----------------------------------------------------------------------------
 * Either mask — for a field that takes whichever the person actually has
 * -------------------------------------------------------------------------- */

/**
 * Normalises a value under whichever mask it belongs to.
 *
 * The server's counterpart to what `PhoneField` does on every keystroke, so a
 * number typed through the form and the same number posted by an API client
 * are stored identically. Idempotent: a value already in display form comes
 * back unchanged.
 */
export function normalisePhoneOfAnyKind(value: string): string {
  const trimmed = value.trim();
  if (trimmed === '') return '';
  return formatPhoneOfKind(detectPhoneKind(trimmed), trimmed);
}

/**
 * True when `value` is a complete number under *either* mask.
 *
 * ── Why this is not `isValidPhoneOfKind` with a guess at the kind ────────
 * The per-kind validators answer `true` for an empty string, because every
 * field they were written for is optional. This one answers `false`, because
 * the callers are the routes where the column is `NOT NULL` — an empty value
 * there is the failure, not the default.
 *
 * ── Why digits and not shape ─────────────────────────────────────────────
 * A server must accept `0213456789` from a caller that never saw the mask, and
 * then normalise it. Refusing on shape would make the API usable only by this
 * application's own forms. Pair it with `normalisePhoneOfAnyKind` and the
 * stored value is in display form either way.
 */
export function hasCompletePhoneOfAnyKind(value: string): boolean {
  const trimmed = value.trim();
  if (trimmed === '') return false;
  return hasCompletePhoneDigits(detectPhoneKind(trimmed), trimmed);
}

/** Placeholder and hint for `kind`, so a caller never hard-codes either. */
export function phonePlaceholderOfKind(kind: PhoneKind): string {
  return kind === 'mobile' ? MOBILE_PLACEHOLDER : LANDLINE_PLACEHOLDER;
}

export function phoneHintOfKind(kind: PhoneKind): string {
  return kind === 'mobile' ? MOBILE_HINT : LANDLINE_HINT;
}

/** The message a field shows when the value is the wrong shape for its kind. */
export function phoneErrorOfKind(kind: PhoneKind): string {
  return kind === 'mobile'
    ? 'Enter eleven digits, e.g. (0321) 123-4567.'
    : 'Incomplete landline number — a 3-digit area code, then 4 to 10 digits.';
}

/* -----------------------------------------------------------------------------
 * Out of storage and back onto a screen
 * -------------------------------------------------------------------------- */

/**
 * `+923211234567` -> `(0321) 123-4567`. The inverse of what the mask accepts.
 *
 * ── The defect this closes ───────────────────────────────────────────────
 * `student_guardians.phone` is an *identity* and is stored canonically by
 * `lib/phone.ts` as E.164. That is right and must not change — it is what the
 * sibling lookup and the family voucher agree on. The mistake was on the way
 * **out**: the stored string was handed straight to `PhoneField`, whose value
 * is a display-format one, and `isValidMobile('+923211234567')` is false
 * because the shape is not `(xxxx) xxx-xxxx`. So the field showed an error on a
 * number the server itself had written, on every guardian panel in the product.
 *
 * This is the one function that turns a stored number back into the shape the
 * field speaks. Call it wherever a column value reaches a `PhoneField` or a
 * screen; never before a write, where `normalizePhone` still rules.
 *
 * Idempotent, and safe on anything: a value already in display form comes back
 * unchanged, a landline goes through its own mask, and a string this module
 * cannot read at all is returned as it stands rather than blanked — showing a
 * number nobody can parse beats showing nothing where a number is.
 */
export function formatPhoneForDisplay(stored: string | null | undefined): string {
  const trimmed = (stored ?? '').trim();
  if (trimmed === '') return '';

  /*
   * A value carrying a letter is not a number, and must be handed back
   * untouched.
   *
   * `school_users.phone` is `NOT NULL` and a seven-year-old has no phone, so a
   * student's directory row holds the sentinel `student:GVS-2025-0011` — see
   * `studentDirectoryPhone`. Its digits (`20250011`) are a plausible landline
   * count, so a mask applied blindly would render it `(202) 50011`: a number
   * that does not exist, derived from something that was never a number. The
   * same trap as the `042` landline that `hasCompleteMobileDigits` guards
   * against, one layer out.
   */
  if (/[A-Za-z]/.test(trimmed)) return trimmed;

  /*
   * And a value carrying a mask character is not a number either.
   *
   * ── The defect this closes (Sprint 20, item 4a) ───────────────────────
   * `lib/defaulters.ts` masks the guardian's number *before* it reaches the
   * screen, on purpose — the aged-debt report exists to decide who to chase,
   * and rendering four hundred parents' full numbers into one page is handing
   * out a contact list. `maskPhone('+923211234567')` gives `+92321****5555`.
   *
   * This function then stripped every non-digit, asterisks included, and
   * re-grouped what was left. Nine digits went through the mobile mask and came
   * out as `(0321) 555-5`: a number that is not the parent's, is not any
   * length a Pakistani number has, and looks entirely deliberate.
   *
   * Same reasoning as the letter test above, and the same answer: digits that
   * are not a *whole* number must never be re-grouped. `maskDisplayPhone`
   * below is the other half of the fix — mask after formatting, not before —
   * and either alone would leave the trap loaded for the next caller.
   */
  if (trimmed.includes('*')) return trimmed;

  const formatted = normalisePhoneOfAnyKind(trimmed);
  return formatted === '' ? trimmed : formatted;
}

/**
 * A stored number, formatted for reading and *then* masked:
 * `+923211234567` -> `(0321) ***-4567`.
 *
 * ── Why this exists rather than `maskPhone` (Sprint 20, item 4a) ─────────
 * `maskPhone` in `lib/phone.ts` masks the E.164 storage form — `+92321****5555`
 * — and has a different job: confirming to somebody which number a passcode was
 * just sent to, in a sentence, where the shape of the string is irrelevant. Put
 * that value in a table column and it reads as a corrupted number, and putting
 * it through a formatter (which is what happened) produced a plausible wrong
 * one.
 *
 * This masks the **display** form instead, so the result still reads as a
 * Pakistani mobile, still has the right number of digits in the right groups,
 * and cannot be mistaken for a real number by a person or re-parsed by a
 * formatter. The trunk code stays — an accountant deciding whether to chase a
 * family recognises `0321` — and so do the last four, which is how a colleague
 * confirms they are looking at the right parent before asking for the number.
 *
 * Anything this module cannot read is masked by the crude rule instead of being
 * handed back whole: a value that is not a recognisable number is still
 * somebody's contact detail, and the safe failure is the unreadable one.
 * Blank stays blank — there is nothing to conceal.
 */
export function maskDisplayPhone(stored: string | null | undefined): string {
  const shown = formatPhoneForDisplay(stored);
  if (shown === '') return '';

  // `(0321) 123-4567` -> `(0321) ***-4567`. The subscriber middle only: the
  // trunk code is how a reader tells a mobile from a landline, and the last
  // four are how they confirm the right family without being given the number.
  const mobile = /^(\(\d{4}\) )\d{3}(-\d{4})$/.exec(shown);
  if (mobile !== null) return `${mobile[1]!}***${mobile[2]!}`;

  // `(021) 34567890` -> `(021) ****7890`. A landline's subscriber part varies
  // from four to ten digits, so the mask is sized to what is actually there
  // rather than to a fixed count that would sometimes reveal more than the
  // mobile mask does.
  const landline = /^(\(\d{3}\) )(\d+)$/.exec(shown);
  if (landline !== null) {
    const digits = landline[2]!;
    const tail = digits.slice(-4);
    return `${landline[1]!}${'*'.repeat(Math.max(digits.length - tail.length, 1))}${tail}`;
  }

  // Anything else — a number this module could not parse, or one already
  // masked. Conceal all but the last four rather than printing it whole.
  const tail = shown.slice(-4);
  return `${'*'.repeat(Math.max(shown.length - tail.length, 1))}${tail}`;
}
