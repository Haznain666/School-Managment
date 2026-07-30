import 'server-only';

import { cookies } from 'next/headers';

import {
  SUPER_ADMIN_COOKIE,
  verifySuperAdminJWT,
  type SuperAdminSession,
} from './super-admin-auth';

/**
 * Server-side Super Admin session helpers.
 *
 * `middleware.ts` already redirects unauthenticated traffic away from
 * `/super-admin/*`, so these are the second line: they make the session
 * available to server components and make API routes fail closed even if the
 * matcher is ever changed.
 */

export class SuperAdminAuthError extends Error {
  readonly status = 401;

  constructor(message = 'Super Admin session required.') {
    super(message);
    this.name = 'SuperAdminAuthError';
  }
}

/** Reads the session from the request cookies. Null when not signed in. */
export async function readSuperAdminSession(): Promise<SuperAdminSession | null> {
  const store = await cookies();
  const token = store.get(SUPER_ADMIN_COOKIE)?.value;
  if (token === undefined || token === '') return null;
  return verifySuperAdminJWT(token);
}

/**
 * Same, but throws when absent — the form every `/api/super-admin/*` route
 * uses so that a missing session can never be mistaken for an empty result.
 */
export async function requireSuperAdmin(): Promise<SuperAdminSession> {
  const session = await readSuperAdminSession();
  if (session === null) throw new SuperAdminAuthError();
  return session;
}
