'use client';

import { withSchoolParam } from './school-client';

/**
 * Browser -> public auth API.
 *
 * Separate from `schoolFetch` because these calls run before there is a
 * session: there is no cookie to send, and a failure is a message to show the
 * person rather than an exception to bubble. So this returns a result object
 * instead of throwing — every caller has a form to put the message in, and
 * none of them wants a try/catch around the happy path.
 *
 * `withSchoolParam` carries the dev `?school=` through. Without it a relative
 * URL drops the page's query string, middleware resolves no tenant, and the
 * request comes back as the /school-not-found *page* — HTML, which then fails
 * to parse as JSON and reports itself as a connection problem.
 */

export type AuthResult<T> =
  | { ok: true; data: T }
  | { ok: false; code: string; message: string };

export async function postAuth<T>(
  path: string,
  body: Record<string, unknown>,
): Promise<AuthResult<T>> {
  try {
    const response = await fetch(withSchoolParam(path), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    const payload = (await response.json()) as {
      ok?: boolean;
      data?: T;
      error?: { code?: string; message?: string };
    };

    if (response.ok && payload.ok === true && payload.data !== undefined) {
      return { ok: true, data: payload.data };
    }

    return {
      ok: false,
      code: payload.error?.code ?? 'request_failed',
      message: payload.error?.message ?? 'Something went wrong. Please try again.',
    };
  } catch {
    return {
      ok: false,
      code: 'network_error',
      message: 'Could not reach the server. Check your connection and try again.',
    };
  }
}
