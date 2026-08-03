import { USER_ROLES, type UserRole } from '@/types/school-auth';

/**
 * The permission catalogue, and what each role gets before a school changes
 * anything (Sprint 8).
 *
 * ── The shape of the thing ───────────────────────────────────────────────
 * Permissions are defined in code and never in data. A school cannot invent
 * `fees.refund`, because no route would check it — a permission nothing
 * enforces is worse than no permission at all, since it reads on screen as a
 * guarantee. What *is* data is the grants: a per-school `role_permissions` row
 * saying "at this school, a coordinator may write academics".
 *
 * ── Overrides, not replacements ──────────────────────────────────────────
 * A row is an override of the default, not the whole answer. Absent row means
 * "whatever `DEFAULT_ROLE_PERMISSIONS` says". That is what makes an empty table
 * — every school today — behave exactly as the hardcoded arrays did before
 * this existed, and what stops a school locking itself out by deleting rows.
 *
 * This module is deliberately free of `server-only` and of any database
 * import: the permissions screen renders the same catalogue in the browser
 * that the routes enforce on the server. `lib/permission-queries.ts` is the
 * half that talks to Postgres.
 */

export const PERMISSIONS = [
  'users.read',
  'users.write',
  'admissions.read',
  'admissions.write',
  'fees.read',
  'fees.write',
  'academics.read',
  'academics.write',
  'attendance.mark',
  'hr.read',
  'hr.write',
  'payroll.read',
  'payroll.write',
  'settings.read',
  'settings.write',
  'permissions.manage',
] as const;

export type Permission = (typeof PERMISSIONS)[number];

export function isPermission(value: unknown): value is Permission {
  return typeof value === 'string' && (PERMISSIONS as readonly string[]).includes(value);
}

export interface PermissionGroup {
  key: string;
  label: string;
  permissions: readonly Permission[];
}

/** How the permissions screen sections the matrix. */
export const PERMISSION_GROUPS: readonly PermissionGroup[] = [
  { key: 'people', label: 'People', permissions: ['users.read', 'users.write'] },
  {
    key: 'admissions',
    label: 'Admissions',
    permissions: ['admissions.read', 'admissions.write'],
  },
  { key: 'fees', label: 'Fees', permissions: ['fees.read', 'fees.write'] },
  {
    key: 'academics',
    label: 'Academics',
    permissions: ['academics.read', 'academics.write', 'attendance.mark'],
  },
  { key: 'hr', label: 'HR', permissions: ['hr.read', 'hr.write'] },
  { key: 'payroll', label: 'Payroll', permissions: ['payroll.read', 'payroll.write'] },
  {
    key: 'school',
    label: 'School',
    permissions: ['settings.read', 'settings.write', 'permissions.manage'],
  },
];

export const PERMISSION_LABELS: Record<Permission, string> = {
  'users.read': 'See the staff and user list',
  'users.write': 'Invite, edit and deactivate users',
  'admissions.read': 'See students, grades and applications',
  'admissions.write': 'Enrol students and decide applications',
  'fees.read': 'See challans, the price list and fee reports',
  'fees.write': 'Set prices, raise challans and take payments',
  'academics.read': 'See subjects, the timetable and the register',
  'academics.write': 'Set subjects and build the timetable',
  'attendance.mark': 'Take the student register',
  'hr.read': 'See staff records and leave',
  'hr.write': 'Add staff, set salaries and decide leave',
  'payroll.read': 'See payroll runs and payslips',
  'payroll.write': 'Run, approve and pay payroll',
  'settings.read': 'See the school profile and branding',
  'settings.write': 'Edit the school profile, logo and colours',
  'permissions.manage': 'Change what every role may do',
};

export const PERMISSION_DESCRIPTIONS: Partial<Record<Permission, string>> = {
  'fees.write':
    'Includes marking a challan paid. Grant it only to people who handle money.',
  'payroll.write':
    'Includes approving a run, which is irreversible. Separate from payroll.read on purpose.',
  'permissions.manage':
    'Whoever holds this can grant themselves anything else. School Administrator always keeps it.',
  'attendance.mark': 'A teacher needs this for their own classes.',
};

/**
 * The permission that can never be taken from `school_admin`.
 *
 * Without this rule a school administrator could revoke their own ability to
 * manage permissions and leave the school with no way back in short of a
 * support ticket. The API refuses the change rather than warning about it.
 */
export const UNREVOKABLE: { role: UserRole; permission: Permission } = {
  role: 'school_admin',
  permission: 'permissions.manage',
};

