import 'server-only';

import { randomBytes, timingSafeEqual } from 'node:crypto';

import { requireServerEnv, serverEnv } from './env';

/**
 * The GoHighLevel OAuth install flow.
 *
 * `lib/ghl-client.ts` has been able to *complete* an authorization-code
 * exchange since Sprint 1 — `exchangeGhlAuthorizationCode` encrypts the result
 * and writes `ghl_tokens`. Nothing ever called it. There was no consent
 * redirect and no callback route, so the only other writer was
 * `refreshAccessToken`, which needs a row to already exist. The table could
 * therefore never receive its first row for any school, and every
 * location-scoped call failed with "this school has not connected its
 * GoHighLevel account".
 *
 * This module is the missing half: where the operator is sent, and how the
 * callback proves the request is the same one that left.
 */

const DEFAULT_MARKETPLACE_URL = 'https://marketplace.gohighlevel.com';

/**
 * Scopes this application actually uses. Anything beyond them is access nobody
 * asked for, and GHL will refuse a scope the marketplace app was not
 * registered with — so this list and the app's own configuration have to agree.
 *
 *   contacts.*       — findOrCreateContact / findOrCreateContactByEmail
 *   conversations.*  — sendGhlEmail, sendWhatsAppMessage
 *   locations.readonly — getGhlLocation
 */
const DEFAULT_SCOPES = [
  'contacts.readonly',
  'contacts.write',
  'conversations.readonly',
  'conversations.write',
  'conversations/message.readonly',
  'conversations/message.write',
  'locations.readonly',
].join(' ');

/** Short-lived cookie carrying the state nonce and the school it belongs to. */
export const GHL_OAUTH_STATE_COOKIE = 'ghl_oauth_state';

/** Long enough to sign in to GHL and pick a location; short enough to matter. */
export const GHL_OAUTH_STATE_TTL_SECONDS = 15 * 60;

export interface OAuthState {
  /** The school row this install is being attached to. */
  schoolId: string;
  /** Expected `location_id`, so a mis-picked sub-account is caught. */
  locationId: string;
  nonce: string;
}

export function createOAuthState(schoolId: string, locationId: string): OAuthState {
  return { schoolId, locationId, nonce: randomBytes(32).toString('hex') };
}

export function encodeOAuthState(state: OAuthState): string {
  return Buffer.from(JSON.stringify(state), 'utf8').toString('base64url');
}

export function decodeOAuthState(raw: string): OAuthState | null {
  try {
    const parsed: unknown = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8'));
    if (typeof parsed !== 'object' || parsed === null) return null;

    const { schoolId, locationId, nonce } = parsed as Record<string, unknown>;
    if (typeof schoolId !== 'string' || schoolId === '') return null;
    if (typeof locationId !== 'string' || locationId === '') return null;
    if (typeof nonce !== 'string' || nonce === '') return null;

    return { schoolId, locationId, nonce };
  } catch {
    return null;
  }
}

/**
 * Compares the nonce from the callback URL against the one in the cookie.
 *
 * This is the CSRF defence for the install: without it, anyone could hand the
 * operator a link that attaches *their* GHL sub-account to one of our schools.
 * Constant-time because the nonce is compared against a secret we issued.
 */
export function nonceMatches(a: string, b: string): boolean {
  const left = Buffer.from(a, 'utf8');
  const right = Buffer.from(b, 'utf8');
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

/**
 * Where the operator is sent to authorise the install.
 *
 * `redirect_uri` must match the value registered on the GHL marketplace app
 * exactly — GHL compares it as a string, and a trailing slash is a different
 * URI. It is read from the environment rather than derived from the request so
 * that a preview host cannot silently send the consent screen somewhere the
 * marketplace app does not know about.
 */
export function buildGhlAuthorizeUrl(state: string): string {
  const base = serverEnv('GHL_MARKETPLACE_URL', DEFAULT_MARKETPLACE_URL).replace(
    /\/+$/,
    '',
  );

  const url = new URL(`${base}/oauth/chooselocation`);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('client_id', requireServerEnv('GHL_CLIENT_ID'));
  url.searchParams.set('redirect_uri', requireServerEnv('GHL_REDIRECT_URI'));
  url.searchParams.set('scope', serverEnv('GHL_OAUTH_SCOPES', DEFAULT_SCOPES));
  url.searchParams.set('state', state);

  return url.toString();
}

/** Cookie attributes for the state cookie. Mirrors the super-admin session. */
export function oauthStateCookieOptions(maxAge: number) {
  return {
    name: GHL_OAUTH_STATE_COOKIE,
    httpOnly: true,
    // `lax` rather than `strict`: the callback arrives as a top-level
    // navigation from marketplace.gohighlevel.com, and `strict` would withhold
    // the cookie on exactly that request.
    sameSite: 'lax' as const,
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge,
  };
}
