import 'server-only';

import { and, eq } from 'drizzle-orm';

import { schools } from '@/db/schema';

import type { Database } from './drizzle';
import { requireServerEnv, serverEnv } from './env';
import {
  GhlTokenError,
  readGhlTokens,
  writeGhlTokens,
  type GhlTokenSet,
} from './ghl-tokens';

/**
 * Typed GoHighLevel API client.
 *
 * Every call is tenant-scoped: `locationId` is a required argument, and it is
 * what selects the OAuth token to use. There is no "default" or ambient
 * location — passing the wrong one is a compile error away, not a silent
 * cross-tenant read.
 *
 * Responsibilities:
 *   - fetch the school's token, refreshing it when it is close to expiry
 *   - attach the Authorization / Version headers GHL requires
 *   - retry 429s and 5xxs with exponential backoff + jitter
 *   - surface failures as a typed `GhlApiError`
 */

const DEFAULT_BASE_URL = 'https://services.leadconnectorhq.com';
const DEFAULT_API_VERSION = '2021-07-28';

/** Refresh this long before actual expiry so in-flight calls never race it. */
const TOKEN_REFRESH_MARGIN_MS = 5 * 60 * 1000; // 5 minutes

const MAX_RETRIES = 4;
const BASE_BACKOFF_MS = 500;
const MAX_BACKOFF_MS = 8_000;

export function ghlBaseUrl(): string {
  return serverEnv('GHL_API_BASE_URL', DEFAULT_BASE_URL).replace(/\/+$/, '');
}

export class GhlApiError extends Error {
  readonly status: number;
  readonly locationId: string;
  readonly endpoint: string;
  readonly body: string;

  constructor(params: {
    status: number;
    locationId: string;
    endpoint: string;
    body: string;
  }) {
    super(
      `GHL ${params.endpoint} failed for location ${params.locationId} with status ${params.status}.`,
    );
    this.name = 'GhlApiError';
    this.status = params.status;
    this.locationId = params.locationId;
    this.endpoint = params.endpoint;
    this.body = params.body;
  }
}

// -----------------------------------------------------------------------------
// Token lifecycle
// -----------------------------------------------------------------------------

interface GhlOAuthResponse {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  token_type?: string;
  locationId?: string;
  userType?: string;
}

function isOAuthResponse(value: unknown): value is GhlOAuthResponse {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate['access_token'] === 'string' &&
    typeof candidate['refresh_token'] === 'string' &&
    typeof candidate['expires_in'] === 'number'
  );
}

/**
 * Exchanges a refresh token for a new access token and persists the result.
 * GHL rotates refresh tokens, so the new one must be stored too.
 */
async function refreshAccessToken(current: GhlTokenSet): Promise<GhlTokenSet> {
  const response = await fetch(`${ghlBaseUrl()}/oauth/token`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json',
    },
    body: new URLSearchParams({
      client_id: requireServerEnv('GHL_CLIENT_ID'),
      client_secret: requireServerEnv('GHL_CLIENT_SECRET'),
      grant_type: 'refresh_token',
      refresh_token: current.refreshToken,
      user_type: current.tokenType === 'company' ? 'Company' : 'Location',
    }),
    cache: 'no-store',
  });

  if (!response.ok) {
    throw new GhlTokenError(
      current.locationId,
      `Refreshing the GHL token failed with status ${response.status}. The school may need to reconnect.`,
    );
  }

  const payload: unknown = await response.json();
  if (!isOAuthResponse(payload)) {
    throw new GhlTokenError(
      current.locationId,
      'GHL returned an unrecognised token payload.',
    );
  }

  const refreshed: GhlTokenSet = {
    locationId: current.locationId,
    accessToken: payload.access_token,
    refreshToken: payload.refresh_token,
    expiresAt: new Date(Date.now() + payload.expires_in * 1000),
    tokenType: current.tokenType,
  };

  await writeGhlTokens(refreshed);
  return refreshed;
}

/**
 * Returns a token that is valid right now for `locationId`, refreshing it
 * first if it is within the expiry margin.
 */
