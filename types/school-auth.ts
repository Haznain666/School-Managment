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
  /**
   * True when this session was minted by the platform operator entering the
   * school through "Login as Admin" rather than by a member of the school.
   *
   * It changes nothing about what the session may do — `role` alone decides
   * that — but the portal says so on screen, because an operator acting inside
   * a customer's data should never be indistinguishable from the customer.
   */
  isPlatformAdmin: boolean;
  /** The operator's address when `isPlatformAdmin`, otherwise null. */
  platformAdminEmail: string | null;
}

/**
 * The claim fields written to Firebase for a school member, without the uid
 * Firebase already owns.
 *
 * The platform-admin markers are excluded rather than optional: the OTP and
 * invite flows mint claims for people who work at the school, and neither may
 * ever set a flag that says otherwise. Only the Super Admin hand-off writes
 * those, and it does so directly.
 */
export type SchoolCustomClaims = Omit<
  SchoolSessionClaims,
  'uid' | 'isPlatformAdmin' | 'platformAdminEmail'
>;

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

/**
 * Roles that may read academics data — subjects, the timetable and the
 * register. A teacher is included: they need the timetable they are teaching to
 * and the class they are marking.
 */
export const ACADEMICS_READ_ROLES: readonly UserRole[] = [
  'school_admin',
  'branch_admin',
  'teacher',
  'hr_manager',
];

/**
 * Roles that may change what the school teaches and when. Narrower than the
 * read list on purpose: a teacher reads the timetable, they do not set it.
 */
export const ACADEMICS_WRITE_ROLES: readonly UserRole[] = ['school_admin'];

/** Roles that may take the register. Marking is a teacher's daily job. */
export const ATTENDANCE_MARK_ROLES: readonly UserRole[] = [
  'school_admin',
  'branch_admin',
  'teacher',
];

/**
 * Roles that may read HR data — the staff directory, leave and the staff
 * register. A branch admin is included so they can see their own branch's
 * staff; the routes narrow that to their branch, the role list only opens
 * the door.
 */
export const HR_READ_ROLES: readonly UserRole[] = [
  'school_admin',
  'branch_admin',
  'hr_manager',
];

/**
 * Roles that may change HR data: add staff, set salaries, decide leave.
 * Narrower than the read list on purpose — a branch admin reads their branch's
 * staff, they do not set anyone's pay.
 */
export const HR_WRITE_ROLES: readonly UserRole[] = ['school_admin', 'hr_manager'];

/**
 * Roles that may read payroll — runs, payslips and the salary bill. The
 * accountant is included because reconciling the bank against the payroll is
 * their job.
 */
export const PAYROLL_READ_ROLES: readonly UserRole[] = [
  'school_admin',
  'hr_manager',
  'accountant',
];

/**
 * Roles that may raise, approve and pay a payroll run.
 *
 * Deliberately excludes the accountant: they see the payroll and reconcile it,
 * but the person who computes what staff are owed and the person who moves the
 * money should not be the same one. It also excludes the branch admin, who has
 * no business approving a salary bill at all.
 */
export const PAYROLL_WRITE_ROLES: readonly UserRole[] = ['school_admin', 'hr_manager'];

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
  const platformAdmin = payload['platformAdmin'];
  const platformAdminEmail = payload['platformAdminEmail'];

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
    // Absent on every session minted before this existed, and on every session
    // minted by the OTP flow — so the default is the ordinary school user.
    isPlatformAdmin: platformAdmin === true,
    platformAdminEmail:
      platformAdmin === true && typeof platformAdminEmail === 'string'
        ? platformAdminEmail
        : null,
  };
}

/** Home route for a role, falling back to the admin dashboard. */
export function homeRouteForRole(role: UserRole): string {
  return ROLE_HOME_ROUTES[role];
}
