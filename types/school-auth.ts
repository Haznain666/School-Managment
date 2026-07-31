/**
 * School-portal authentication types.
 *
 * One Firebase project serves every school; tenants are separated by the
 * `locationId` custom claim (the GHL Location ID), never by project. A claim
 * set is minted server-side when an invite is accepted and travels inside the
 * session cookie, so it is the only trustworthy source of tenant identity.
 */

export const USER_ROLES = [
  'school_admin',
  'branch_admin',
  'teacher',
  'student',
  'parent',
  'accountant',
  'hr_manager',
] as const;

export type UserRole = (typeof USER_ROLES)[number];

/** Claims carried by the session cookie. */
export interface SchoolSessionClaims {
  uid: string;
  /** GHL Location ID — the tenant key for every query. */
  locationId: string;
  role: UserRole;
  /** null = access to every branch of the school. */
  branchId: string | null;
  /** Subdomain the school is reached on, for building absolute links. */
  schoolSlug: string;
}

/** The claim fields written to Firebase, without the uid Firebase already owns. */
export type SchoolCustomClaims = Omit<SchoolSessionClaims, 'uid'>;

/** Where each role lands after signing in. */
export const ROLE_HOME_ROUTES: Record<UserRole, string> = {
  school_admin: '/dashboard',
  branch_admin: '/dashboard',
  accountant: '/dashboard',
  hr_manager: '/dashboard',
  teacher: '/teacher',
  student: '/student',
  parent: '/parent',
};

/** Human-readable role names for UI. */
export const ROLE_LABELS: Record<UserRole, string> = {
  school_admin: 'School Administrator',
  branch_admin: 'Branch Administrator',
  teacher: 'Teacher',
  student: 'Student',
  parent: 'Parent',
  accountant: 'Accountant',
  hr_manager: 'HR Manager',
};

/** Roles that share the administrative dashboard at /dashboard. */
export const ADMIN_PORTAL_ROLES: readonly UserRole[] = [
  'school_admin',
  'branch_admin',
  'accountant',
  'hr_manager',
];

/** Roles that may invite and manage other users. */
export const USER_MANAGEMENT_ROLES: readonly UserRole[] = ['school_admin', 'hr_manager'];

/** Roles that may read fee data — challans, reports and the price list. */
export const FEE_READ_ROLES: readonly UserRole[] = [
  'school_admin',
  'branch_admin',
  'accountant',
  'hr_manager',
];

/**
 * Roles that may change fee data: set prices, raise challans and take money.
 * Deliberately narrower than the read list — an HR manager has no business
 * marking a challan paid.
 */
export const FEE_WRITE_ROLES: readonly UserRole[] = ['school_admin', 'accountant'];

/** Roles for which a branch assignment is mandatory. */
export const BRANCH_REQUIRED_ROLES: readonly UserRole[] = [
  'branch_admin',
  'teacher',
  'student',
  'parent',
];

export function isUserRole(value: unknown): value is UserRole {
  return typeof value === 'string' && (USER_ROLES as readonly string[]).includes(value);
}

/**
 * Narrows a decoded token payload to `SchoolSessionClaims`.
 * Returns null when any claim is missing or malformed — callers must treat
 * that as "not authorised", never as "no tenant".
 */
export function parseSchoolClaims(
  payload: Record<string, unknown>,
): SchoolSessionClaims | null {
  const uid = payload['uid'] ?? payload['sub'];
  const locationId = payload['locationId'];
  const role = payload['role'];
  const branchId = payload['branchId'];
  const schoolSlug = payload['schoolSlug'];

  if (typeof uid !== 'string' || uid === '') return null;
  if (typeof locationId !== 'string' || locationId === '') return null;
  if (!isUserRole(role)) return null;
  if (typeof schoolSlug !== 'string') return null;

  return {
    uid,
    locationId,
    role,
    branchId: typeof branchId === 'string' && branchId !== '' ? branchId : null,
    schoolSlug,
  };
}

/** Home route for a role, falling back to the admin dashboard. */
export function homeRouteForRole(role: UserRole): string {
  return ROLE_HOME_ROUTES[role];
}