export async function getValidAccessToken(locationId: string): Promise<string> {
  const stored = await readGhlTokens(locationId);

  if (stored === null) {
    throw new GhlTokenError(
      locationId,
      'This school has not connected its GoHighLevel account yet.',
    );
  }

  const expiresInMs = stored.expiresAt.getTime() - Date.now();
  if (expiresInMs > TOKEN_REFRESH_MARGIN_MS) {
    return stored.accessToken;
  }

  const refreshed = await refreshAccessToken(stored);
  return refreshed.accessToken;
}

// -----------------------------------------------------------------------------
// Request execution
// -----------------------------------------------------------------------------

export interface GhlFetchOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  /** Serialised as JSON. Omit for GET/DELETE. */
  body?: unknown;
  /** Appended to the URL; undefined values are dropped. */
  query?: Record<string, string | number | boolean | undefined>;
  headers?: Record<string, string>;
  /** Overrides the default retry budget for this call. */
  maxRetries?: number;
  signal?: AbortSignal;
}

function buildUrl(
  endpoint: string,
  query: GhlFetchOptions['query'],
): string {
  const path = endpoint.startsWith('/') ? endpoint : `/${endpoint}`;
  const url = new URL(`${ghlBaseUrl()}${path}`);

  if (query !== undefined) {
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined) url.searchParams.set(key, String(value));
    }
  }

  return url.toString();
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

/**
 * Backoff for attempt N (0-indexed), honouring `Retry-After` when GHL sends it.
 * Full jitter keeps a fleet of serverless functions from retrying in lockstep.
 */
function backoffDelayMs(attempt: number, retryAfterHeader: string | null): number {
  if (retryAfterHeader !== null) {
    const seconds = Number.parseInt(retryAfterHeader, 10);
    if (Number.isFinite(seconds) && seconds >= 0) {
      return Math.min(seconds * 1000, MAX_BACKOFF_MS);
    }
  }

  const exponential = Math.min(BASE_BACKOFF_MS * 2 ** attempt, MAX_BACKOFF_MS);
  return Math.round(exponential * (0.5 + Math.random() * 0.5));
}

function isRetryableStatus(status: number): boolean {
  // 429 = rate limited; 5xx = transient upstream failure.
  return status === 429 || status === 408 || (status >= 500 && status <= 599);
}

/**
 * Calls the GHL API on behalf of one school.
 *
 * @param endpoint  Path only, e.g. `/contacts/` — the base URL is added.
 * @param locationId  ALWAYS required. Must come from verified claims.
 * @returns The parsed JSON body, typed as `T`. `T` is a caller assertion:
 *   validate the shape if the value crosses a trust boundary.
 */
export async function ghlFetch<T>(
  endpoint: string,
  locationId: string,
  options: GhlFetchOptions = {},
): Promise<T> {
  if (locationId.trim() === '') {
    throw new GhlTokenError(locationId, 'ghlFetch requires a non-empty locationId.');
  }

  const {
    method = 'GET',
    body,
    query,
    headers = {},
    maxRetries = MAX_RETRIES,
    signal,
  } = options;

  const url = buildUrl(endpoint, query);
  let accessToken = await getValidAccessToken(locationId);
  let lastError: GhlApiError | null = null;

  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
    const response = await fetch(url, {
      method,
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Version: serverEnv('GHL_API_VERSION', DEFAULT_API_VERSION),
        Accept: 'application/json',
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
        ...headers,
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      ...(signal === undefined ? {} : { signal }),
      cache: 'no-store',
    });

    if (response.ok) {
      if (response.status === 204) return undefined as T;

      const text = await response.text();
      if (text.trim() === '') return undefined as T;
      return JSON.parse(text) as T;
    }

    // A 401 usually means the token was revoked or rotated behind our back.
    // Force one refresh and retry before giving up.
    if (response.status === 401 && attempt === 0) {
      const stored = await readGhlTokens(locationId);
      if (stored !== null) {
        const refreshed = await refreshAccessToken(stored);
        accessToken = refreshed.accessToken;
        continue;
      }
    }

    const errorBody = await response.text();
    lastError = new GhlApiError({
      status: response.status,
      locationId,
      endpoint,
      body: errorBody.slice(0, 2000),
    });

    if (!isRetryableStatus(response.status) || attempt === maxRetries) {
      throw lastError;
    }

    await sleep(backoffDelayMs(attempt, response.headers.get('retry-after')));
  }

  // Unreachable: the loop either returns or throws.
  throw lastError ?? new GhlApiError({ status: 500, locationId, endpoint, body: '' });
}

