'use client';

/**
 * Browser -> school API helper.
 *
 * Authentication is the httpOnly session cookie, which the browser attaches by
 * itself — there is no token for client code to hold, and deliberately no way
 * for it to read one.
 *
 * The dev `?school=` parameter is carried through on every call, because
 * middleware resolves the tenant from it when there is no real subdomain. In
 * production the hostname does that job and the parameter is absent.
 */

export class SchoolApiError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = 'SchoolApiError';
    this.status = status;
    this.code = code;
  }
}

interface ApiEnvelope<T> {
  ok: boolean;
  data?: T;
  error?: { code: string; message: string };
}

/** Appends the current page's `?school=` to an API path, when present. */
export function withSchoolParam(path: string): string {
  if (typeof window === 'undefined') return path;

  const school = new URLSearchParams(window.location.search).get('school');
  if (school === null || school === '') return path;

  const url = new URL(path, window.location.origin);
  url.searchParams.set('school', school);
  return `${url.pathname}${url.search}`;
}

async function parse<T>(response: Response): Promise<T> {
  let payload: ApiEnvelope<T>;
  try {
    payload = (await response.json()) as ApiEnvelope<T>;
  } catch {
    throw new SchoolApiError(response.status, 'invalid_response', 'Unexpected response.');
  }

  if (!response.ok || payload.ok !== true || payload.data === undefined) {
    throw new SchoolApiError(
      response.status,
      payload.error?.code ?? 'internal_error',
      payload.error?.message ?? 'The request failed.',
    );
  }

  return payload.data;
}

export async function schoolFetch<T>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const response = await fetch(withSchoolParam(path), {
    ...options,
    headers: {
      ...(options.headers ?? {}),
      ...(options.body === undefined || options.body instanceof FormData
        ? {}
        : { 'Content-Type': 'application/json' }),
    },
  });

  return parse<T>(response);
}

/** The message to show a user for a failed call, without leaking internals. */
export function schoolErrorMessage(error: unknown, fallback: string): string {
  return error instanceof SchoolApiError ? error.message : fallback;
}
