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

/**
 * The message shown when a response is not the JSON envelope at all.
 *
 * ── Why it is not just "Unexpected response." ────────────────────────────
 * That is what it used to say, and it is what an operator was left holding on
 * the Super Admin sign-in screen with no other way into the platform. It named
 * nothing: not the status, not whether the request had even reached the
 * application. A 502 from the host while the Node process restarts, a 504 on a
 * slow first request and a genuine crash all presented identically, and the
 * only difference that matters — "wait and try again" versus "something is
 * broken" — was the one it hid.
 *
 * Every route in this application answers with `{ ok, data | error }`. So
 * anything that does not parse as JSON did not come from a route, and the
 * status code is the whole of what is known about it. Saying so, and saying
 * which of the two it probably is, is the difference between an operator
 * retrying and an operator filing a bug against the login form.
 */
function unparseableResponseMessage(status: number): string {
  if (status === 0) {
    return 'The server could not be reached. Check your connection and try again.';
  }

  // 502/503/504 are the reverse proxy answering for an application that is not
  // there — restarting, deploying, or briefly overloaded. Retrying genuinely
  // does work, so say so rather than implying a defect.
  if (status === 502 || status === 503 || status === 504) {
    return `The server is not responding (${status}). It may be restarting — try again in a moment.`;
  }

  return `The server returned an unexpected response (${status}). Nothing was changed.`;
}

async function parse<T>(response: Response): Promise<T> {
  let payload: ApiEnvelope<T>;
  try {
    payload = (await response.json()) as ApiEnvelope<T>;
  } catch {
    throw new SchoolApiError(
      response.status,
      'invalid_response',
      unparseableResponseMessage(response.status),
    );
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
