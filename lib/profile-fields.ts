import 'server-only';

import { emailRejectionReason, normaliseEmailAddress } from './email-validation';
import {
  isValidLandline,
  isValidMobile,
  LANDLINE_HINT,
  MOBILE_HINT,
  normaliseLandline,
  normaliseMobile,
} from './phone-formats';

/**
 * Server-side reading of the contact fields the school and branch forms share.
 *
 * ── Why this is not left to the forms ────────────────────────────────────
 * The forms already refuse a malformed number or address, and that refusal is
 * worth nothing: a request posted straight at the API never runs the browser's
 * code. These routes are behind `requireSuperAdmin()`, so this is not primarily
 * about defending against an attacker — it is about the far likelier case of a
 * second client. A script, a bulk import or the next surface someone builds
 * will reach these routes without going near `BranchForm`, and if the format is
 * only enforced in the form then whichever caller forgets it writes rows that
 * every screen then has to cope with.
 *
 * ── Why both sides import the same modules ───────────────────────────────
 * `lib/phone-formats.ts` and `lib/email-validation.ts` are pure and are used
 * unchanged in the browser. Only the *reading* — pulling an unknown off a JSON
 * body and turning it into a value or a complaint — is server-side, which is
 * why only this thin layer is `server-only`. Two implementations of "is this a
 * valid mobile" would be one implementation and one bug.
 */

export type FieldResult<T> = { ok: true; value: T } | { ok: false; message: string };

/**
 * A landline, normalised, or the reason it was refused.
 *
 * Absent and empty both mean "no landline" and are accepted: every caller
 * treats it as optional, and a route that wants it required should say so
 * itself rather than have that decided here.
 */
export function readLandlineField(value: unknown): FieldResult<string | null> {
  if (value === undefined || value === null) return { ok: true, value: null };
  if (typeof value !== 'string') {
    return { ok: false, message: 'The landline must be text.' };
  }

  if (value.trim() === '') return { ok: true, value: null };

  if (!isValidLandline(value)) {
    return { ok: false, message: `That landline is not usable. ${LANDLINE_HINT}` };
  }

  return { ok: true, value: normaliseLandline(value) };
}

/** A mobile in `(0321) 123-4567` form, normalised, or the reason it was refused. */
export function readMobileField(value: unknown): FieldResult<string | null> {
  if (value === undefined || value === null) return { ok: true, value: null };
  if (typeof value !== 'string') {
    return { ok: false, message: 'The mobile number must be text.' };
  }

  if (value.trim() === '') return { ok: true, value: null };

  if (!isValidMobile(value)) {
    return { ok: false, message: `That mobile number is not usable. ${MOBILE_HINT}` };
  }

  return { ok: true, value: normaliseMobile(value) };
}

/** An address, lower-cased, or the reason it was refused. */
export function readEmailField(value: unknown): FieldResult<string | null> {
  if (value === undefined || value === null) return { ok: true, value: null };
  if (typeof value !== 'string') {
    return { ok: false, message: 'The email address must be text.' };
  }

  if (value.trim() === '') return { ok: true, value: null };

  const problem = emailRejectionReason(value);
  if (problem !== null) return { ok: false, message: problem };

  return { ok: true, value: normaliseEmailAddress(value) };
}

/**
 * One half of a map coordinate, or null.
 *
 * Silently null for anything out of range rather than an error, because a
 * coordinate is an enrichment nothing depends on — see the column comments in
 * `db/schema/branches.ts`. Refusing the whole save because a stray value
 * arrived alongside a perfectly good address would trade something useful for
 * something that is not.
 */
export function readCoordinate(value: unknown, kind: 'latitude' | 'longitude'): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;

  const limit = kind === 'latitude' ? 90 : 180;
  return Math.abs(value) <= limit ? value : null;
}