/**
 * What each role holds out of the box.
 *
 * The first seven roles carry over the exact lists that lived in
 * `types/school-auth.ts` through Sprint 7 — a school that never opens the
 * permissions screen sees no behaviour change at all. The four roles added in
 * Sprint 8 are new, and their defaults follow the same reasoning the old lists
 * did:
 *
 *   principal      — oversight of everything the school does, including the
 *                    salary bill, but not the power to raise or approve a
 *                    payroll run. Seeing what staff cost is a head's job;
 *                    computing it is HR's.
 *   vice_principal — the principal's list without payroll at all.
 *   coordinator    — the timetable and the register, which is the job.
 *   marketing      — admissions enquiries only. No fees, no personnel files.
 */
export const DEFAULT_ROLE_PERMISSIONS: Record<UserRole, readonly Permission[]> = {
  school_admin: [...PERMISSIONS],

  branch_admin: [
    'users.read',
    'admissions.read',
    'admissions.write',
    'fees.read',
    'academics.read',
    'attendance.mark',
    'hr.read',
    'settings.read',
  ],

  principal: [
    'users.read',
    'admissions.read',
    'admissions.write',
    'fees.read',
    'academics.read',
    'academics.write',
    'attendance.mark',
    'hr.read',
    'payroll.read',
    'settings.read',
  ],

  vice_principal: [
    'users.read',
    'admissions.read',
    'admissions.write',
    'fees.read',
    'academics.read',
    'academics.write',
    'attendance.mark',
    'hr.read',
    'settings.read',
  ],

  coordinator: [
    'admissions.read',
    'academics.read',
    'academics.write',
    'attendance.mark',
    'settings.read',
  ],

  // `admissions.read` is not incidental here: a teacher's register and a
  // challan's section picker both read grades, sections and students through
  // the admissions routes. The Sprint 7 role lists on those routes included
  // both of these, and dropping either would empty a dropdown rather than
  // refuse a page — the kind of breakage that gets diagnosed as "the app is
  // broken" rather than "we changed a permission".
  teacher: ['admissions.read', 'academics.read', 'attendance.mark'],

  accountant: [
    'admissions.read',
    'fees.read',
    'fees.write',
    'payroll.read',
    'settings.read',
  ],

  hr_manager: [
    'users.read',
    'users.write',
    'fees.read',
    'academics.read',
    'admissions.read',
    'hr.read',
    'hr.write',
    'payroll.read',
    'payroll.write',
    'settings.read',
  ],

  marketing: ['admissions.read', 'admissions.write', 'settings.read'],

  // Students and parents reach their own portals, which query by uid rather
  // than by permission. They hold nothing here, and granting them something
  // would not open a door — no admin route is reachable from those shells.
  student: [],
  parent: [],
};

/** One override row, as the resolver and the API both see it. */
export interface PermissionOverride {
  role: UserRole;
  permission: Permission;
  isGranted: boolean;
}

/**
 * Whether a role holds a permission, given the school's overrides.
 *
 * Pure and synchronous so the same call answers on the server and in the
 * browser. `overrides` is the school's full set; passing a partial set silently
 * yields defaults for the rest, which is the intended behaviour rather than an
 * error — a school configures the handful of rows it cares about.
 */
export function resolvePermission(
  role: UserRole,
  permission: Permission,
  overrides: readonly PermissionOverride[],
): boolean {
  // The one rule a school cannot configure away.
  if (role === UNREVOKABLE.role && permission === UNREVOKABLE.permission) return true;

  const override = overrides.find(
    (row) => row.role === role && row.permission === permission,
  );

  if (override !== undefined) return override.isGranted;

  return DEFAULT_ROLE_PERMISSIONS[role].includes(permission);
}

/** Every permission a role effectively holds. */
export function resolveRolePermissions(
  role: UserRole,
  overrides: readonly PermissionOverride[],
): Permission[] {
  return PERMISSIONS.filter((permission) =>
    resolvePermission(role, permission, overrides),
  );
}

/** The whole matrix, for the permissions screen. */
export function resolveMatrix(
  overrides: readonly PermissionOverride[],
): Record<UserRole, Permission[]> {
  const matrix = {} as Record<UserRole, Permission[]>;
  for (const role of USER_ROLES) {
    matrix[role] = resolveRolePermissions(role, overrides);
  }
  return matrix;
}

/**
 * Roles the permissions screen lets a school configure.
 *
 * Students and parents are omitted: nothing they can reach is
 * permission-gated, so a toggle against them would be a control that does
 * nothing — the worst kind to put in front of an administrator.
 */
export const CONFIGURABLE_ROLES: readonly UserRole[] = USER_ROLES.filter(
  (role) => role !== 'student' && role !== 'parent',
);
