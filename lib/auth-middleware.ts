import 'server-only';

import { parseUserClaims, type UserClaimRole, type UserClaims } from './claims';
import { verifyIdToken } from './firebase-admin';

/**
 * withAuth — the gate every API route must pass through (CRITICAL RULE #2).
 *
 * It answers one question: *who is calling, and which tenant are they?*
 * The answer comes from verified Firebase custom claims and nowhere else.
 *
 * The important part is the cross-check: `middleware.ts` resolves the request's
 * subdomain to a location_id and stamps it on `x-location-id`. The JWT carries
 * its own location_id. If a user of School A points their token at School B's
 * subdomain the two disagree, and the request is rejected. That is the
 * tenant-spoofing defence.
 */

/** Header written by `middleware.ts` after resolving the subdomain. */
export const LOCATION_HEADER = 'x-location-id';
export const SUBDOMAIN_HEADER = 'x-subdomain';
export const SCHOOL_NAME_HEADER = 'x-school-name';

export type AuthErrorCode =
  | 'missing_token'
  | 'invalid_token'
  | 'expired_token'
  | 'missing_claims'
  | 'tenant_mismatch'
  | 'forbidden_role';

const STATUS_BY_CODE: Record<AuthErrorCode, number> = {
  missing_token: 401,
  invalid_token: 401,
  expired_token: 401,
  missing_claims: 403,
  tenant_mismatch: 403,
  forbidden_role: 403,
};

export class AuthError extends Error {
  readonly code: AuthErrorCode;
  readonly status: number;

  constructor(code: AuthErrorCode, message: string) {
    super(message);
    this.name = 'AuthError';
    this.code = code;
    this.status = STATUS_BY_CODE[code];
  }
}

/** The verified identity of the caller. */
export interface AuthContext {
  uid: string;
  /** GHL Location ID — the tenant key for every downstream query. */
  locationId: string;
  role: UserClaimRole;
  /** null = access to every branch of the school. */
  branchId: string | null;
  isDualRole: boolean;
}

function extractBearerToken(request: Request): string {
  const header = request.headers.get('authorization');
  if (header === null || header.trim() === '') {
    throw new AuthError('missing_token', 'Authorization header is missing.');
  }

  const [scheme, ...rest] = header.trim().split(/\s+/);
  const token = rest.join('');

  if (scheme?.toLowerCase() !== 'bearer' || token === '') {
    throw new AuthError(
      'missing_token',
      'Authorization header must be of the form "Bearer <idToken>".',
    );
  }

  return token;
}

function isExpiredTokenError(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;
  const code = (error as { code?: unknown }).code;
  return (
    code === 'auth/id-token-expired' || code === 'auth/session-cookie-expired'
  );
}

/**
 * Verifies the caller and resolves their tenant.
 *
 * @throws {AuthError} on a missing/invalid token, absent claims, or a
 *   mismatch between the JWT tenant and the subdomain-resolved tenant.
 */
export async function withAuth(request: Request): Promise<AuthContext> {
  const idToken = extractBearerToken(request);

  let claims: UserClaims | null;
  let uid: string;

  try {
    const decoded = await verifyIdToken(idToken);
    uid = decoded.uid;
    claims = parseUserClaims(decoded as unknown as Record<string, unknown>);
  } catch (error) {
    if (isExpiredTokenError(error)) {
      throw new AuthError('expired_token', 'ID token has expired. Refresh and retry.');
    }
    throw new AuthError('invalid_token', 'ID token could not be verified.');
  }

  if (claims === null) {
    throw new AuthError(
      'missing_claims',
      'Account has no tenant claims. It must be provisioned before use.',
    );
  }

  // --- Tenant cross-check -------------------------------------------------
  // super_admin operates across tenants, so it is exempt from the header match
  // (it still gets its own location_id from claims, never from the request).
  const headerLocationId = request.headers.get(LOCATION_HEADER);

  if (claims.role !== 'super_admin') {
    if (headerLocationId === null || headerLocationId.trim() === '') {
      throw new AuthError(
        'tenant_mismatch',
        'Request did not resolve to a school. Access the portal via your school subdomain.',
      );
    }

    if (headerLocationId !== claims.location_id) {
      throw new AuthError(
        'tenant_mismatch',
        'Token tenant does not match the requested school.',
      );
    }
  }

  return {
    uid,
    locationId: claims.location_id,
    role: claims.role,
    branchId: claims.branch_id,
    isDualRole: claims.is_dual_role,
  };
}

/**
 * `withAuth` plus a role check. Use for routes that only certain roles may
 * reach, e.g. `requireRole(request, ['school_admin', 'principal'])`.
 */
export async function requireRole(
  request: Request,
  allowed: readonly UserClaimRole[],
): Promise<AuthContext> {
  const auth = await withAuth(request);

  // super_admin is intentionally allowed everywhere.
  if (auth.role !== 'super_admin' && !allowed.includes(auth.role)) {
    throw new AuthError(
      'forbidden_role',
      `Role "${auth.role}" may not perform this action.`,
    );
  }

  return auth;
}

/**
 * Branch-level guard. A user whose `branchId` is null may act on any branch of
 * their school; otherwise the target branch must be exactly theirs.
 */
export function assertBranchAccess(auth: AuthContext, targetBranchId: string): void {
  if (auth.branchId === null) return;
  if (auth.branchId === targetBranchId) return;
  throw new AuthError('forbidden_role', 'You do not have access to this branch.');
}