// -----------------------------------------------------------------------------
// Thin typed helpers over the endpoints Sprint 1 needs
// -----------------------------------------------------------------------------

export interface GhlLocation {
  id: string;
  name: string;
  email?: string;
  phone?: string;
  address?: string;
  city?: string;
  country?: string;
  website?: string;
}

export interface GhlContact {
  id: string;
  locationId: string;
  firstName?: string;
  lastName?: string;
  email?: string;
  phone?: string;
  tags?: string[];
  dateAdded?: string;
}

/** Fetches the GHL sub-account (location) record for a school. */
export async function getGhlLocation(locationId: string): Promise<GhlLocation> {
  const result = await ghlFetch<{ location: GhlLocation }>(
    `/locations/${locationId}`,
    locationId,
  );
  return result.location;
}

/** Lists contacts in a school's sub-account. */
export async function listGhlContacts(
  locationId: string,
  params: { limit?: number; startAfterId?: string } = {},
): Promise<GhlContact[]> {
  const result = await ghlFetch<{ contacts: GhlContact[] }>('/contacts/', locationId, {
    query: {
      locationId,
      limit: params.limit ?? 100,
      startAfterId: params.startAfterId,
    },
  });
  return result.contacts;
}

/**
 * Completes the OAuth authorization-code exchange after a school installs the
 * app. Persists the encrypted token set keyed by their Location ID.
 */
export async function exchangeGhlAuthorizationCode(code: string): Promise<GhlTokenSet> {
  const response = await fetch(`${ghlBaseUrl()}/oauth/token`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json',
    },
    body: new URLSearchParams({
      client_id: requireServerEnv('GHL_CLIENT_ID'),
      client_secret: requireServerEnv('GHL_CLIENT_SECRET'),
      grant_type: 'authorization_code',
      code,
      redirect_uri: requireServerEnv('GHL_REDIRECT_URI'),
      user_type: 'Location',
    }),
    cache: 'no-store',
  });

  const payload: unknown = await response.json();

  if (!response.ok || !isOAuthResponse(payload)) {
    throw new GhlTokenError('', 'GHL rejected the authorization code exchange.');
  }

  if (payload.locationId === undefined || payload.locationId === '') {
    throw new GhlTokenError(
      '',
      'GHL did not return a Location ID. Only Location-level installs are supported.',
    );
  }

  const tokens: GhlTokenSet = {
    locationId: payload.locationId,
    accessToken: payload.access_token,
    refreshToken: payload.refresh_token,
    expiresAt: new Date(Date.now() + payload.expires_in * 1000),
    tokenType: 'location',
  };

  await writeGhlTokens(tokens);
  return tokens;
}

// -----------------------------------------------------------------------------
// Agency-key contact and WhatsApp messaging (Sprint 3)
// -----------------------------------------------------------------------------

/**
 * The helpers above authenticate per school with that school's stored OAuth
 * token. Invitations cannot: a school being invited to may not have completed
 * the GHL OAuth install yet, and the invite still has to go out.
 *
 * So these use the agency-level API key instead, which is authorised across
 * every sub-account. `locationId` remains an explicit argument on every call —
 * the key is broad, the calls are not.
 */

/**
 * Guard for agency-key calls.
 *
 * The agency key is authorised across every sub-account, so a wrong or stale
 * `locationId` would happily reach another school's CRM. Every agency call
 * therefore proves first that the id belongs to a school that exists and is
 * active in our own database.
 *
 * Results are cached briefly: these calls arrive in bursts (find contact, then
 * send message) and the check is a guard, not a source of truth.
 */
const _validatedSchoolCache = new Map<string, number>();
const CACHE_TTL_MS = 30_000;

