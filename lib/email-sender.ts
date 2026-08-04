import 'server-only';

import { ghlFetch, GhlApiError } from './ghl-client';
import { GhlTokenError } from './ghl-tokens';

/**
 * White-label email, sent from each school's own GoHighLevel sub-account.
 *
 * Every call goes through `ghlFetch(endpoint, locationId, ...)`, which selects
 * the OAuth token belonging to that one school. GHL then applies that
 * sub-account's own sending domain and branding, so a parent at Beaconhouse
 * receives mail from Beaconhouse rather than from this platform. There is no
 * ambient "from" address anywhere in this module — the tenant is an argument,
 * and the wrong one is a compile error rather than a silent cross-brand send.
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
}

interface GhlSendMessageResponse {
  messageId?: string;
  emailMessageId?: string;
  msg?: { id?: string };
  conversationId?: string;
}

/**
 * Posts one email through the school's GHL Conversations API.
 *
 * @throws {EmailDeliveryError} when GHL refused the message or the school has
 *   not connected its GHL sub-account.
 */
export async function sendSchoolEmail(params: SendSchoolEmailParams): Promise<void> {
  const { locationId, to, subject, html, fromName } = params;

  if (locationId.trim() === '') {
    throw new EmailDeliveryError(locationId, 'no school was resolved for this send');
  }
  if (to.trim() === '') {
    throw new EmailDeliveryError(locationId, 'no recipient address');
  }

  try {
    await ghlFetch<GhlSendMessageResponse>('/conversations/messages', locationId, {
      method: 'POST',
      body: {
        type: 'Email',
        locationId,
        emailTo: to,
        subject,
        html,
        ...(fromName === undefined || fromName === ''
          ? {}
          : { fromName, emailFromName: fromName }),
        // Spam filters score a multipart message better than an HTML-only one,
        // and some clients still show the text part.
        message: htmlToPlainText(html),
      },
    });
  } catch (error) {
    if (error instanceof GhlTokenError) {
      throw new EmailDeliveryError(
        locationId,
        'this school has not connected its GoHighLevel account',
      );
    }

    if (error instanceof GhlApiError) {
      throw new EmailDeliveryError(locationId, `GHL returned ${error.status}`);
    }

    throw new EmailDeliveryError(
      locationId,
      error instanceof Error ? error.message : 'unknown error',
    );
  }
}

/**
 * Fire-and-forget variant.
 *
 * Returns whether the mail went out, so a caller that wants to say "we have
 * sent you a code" only when it is true still can — but never throws, so a
 * school with a broken GHL connection cannot turn a working request into a 500.
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
