'use client';

import { getIdToken } from 'firebase/auth';

import { getFirebaseAuth } from './firebase';

/**
 * Browser -> API helper.
 *
 * Attaches the current Firebase ID token as a Bearer credential so the server
 * can run `withAuth()`. The tenant is NOT sent from here — it comes from the
 * token's claims and from the subdomain the browser is already on.
 */

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
  }
}

interface ApiEnvelope<T> {
  ok: boolean;
  data?: T;
  error?: { code: string; message: string };
}

export async function apiFetch<T>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const user = getFirebaseAuth().currentUser;
  if (user === null) {
    throw new ApiError(401, 'missing_token', 'You are not signed in.');
  }

  const token = await getIdToken(user);

  const response = await fetch(path, {
    ...options,
    headers: {
      ...(options.headers ?? {}),
      Authorization: `Bearer ${token}`,
      ...(options.body === undefined ? {} : { 'Content-Type': 'application/json' }),
    },
  });

  const payload = (await response.json()) as ApiEnvelope<T>;

  if (!response.ok || payload.ok !== true || payload.data === undefined) {
    throw new ApiError(
      response.status,
      payload.error?.code ?? 'internal_error',
      payload.error?.message ?? 'The request failed.',
    );
  }

  return payload.data;
}
