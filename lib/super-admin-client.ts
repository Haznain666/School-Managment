'use client';

/**
 * Browser -> Super Admin API helper.
 *
 * Authentication is the httpOnly session cookie, which the browser attaches
 * automatically — there is no token to pass, and deliberately no way for
 * client code to read it.
 */

export class SuperAdminApiError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = 'SuperAdminApiError';
    this.status = status;
    this.code = code;
  }
}

interface ApiEnvelope<T> {
  ok: boolean;
  data?: T;
  error?: { code: string; message: string };
}

async function parse<T>(response: Response): Promise<T> {
  // A 401 means the 8-hour session lapsed. Bounce to login rather than
  // surfacing a confusing error inside the panel.
  if (response.status === 401 && typeof window !== 'undefined') {
    window.location.href = '/super-admin/login';
    throw new SuperAdminApiError(401, 'unauthenticated', 'Session expired.');
  }

  let payload: ApiEnvelope<T>;
  try {
    payload = (await response.json()) as ApiEnvelope<T>;
  } catch {
    throw new SuperAdminApiError(response.status, 'invalid_response', 'Unexpected response.');
  }

  if (!response.ok || payload.ok !== true || payload.data === undefined) {
    throw new SuperAdminApiError(
      response.status,
      payload.error?.code ?? 'internal_error',
      payload.error?.message ?? 'The request failed.',
    );
  }

  return payload.data;
}

export async function superAdminFetch<T>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const response = await fetch(path, {
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

/** Multipart variant — the browser sets its own boundary header. */
export async function superAdminUpload<T>(path: string, form: FormData): Promise<T> {
  const response = await fetch(path, { method: 'POST', body: form });
  return parse<T>(response);
}
