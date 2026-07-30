import { jwtVerify, SignJWT, type JWTPayload } from 'jose';

import { requireServerEnv } from './env';

/**
 * Super Admin authentication — deliberately separate from school auth.
 *
 * School users authenticate with Firebase and carry a tenant in their claims.
 * The Super Admin has no tenant: they operate across every school, so a
 * tenant-scoped credential would be the wrong shape. Instead there is a single
 * operator account, verified against a bcrypt hash in the environment, and the
 * session is a signed JWT in an httpOnly cookie.
 *
 * `jose` is used rather than `jsonwebtoken` because middleware runs on the Edge
 * runtime, where Node's crypto APIs are unavailable. bcrypt comparison happens
 * only in the login route, which runs on Node.
 */

export const SUPER_ADMIN_COOKIE = 'super_admin_session';

/** 8 hours, as an operator session rather than a long-lived login. */
export const SUPER_ADMIN_SESSION_SECONDS = 8 * 60 * 60;

const ISSUER = 'sms-platform';
const AUDIENCE = 'super-admin';

export interface SuperAdminSession {
  email: string;
  /** Issued-at, epoch seconds. */
  issuedAt: number;
}

function secretKey(): Uint8Array {
  return new TextEncoder().encode(requireServerEnv('SUPER_ADMIN_JWT_SECRET'));
}

/** Mints the session token stored in the httpOnly cookie. */
export async function signSuperAdminJWT(email: string): Promise<string> {
  const issuedAt = Math.floor(Date.now() / 1000);

  return new SignJWT({ email } satisfies JWTPayload)
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(email)
    .setIssuer(ISSUER)
    .setAudience(AUDIENCE)
    .setIssuedAt(issuedAt)
    .setExpirationTime(issuedAt + SUPER_ADMIN_SESSION_SECONDS)
    .sign(secretKey());
}

/**
 * Verifies a session token. Returns null for anything that is not a currently
 * valid Super Admin session — expired, tampered with, or issued for a
 * different audience.
 */
export async function verifySuperAdminJWT(
  token: string,
): Promise<SuperAdminSession | null> {
  try {
    const { payload } = await jwtVerify(token, secretKey(), {
      issuer: ISSUER,
      audience: AUDIENCE,
      algorithms: ['HS256'],
    });

    const email = payload['email'];
    if (typeof email !== 'string' || email === '') return null;

    return { email, issuedAt: payload.iat ?? 0 };
  } catch {
    // Malformed, expired, wrong signature — all mean "not signed in".
    return null;
  }
}

/** Reads the cookie off a request and verifies it. Edge-safe. */
export async function getSuperAdminSession(
  request: Request,
): Promise<SuperAdminSession | null> {
  const token = readCookie(request.headers.get('cookie'), SUPER_ADMIN_COOKIE);
  return token === null ? null : verifySuperAdminJWT(token);
}

/** Minimal cookie parser — avoids pulling a dependency into the Edge bundle. */
function readCookie(header: string | null, name: string): string | null {
  if (header === null) return null;

  for (const part of header.split(';')) {
    const separator = part.indexOf('=');
    if (separator === -1) continue;

    if (part.slice(0, separator).trim() === name) {
      return decodeURIComponent(part.slice(separator + 1).trim());
    }
  }

  return null;
}

/** Cookie attributes shared by the login and logout routes. */
export function sessionCookieOptions(maxAge: number) {
  return {
    name: SUPER_ADMIN_COOKIE,
    httpOnly: true,
    sameSite: 'lax' as const,
    // Secure everywhere except local http development.
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge,
  };
}
