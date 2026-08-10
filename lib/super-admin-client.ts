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

/**
 * Endpoints where a 401 is an *answer*, not a lapsed session.
 *
 * The sign-in route returns 401 for wrong credentials. Routing that through
 * the session-expiry branch below replaced "Incorrect email or password" with
 * "Session expired." and reloaded the login page the operator was already on —
 * so a mistyped password, a wrong `SUPER_ADMIN_EMAIL` and a hash mangled by the
 * host all presented as the one error that none of them are. Diagnosing a live
 * deployment through that took two rounds; hence this list.
 */
function isAuthEndpoint(path: string): boolean {
  return path.startsWith('/api/super-admin/auth/');
}

async function parse<T>(response: Response, path: string): Promise<T> {
  // A 401 means the 8-hour session lapsed. Bounce to login rather than
  // surfacing a confusing error inside the panel. Not for the auth routes,
  // where 401 carries a real message the caller must be allowed to read.
  if (
    response.status === 401 &&
    !isAuthEndpoint(path) &&
    typeof window !== 'undefined'
  ) {
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

  return parse<T>(response, path);
}

/** Multipart variant — the browser sets its own boundary header. */
export async function superAdminUpload<T>(path: string, form: FormData): Promise<T> {
  const response = await fetch(path, { method: 'POST', body: form });
  return parse<T>(response, path);
}
