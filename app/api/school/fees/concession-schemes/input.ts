import { isSchemeType } from '@/db/schema/concession-schemes';
import type { SchemeInput } from '@/lib/concession-schemes';
import { paiseToNumeric, toPaise } from '@/lib/money';
import { isUuid, readOptionalString, readString } from '@/lib/validation';

/**
 * One reader for a scheme's body, shared by POST and PATCH.
 *
 * Written once because the two routes accept exactly the same thing, and the
 * failure mode of two copies is the one that matters here: a validator that
 * refuses a 120% discount on create and accepts it on edit is not a validator.
 *
 * Returns the parsed input, or the sentence to show the person who typed it.
 */
export function readSchemeInput(body: Record<string, unknown>): SchemeInput | string {
  const name = readString(body['name']);
  if (name === '' || name.length > 80) {
    return 'Give the scheme a name of 80 characters or fewer, e.g. “Sibling Discount”.';
  }

  /*
   * The kind of discount — Sprint 20, item 5.
   *
   * Read here rather than on each route, for the reason this whole module
   * exists: a create that classified a scheme and an edit that quietly dropped
   * the classification would be two validators, and the second would silently
   * reset every edited scheme to whatever the column defaulted to.
   *
   * Absent means `other`, which is the same reading the migration's backfill
   * takes: nothing is ever inferred from the scheme's *name*, on the way in or
   * afterwards.
   */
  const rawType = body['schemeType'];
  if (rawType !== undefined && rawType !== null && !isSchemeType(rawType)) {
    return 'Choose whether this is a sibling discount, a scholarship or something else.';
  }
  const schemeType = isSchemeType(rawType) ? rawType : 'other';

  const discountType = body['discountType'];
  if (discountType !== 'percentage' && discountType !== 'fixed') {
    return 'Choose whether the discount is a percentage or a fixed amount.';
  }

  const discountValue = Number(body['discountValue']);
  if (!Number.isFinite(discountValue) || discountValue <= 0) {
    return 'Enter a discount greater than zero.';
  }
  // A percentage over 100 would turn a fee into a refund, which the per-line
  // clamp would then absorb into a credit nobody meant to grant.
  if (discountType === 'percentage' && discountValue > 100) {
    return 'A percentage discount cannot exceed 100%.';
  }
  if (discountType === 'fixed' && discountValue > 9_999_999) {
    return 'That discount amount is too large.';
  }

  const validFrom = body['validFrom'];
  if (!isDateOnly(validFrom)) return 'Enter a valid start date.';

  const rawUntil = body['validUntil'];
  const validUntil =
    rawUntil === null || rawUntil === undefined || rawUntil === '' ? null : rawUntil;

  if (validUntil !== null && !isDateOnly(validUntil)) {
    return 'Enter a valid end date, or leave it blank for an open-ended scheme.';
  }
  if (validUntil !== null && validUntil < validFrom) {
    return 'The end date must be after the start date.';
  }

  /*
   * An empty list is legal and means **every fee head**.
   *
   * Not a shortcut — the rule. See `concessionHeads` in `lib/fee-calculator.ts`
   * and STATE.md §5be: reading the unqualified case narrowly is what stopped
   * every ordinary sibling discount reaching an admission, annual or
   * examination fee, invisibly, for twelve sprints.
   */
  const rawHeads = body['feeTypeIds'];
  const feeTypeIds = Array.isArray(rawHeads) ? rawHeads.filter(isUuid) : [];

  return {
    name,
    schemeType,
    discountType,
    discountValue:
      discountType === 'percentage'
        ? discountValue.toFixed(2)
        : paiseToNumeric(toPaise(discountValue)),
    validFrom,
    validUntil,
    // Absent means active: a scheme is created to be used, and the toggle is
    // for switching one off later.
    isActive: body['isActive'] === undefined ? true : body['isActive'] === true,
    notes: readOptionalString(body['notes']),
    feeTypeIds: [...new Set(feeTypeIds)],
  };
}

/** `YYYY-MM-DD`, and a real date rather than `2025-13-45`. */
function isDateOnly(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;

  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}
