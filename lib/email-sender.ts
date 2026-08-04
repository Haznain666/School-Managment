import 'server-only';

import { db } from './drizzle';
import { findOrCreateContactByEmail, sendGhlEmail, GhlApiError } from './ghl-client';
import { GhlTokenError } from './ghl-tokens';

/**
 * White-label email, sent from each school's own GoHighLevel sub-account.
 *
 * Every send is tenant-scoped: the `locationId` selects the sub-account, its
 * OAuth token authorises both calls, and GHL resolves the sending domain and
 * the sender identity from that sub-account's LC Email configuration. A parent
 * at Beaconhouse receives mail from Beaconhouse, not from this platform.
 *
 * This module names no sender. There is no `from` parameter to pass and no
 * agency-key path to fall back to, because either would be a shared sender —
 * the one thing a white-label system must never produce.
 *
 * ── Why a contact is created first ───────────────────────────────────────
 * GHL has no "send to an address" endpoint. Every message belongs to a
 * conversation and every conversation belongs to a contact, which is why
 * `sendWhatsAppMessage` resolves a contact before posting and why this does
 * too. Posting a message with no `contactId` is rejected.
 *
 * Two delivery contracts, because two kinds of mail fail differently:
 *
 *   sendSchoolEmail         — throws. For mail the user is waiting on, where
 *                             pretending it was sent leaves them stuck at a
 *                             screen asking for a code that will never arrive.
 *   sendSchoolEmailQuietly  — logs and returns. For mail nobody is blocked on.
 */

export class EmailDeliveryError extends Error {
  readonly locationId: string;

  constructor(locationId: string, cause: string) {
    super(`Email delivery failed for location ${locationId}: ${cause}`);
    this.name = 'EmailDeliveryError';
    this.locationId = locationId;
  }
}

export interface SendSchoolEmailParams {
  /** GHL Location ID — selects which school's sub-account sends the mail. */
  locationId: string;
  to: string;
  subject: string;
  html: string;
  /** Recipient's names, used only if a GHL contact has to be created. */
  firstName?: string | undefined;
  lastName?: string | undefined;
}

/**
 * Sends one email through the school's GHL sub-account.
 *
 * @throws {EmailDeliveryError} when GHL refused the message or the school's
 *   sub-account could not be reached.
 */
export async function sendSchoolEmail(params: SendSchoolEmailParams): Promise<void> {
  const { locationId, to, subject, html, firstName, lastName } = params;

  if (locationId.trim() === '') {
    throw new EmailDeliveryError(locationId, 'no school was resolved for this send');
  }
  if (to.trim() === '') {
    throw new EmailDeliveryError(locationId, 'no recipient address');
  }

  try {
    // GHL attaches every message to a conversation and every conversation to
    // a contact, so the contact has to exist before the message can be sent.
    // This is the same order `sendWhatsAppMessage` uses.
    const { contactId } = await findOrCreateContactByEmail(db, locationId, {
      email: to,
      firstName,
      lastName,
    });

    await sendGhlEmail(db, locationId, {
      contactId,
      subject,
      html,
      text: htmlToPlainText(html),
    });
  } catch (error) {
    throw new EmailDeliveryError(locationId, describe(error));
  }
}

/**
 * Fire-and-forget variant.
 *
 * Returns whether the mail went out, so a caller that wants to distinguish the
 * two still can — but never throws, so a school with a broken GHL connection
 * cannot turn a working request into a 500.
 *
 * Callers on the sign-in and reset paths deliberately ignore the return value:
 * telling the browser whether delivery succeeded would tell it whether the
 * address exists.
 */
export async function sendSchoolEmailQuietly(
  params: SendSchoolEmailParams,
): Promise<boolean> {
  try {
    await sendSchoolEmail(params);
    return true;
  } catch (error) {
    // The reason is logged; the code or link inside the mail never is.
    console.warn(
      '[email-sender]',
      error instanceof Error ? error.message : 'unknown email error',
    );
    return false;
  }
}

/**
 * Splits a stored full name into the first/last pair GHL wants on a contact.
 *
 * Only ever used to label a contact that has to be created. Nothing downstream
 * depends on the split being right for names that do not follow the pattern —
 * a mononym becomes a first name and that is fine.
 */
export function splitName(full: string | null | undefined): {
  firstName?: string;
  lastName?: string;
} {
  const parts = (full ?? '').trim().split(/\s+/).filter((part) => part !== '');
  if (parts.length === 0) return {};
  return { firstName: parts[0] ?? '', lastName: parts.slice(1).join(' ') };
}

function describe(error: unknown): string {
  if (error instanceof GhlTokenError) {
    return 'this school has not connected its GoHighLevel account';
  }
  if (error instanceof GhlApiError) {
    return `GHL ${error.endpoint} returned ${error.status}: ${error.body.slice(0, 200)}`;
  }
  return error instanceof Error ? error.message : 'unknown error';
}

/**
 * A readable text/plain alternative for the HTML body.
 *
 * Crude by design: these are templates this repository writes, not arbitrary
 * markup, so tags plus entities plus whitespace is the whole job.
 */
function htmlToPlainText(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|h[1-6]|tr|li)>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
}
