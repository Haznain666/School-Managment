/**
 * Firebase custom claims — the authoritative carrier of tenant identity.
 *
 * These are minted server-side (Firebase Admin SDK) and travel inside every ID
 * token. `location_id` here is the GHL Location ID and is the ONLY trusted
 * source of the caller's tenant. It is never taken from a URL, body or query
 * parameter (CRITICAL RULE #4).
 */

export const USER_CLAIM_ROLES = [
  'super_admin',
  'school_admin',
  'principal',
  'vice_principal',
  'coordinator',
  'teacher',
  'hr_manager',
  'accountant',
  'marketing',
  'student',
  'parent',
] as const;

export type UserClaimRole = (typeof USER_CLAIM_ROLES)[number];

export interface UserClaims {
  /** GHL Location ID = school identifier. */
  location_id: string;
  role: UserClaimRole;
  /** null = access to all branches of the school. */
  branch_id: string | null;
  /** True when the user holds more than one role and must pick one at login. */
  is_dual_role: boolean;
}

/** Roles that may administer the platform itself, across all tenants. */
export const PLATFORM_ROLES: readonly UserClaimRole[] = ['super_admin'];

/** Roles that carry full administrative rights inside a single school. */
export const SCHOOL_ADMIN_ROLES: readonly UserClaimRole[] = [
  'school_admin',
  'principal',
  'vice_principal',
];

export function isUserClaimRole(value: unknown): value is UserClaimRole {
  return (
    typeof value === 'string' &&
    (USER_CLAIM_ROLES as readonly string[]).includes(value)
  );
}

/**
 * Narrows an arbitrary decoded-token payload to `UserClaims`.
 * Returns null when any required claim is missing or malformed, which callers
 * must treat as "not authorised" rather than "no tenant".
 */
export function parseUserClaims(payload: Record<string, unknown>): UserClaims | null {
  const locationId = payload['location_id'];
  const role = payload['role'];
  const branchId = payload['branch_id'];
  const isDualRole = payload['is_dual_role'];

  if (typeof locationId !== 'string' || locationId.trim() === '') return null;
  if (!isUserClaimRole(role)) return null;

  const normalisedBranchId =
    typeof branchId === 'string' && branchId.trim() !== '' ? branchId : null;

  return {
    location_id: locationId,
    role,
    branch_id: normalisedBranchId,
    is_dual_role: isDualRole === true,
  };
}

/**
 * Landing route for a role once authentication succeeds.
 * `locationId` is the caller's own tenant, taken from their claims.
 */
export function portalPathForRole(role: UserClaimRole, locationId: string): string {
  if (role === 'super_admin') return '/super-admin';
  return `/${locationId}/dashboard`;
}
