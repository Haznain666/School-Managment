import { NextResponse } from 'next/server';

import { GhlApiError } from './ghl-client';
import { GhlTokenError } from './ghl-tokens';
import { MissingEnvError } from './env';
import { StorageConfigError } from './storage';
import { SuperAdminAuthError } from './super-admin-guard';

/**
 * Uniform JSON envelopes for API routes, plus one error translator so that
 * every route reports failures the same way and never leaks a stack trace or
 * a connection string to the client.
 */

export interface ApiSuccess<T> {
  ok: true;
  data: T;
}

export interface ApiFailure {
  ok: false;
  error: {
    code: string;
    message: string;
  };
}

export function apiSuccess<T>(data: T, status = 200): NextResponse<ApiSuccess<T>> {
  return NextResponse.json({ ok: true, data }, { status });
}

export function apiFailure(
  code: string,
  message: string,
  status: number,
): NextResponse<ApiFailure> {
  return NextResponse.json({ ok: false, error: { code, message } }, { status });
}

/**
 * Converts a thrown value into a safe response.
 * Anything unrecognised becomes a generic 500 — the detail goes to the server
 * log, not to the caller.
 */
export function handleApiError(error: unknown): NextResponse<ApiFailure> {
  if (error instanceof SuperAdminAuthError) {
    return apiFailure('unauthenticated', error.message, error.status);
  }

  if (error instanceof GhlTokenError) {
    return apiFailure('ghl_not_connected', error.message, 424);
  }

  if (error instanceof GhlApiError) {
    // Pass rate limiting through so clients can back off; collapse the rest.
    const status = error.status === 429 ? 429 : 502;
    return apiFailure('ghl_request_failed', 'The GoHighLevel request failed.', status);
  }

  // The message is deliberately passed through rather than collapsed into
  // "something went wrong": it names the buckets that were tried and the
  // console page that fixes it, and the person who sees it is a school
  // administrator who cannot upload a logo. Nothing in it is a secret — a
  // bucket name appears in every download URL this app already serves.
  if (error instanceof StorageConfigError) {
    console.error('[api] storage misconfigured:', error.message);
    return apiFailure('storage_not_configured', error.message, 503);
  }

  if (error instanceof MissingEnvError) {
    console.error('[api] configuration error:', error.message);
    return apiFailure(
      'server_misconfigured',
      'The server is not fully configured. Contact your administrator.',
      500,
    );
  }

  console.error('[api] unhandled error:', error);
  return apiFailure('internal_error', 'Something went wrong.', 500);
}

/** Parses a JSON request body, returning null when it is absent or malformed. */
export async function readJsonBody<T>(request: Request): Promise<T | null> {
  try {
    return (await request.json()) as T;
  } catch {
    return null;
  }
}
