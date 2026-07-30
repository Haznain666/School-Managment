import 'server-only';

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
