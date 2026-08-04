import 'server-only';

import { db } from './drizzle';
import {
  findOrCreateContactByEmail,
  sendGhlEmail,
  GhlAgencyError,
  GhlApiError,
} from './ghl-client';
import { GhlTokenError } from './ghl-tokens';

/**
 * White-label email, sent from each school's own GoHighLevel sub-account.
 *
 * Every send is tenant-scoped: the `locationId` selects the sub-account, and
 * GHL resolves the sending domain, the branding and the sender identity from
 * it. A parent at Beaconhouse receives mail from Beaconhouse, not from this
 * platform. There is no ambient "from" address anywhere in this module and no
 * shared sender — the tenant is a required argument, so the wrong one is a
 * compile error rather than a silent cross-brand send.
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
  /** Display name on the envelope. The school's name, normally. */
  fromName?: string | undefined;
  /** Recipient's name, used only if a GHL contact has to be created. */
  toName?: string | undefined;
}

/**
 * Sends one email through the school's GHL sub-account.
 *
 * @throws {EmailDeliveryError} when GHL refused the message or the school's
 *   sub-account could not be reached.
 */
export async function sendSchoolEmail(params: SendSchoolEmailParams): Promise<void> {
  const { locationId, to, subject, html, fromName, toName } = params;

  if (locationId.trim() === '') {
    throw new EmailDeliveryError(locationId, 'no school was resolved for this send');
  }
  if (to.trim() === '') {
    throw new EmailDeliveryError(locationId, 'no recipient address');
  }

  try {
    const { contactId } = await findOrCreateContactByEmail(db, locationId, {
      email: to,
      name: toName,
    });

    await sendGhlEmail(db, locationId, {
      contactId,
      subject,
      html,
      text: htmlToPlainText(html),
      fromName,
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

function describe(error: unknown): string {
  if (error instanceof GhlTokenError) {
    return 'this school has not connected its GoHighLevel account';
  }
  if (error instanceof GhlApiError) {
    return `GHL returned ${error.status}`;
  }
  if (error instanceof GhlAgencyError) {
    return `GHL agency call returned ${error.status}`;
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
