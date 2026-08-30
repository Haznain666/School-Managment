/**
 * School-portal authentication types.
 *
 * One Firebase project serves every school; tenants are separated by the
 * `locationId` custom claim (the GHL Location ID), never by project. A claim
 * set is minted server-side when an invite is accepted and travels inside the
 * session cookie, so it is the only trustworthy source of tenant identity.
 */

/**
 * Every role the school portal recognises.
 *
 * This list is the authority: `school_users.role` derives its CHECK constraint
 * from it, `parseSchoolClaims` refuses a session whose role is not in it, and
 * `lib/permissions.ts` keys its default grants off it. A role missing from here
 * cannot sign in at all, however many other tables mention it.
 *
 * `principal`, `vice_principal`, `coordinator` and `marketing` were named in
 * `db/schema/users.ts` from Sprint 1 but never added here, which is why nobody
 * holding one could open the portal. There is deliberately no cap on how many
 * people hold any of them: a school with three campuses has three principals,
 * and each is scoped by `branchId` (null = the whole school).
 */
export const USER_ROLES = [
  'school_admin',
  'branch_admin',
  'principal',
  'vice_principal',
  'coordinator',
  'teacher',
  'student',
  'parent',
  'accountant',
  'hr_manager',
  'marketing',
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
  principal: '/dashboard',
  vice_principal: '/dashboard',
  coordinator: '/dashboard',
  accountant: '/dashboard',
  hr_manager: '/dashboard',
  marketing: '/dashboard',
  teacher: '/teacher',
  student: '/student',
  parent: '/parent',
};

/** Human-readable role names for UI. */
export const ROLE_LABELS: Record<UserRole, string> = {
  school_admin: 'School Administrator',
  branch_admin: 'Branch Administrator',
  principal: 'Principal',
  vice_principal: 'Vice Principal',
  coordinator: 'Coordinator',
  teacher: 'Teacher',
  student: 'Student',
  parent: 'Parent',
  accountant: 'Accountant',
  hr_manager: 'HR Manager',
  marketing: 'Marketing',
};

/**
 * One line explaining what each role is for, shown beside the toggles on the
 * permissions screen and in the invite form. A school administrator choosing
 * between "Coordinator" and "Vice Principal" should not have to guess.
 */
export const ROLE_DESCRIPTIONS: Record<UserRole, string> = {
  school_admin: 'Full access, including who else can do what.',
  branch_admin: 'Runs one campus. Sees only their own branch.',
  principal: 'Heads the school or a campus. Oversight across every module.',
  vice_principal: 'Deputises for the principal. Oversight without payroll.',
  coordinator: 'Runs the timetable and the register for their section.',
  teacher: 'Teaches classes and takes the register.',
  student: 'Sees their own timetable, attendance and fees.',
  parent: 'Sees their children’s attendance and fee vouchers.',
  accountant: 'Handles fee collection and reconciles the salary bill.',
  hr_manager: 'Handles staff records, leave and payroll.',
  marketing: 'Handles admission enquiries and applications.',
};

/**
 * Roles that share the administrative dashboard at /dashboard.
 *
 * Membership here decides only which shell someone lands in — not what they may
 * do inside it. That is `lib/permissions.ts`, and it is per school.
 */
export const ADMIN_PORTAL_ROLES: readonly UserRole[] = [
  'school_admin',
  'branch_admin',
  'principal',
  'vice_principal',
  'coordinator',
  'accountant',
  'hr_manager',
  'marketing',
];

/**
 * Roles a school administrator may hand out from the invite screen.
 *
 * Students and parents are excluded: those accounts are created by the
 * admissions flow alongside a student record, and inviting a bare "student"
 * with no enrolment behind them produces an account that can see nothing.
 */
export const INVITABLE_ROLES: readonly UserRole[] = [
  'school_admin',
  'branch_admin',
  'principal',
  'vice_principal',
  'coordinator',
  'teacher',
  'accountant',
  'hr_manager',
  'marketing',
];

/**
 * What each role may *do* is no longer a constant.
 *
 * Sprint 8 moved it to `lib/permissions.ts`, where a code-defined catalogue of
 * permissions meets a per-school override table. The lists that used to live
 * here — FEE_READ_ROLES and the rest — became `DEFAULT_ROLE_PERMISSIONS` there,
 * unchanged in substance: they are still exactly what a school gets before it
 * touches anything.
 *
 * They were removed rather than deprecated in place, because a stale
 * `FEE_WRITE_ROLES.includes(role)` left in a route would keep answering the old
 * question forever, silently ignoring whatever the school had configured. A
 * compile error is the only reliable way to find every such site.
 */

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