async function validateSchool(db: Database, locationId: string): Promise<void> {
  const cachedAt = _validatedSchoolCache.get(locationId);
  if (cachedAt !== undefined && Date.now() - cachedAt < CACHE_TTL_MS) return;

  const rows = await db
    .select({ id: schools.id })
    .from(schools)
    .where(and(eq(schools.locationId, locationId), eq(schools.isActive, true)))
    .limit(1);

  if (rows[0] === undefined) {
    throw new GhlAgencyError(
      403,
      `GHL agency call blocked: school not found or inactive for locationId ${locationId}`,
    );
  }

  _validatedSchoolCache.set(locationId, Date.now());
}

export class GhlAgencyError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = 'GhlAgencyError';
    this.status = status;
  }
}

function agencyHeaders(): Record<string, string> {
  return {
    Authorization: `Bearer ${requireServerEnv('GHL_AGENCY_API_KEY')}`,
    Version: serverEnv('GHL_API_VERSION', DEFAULT_API_VERSION),
    Accept: 'application/json',
    'Content-Type': 'application/json',
  };
}

async function agencyFetch<T>(
  path: string,
  init: { method: 'GET' | 'POST'; body?: unknown; query?: Record<string, string> },
): Promise<T> {
  const url = new URL(`${ghlBaseUrl()}${path.startsWith('/') ? path : `/${path}`}`);
  if (init.query !== undefined) {
    for (const [key, value] of Object.entries(init.query)) {
      url.searchParams.set(key, value);
    }
  }

  const response = await fetch(url.toString(), {
    method: init.method,
    headers: agencyHeaders(),
    ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
    cache: 'no-store',
  });

  const text = await response.text();

  if (!response.ok) {
    throw new GhlAgencyError(
      response.status,
      `GHL ${init.method} ${path} failed with ${response.status}: ${text.slice(0, 300)}`,
    );
  }

  return (text.trim() === '' ? undefined : JSON.parse(text)) as T;
}

export interface GhlContactRef {
  contactId: string;
}

interface ContactSearchResponse {
  contacts?: Array<{ id?: string }>;
}

interface ContactUpsertResponse {
  contact?: { id?: string };
  id?: string;
}

/**
 * Finds a contact by phone within one sub-account, creating it if absent.
 *
 * Lookup comes first so repeated invitations to the same number reuse the
 * existing contact rather than fragmenting the school's CRM.
 */
export async function findOrCreateContact(
  db: Database,
  locationId: string,
  contact: { phone: string; name: string; email?: string | undefined },
): Promise<GhlContactRef> {
  await validateSchool(db, locationId);

  const found = await agencyFetch<ContactSearchResponse>('/contacts/', {
    method: 'GET',
    query: { locationId, query: contact.phone },
  });

  const existingId = found.contacts?.[0]?.id;
  if (typeof existingId === 'string' && existingId !== '') {
    return { contactId: existingId };
  }

  const [firstName, ...rest] = contact.name.trim().split(/\s+/);

  const created = await agencyFetch<ContactUpsertResponse>('/contacts/', {
    method: 'POST',
    body: {
      locationId,
      phone: contact.phone,
      firstName: firstName ?? contact.name,
      lastName: rest.join(' '),
      ...(contact.email === undefined ? {} : { email: contact.email }),
    },
  });

  const contactId = created.contact?.id ?? created.id;
  if (typeof contactId !== 'string' || contactId === '') {
    throw new GhlAgencyError(502, 'GHL did not return a contact id.');
  }

  return { contactId };
}

/**
 * Finds a contact by email within one sub-account, creating it if absent.
 *
 * The email counterpart of `findOrCreateContact`, and it exists for the same
 * reason: GHL attaches every message to a conversation, and a conversation
 * belongs to a contact. There is no way to post a message to a bare address.
 *
 * Lookup comes first so repeated mail to the same person reuses their contact
 * rather than fragmenting the school's CRM.
 */
export async function findOrCreateContactByEmail(
  db: Database,
  locationId: string,
  contact: { email: string; firstName?: string | undefined; lastName?: string | undefined },
): Promise<GhlContactRef> {
  await validateSchool(db, locationId);

  // Location-scoped OAuth throughout: the contact is created inside the
  // school's own sub-account by the school's own token, so the conversation
  // the message later joins belongs to that school and nothing about this
  // call passes through an agency-level credential.
  const found = await ghlFetch<ContactSearchResponse>('/contacts/', locationId, {
    method: 'GET',
    query: { locationId, query: contact.email },
  });

  const existingId = found.contacts?.[0]?.id;
  if (typeof existingId === 'string' && existingId !== '') {
    return { contactId: existingId };
  }

  // Falls back to the local part of the address, so a contact created for a
  // password reset is not a nameless row in the school's CRM.
  const firstName =
    (contact.firstName ?? '').trim() || (contact.email.split('@')[0] ?? contact.email);

  const created = await ghlFetch<ContactUpsertResponse>('/contacts/', locationId, {
    method: 'POST',
    body: {
      locationId,
      email: contact.email,
      firstName,
      lastName: (contact.lastName ?? '').trim(),
    },
  });

  const contactId = created.contact?.id ?? created.id;
  if (typeof contactId !== 'string' || contactId === '') {
    throw new GhlApiError({
      status: 502,
      locationId,
      endpoint: '/contacts/',
      body: 'GHL did not return a contact id.',
    });
  }

  return { contactId };
}

export interface GhlMessageRef {
  messageId: string;
}

interface SendMessageResponse {
  messageId?: string;
  /** Returned instead of `messageId` on email sends. */
  emailMessageId?: string;
  msg?: { id?: string };
  conversationId?: string;
}

/**
 * Sends a WhatsApp message to a contact.
 *
 * GHL creates or reuses the conversation itself when a message is posted with
 * `type: 'WhatsApp'`, so there is no separate conversation call.
 */
export async function sendWhatsAppMessage(
  db: Database,
  locationId: string,
  contactId: string,
  messageText: string,
): Promise<GhlMessageRef> {
  await validateSchool(db, locationId);

  const sent = await agencyFetch<SendMessageResponse>('/conversations/messages', {
    method: 'POST',
    body: {
      type: 'WhatsApp',
      contactId,
      locationId,
      message: messageText,
    },
  });

  const messageId = sent.messageId ?? sent.msg?.id ?? sent.conversationId;
  if (typeof messageId !== 'string' || messageId === '') {
    throw new GhlAgencyError(502, 'GHL did not return a message id.');
  }

  return { messageId };
}

export interface GhlEmailPayload {
  /** Required. GHL has no "send to an address" endpoint. */
  contactId: string;
  subject: string;
  html: string;
  /**
   * text/plain alternative, for clients that block HTML.
   *
   * Sent as `message`, which is the field name the Conversations API uses for
   * the body text of any message type.
   */
  text: string;
}

/**
 * Sends an email to a contact from one school's own GHL sub-account.
 *
 * ── On the sender ────────────────────────────────────────────────────────
 * Nothing here names a sender. GHL resolves the from-address, the display name
 * and the sending domain from the LC Email configuration of the sub-account
 * whose OAuth token authorised the call, so School A sends from
 * mail.schoola.com and School B from mail.schoolb.com with no per-school code.
 *
 * An earlier revision passed `emailFromName`. GHL confirmed that is not a
 * field on this endpoint, and overriding the sender from the payload would
 * defeat the white-label configuration in any case.
 *
 * ── On the transport ─────────────────────────────────────────────────────
 * Location-scoped OAuth only. There is deliberately no agency-key fallback:
 * an agency-authorised send is a shared sender, which is the one thing the
 * white-label model must never do. A school that has not connected its GHL
 * sub-account therefore cannot send authentication email at all, and fails
 * loudly rather than quietly sending as somebody else.
 */
export async function sendGhlEmail(
  db: Database,
  locationId: string,
  payload: GhlEmailPayload,
): Promise<GhlMessageRef> {
  await validateSchool(db, locationId);

  const sent = await ghlFetch<SendMessageResponse>(
    '/conversations/messages',
    locationId,
    {
      method: 'POST',
      body: {
        type: 'Email',
        contactId: payload.contactId,
        subject: payload.subject,
        html: payload.html,
        message: payload.text,
      },
    },
  );

  const messageId = sent.messageId ?? sent.emailMessageId ?? sent.msg?.id ?? sent.conversationId;
  if (typeof messageId !== 'string' || messageId === '') {
    throw new GhlApiError({
      status: 502,
      locationId,
      endpoint: '/conversations/messages',
      body: 'GHL did not return a message id.',
    });
  }

  return { messageId };
}
