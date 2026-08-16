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
  'students.import',
  'students.promote',
  'students.transfer',
  'fees.read',
  'fees.write',
  'academics.read',
  'academics.write',
  'attendance.mark',
  'exams.read',
  'exams.write',
  'exams.publish',
  'results.enter',
  'results.publish',
  'hr.read',
  'hr.write',
  'payroll.read',
  'payroll.write',
  'comms.read',
  'comms.write',
  'comms.send',
  'settings.read',
  'settings.write',
  'principals.manage',
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
  {
    key: 'roll',
    label: 'Roll management',
    permissions: ['students.import', 'students.promote', 'students.transfer'],
  },
  { key: 'fees', label: 'Fees', permissions: ['fees.read', 'fees.write'] },
  {
    key: 'academics',
    label: 'Academics',
    permissions: ['academics.read', 'academics.write', 'attendance.mark'],
  },
  {
    key: 'exams',
    label: 'Exams & Results',
    permissions: [
      'exams.read',
      'exams.write',
      'exams.publish',
      'results.enter',
      'results.publish',
    ],
  },
  {
    key: 'comms',
    label: 'Communications',
    permissions: ['comms.read', 'comms.write', 'comms.send'],
  },
  { key: 'hr', label: 'HR', permissions: ['hr.read', 'hr.write'] },
  { key: 'payroll', label: 'Payroll', permissions: ['payroll.read', 'payroll.write'] },
  {
    key: 'school',
    label: 'School',
    permissions: [
      'settings.read',
      'settings.write',
      'principals.manage',
      'permissions.manage',
    ],
  },
];

export const PERMISSION_LABELS: Record<Permission, string> = {
  'users.read': 'See the staff and user list',
  'users.write': 'Invite, edit and deactivate users',
  'admissions.read': 'See students, grades and applications',
  'admissions.write': 'Enrol students and decide applications',
  'students.import': 'Bulk-import students from a spreadsheet',
  'students.promote': 'Roll the school over to the next academic year',
  'students.transfer': 'Move a student to another branch',
  'fees.read': 'See challans, the price list and fee reports',
  'fees.write': 'Set prices, raise challans and take payments',
  'academics.read': 'See subjects, the timetable and the register',
  'academics.write': 'Set subjects and build the timetable',
  'attendance.mark': 'Take the student register',
  'exams.read': 'See exam terms, datesheets and published results',
  'exams.write': 'Schedule exams, add papers and set grading schemes',
  'exams.publish': 'Announce a datesheet and publish a term’s report cards',
  'results.enter': 'Enter and correct marks for a paper',
  'results.publish': 'Publish marks, unpublish them, and open a re-sit',
  'comms.read': 'See announcements and who they reached',
  'comms.write': 'Write and schedule announcements',
  'comms.send': 'Send an announcement, and email it to its audience',
  'hr.read': 'See staff records and leave',
  'hr.write': 'Add staff, set salaries and decide leave',
  'payroll.read': 'See payroll runs and payslips',
  'payroll.write': 'Run, approve and pay payroll',
  'settings.read': 'See the school profile and branding',
  'settings.write': 'Edit the school profile, logo and colours',
  'principals.manage': 'Decide which principal runs which campus or division',
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
  'comms.send':
    'Sending puts a notice in front of every parent it is addressed to, and ' +
    'an email cannot be recalled. Separate from comms.write on purpose.',
  'results.enter':
    'A teacher needs this for their own papers. It does not let them publish.',
  'results.publish':
    'The check on a teacher’s marks. Whoever holds this is who a parent’s ' +
    'complaint about a wrong grade comes back to.',
  'exams.publish':
    'Publishing a term issues its report cards. Separate from exams.write on purpose.',
  'students.import':
    'Writes hundreds of student records in one action. Separate from ' +
    'admissions.write because enrolling one child and loading a whole school ' +
    'are different-sized mistakes.',
  'students.promote':
    'Moves the whole school up a year. Done once, affects every student, and ' +
    'is not a single click to undo.',
  'students.transfer':
    'Moving a student between branches also moves their fees. A branch ' +
    'administrator does not hold this — the receiving branch has to agree.',
  'principals.manage':
    'An assignment decides which students, staff and results a head can see. ' +
    'Whoever holds this can widen their own principal’s view of the school.',
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
 *
 * Sprint 9 added the five exam keys. `accountant`, `hr_manager` and `marketing`
 * deliberately get none of them, including `exams.read`: a child's marks are
 * not a finance, personnel or enquiry record, and the one thing those three
 * roles might genuinely want — knowing an exam is on — is on the datesheet.
 * A school that disagrees grants it, which is what Sprint 8 is for.
 *
 * Sprint 10 added the three roll-management keys, and they are deliberately
 * narrower than `admissions.write`:
 *
 *   students.import   — `school_admin` and `principal` only. Enrolling one
 *                       child is a decision; loading eight hundred is an
 *                       operation, and one bad mapping writes every one of them
 *                       wrong. A `branch_admin` who wants it can be granted it.
 *   students.promote  — the same two. It moves the entire school up a year.
 *   students.transfer — `school_admin` only. A transfer moves a student *and*
 *                       their fees between two branches, and a branch
 *                       administrator holding it could move a student out of a
 *                       branch they do not run — or, worse, into one.
 *
 * Sprint 13 added `principals.manage`, and `principal` deliberately does not
 * hold it. An assignment is what narrows a head to their own campus or
 * division; a head who could edit assignments could widen that narrowing, which
 * would make BR4 a suggestion rather than a boundary. It sits with
 * `school_admin` — the same reasoning that keeps `students.transfer` there.
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
    // Scheduling the campus's exams is the job; signing off its marks is not.
    // Publishing is the head's call, and Sprint 8's override table is there for
    // the school that disagrees.
    'exams.read',
    'exams.write',
    // A campus has to be able to tell its own parents something. Withholding
    // the send would leave a branch drafting notices for somebody else to
    // release, which in practice means they are never released.
    'comms.read',
    'comms.write',
    'comms.send',
    'hr.read',
    'settings.read',
  ],

  principal: [
    'users.read',
    'admissions.read',
    'admissions.write',
    'students.import',
    'students.promote',
    'fees.read',
    'academics.read',
    'academics.write',
    'attendance.mark',
    'exams.read',
    'exams.write',
    'exams.publish',
    'results.publish',
    'comms.read',
    'comms.write',
    'comms.send',
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
    'exams.read',
    'exams.write',
    'exams.publish',
    'results.publish',
    'comms.read',
    'comms.write',
    'comms.send',
    'hr.read',
    'settings.read',
  ],

  coordinator: [
    'admissions.read',
    'academics.read',
    'academics.write',
    'attendance.mark',
    // A coordinator builds the datesheet and can key marks in for a teacher who
    // is away. Publishing them is deliberately not theirs.
    'exams.read',
    'exams.write',
    'results.enter',
    // Drafts a notice; the head releases it.
    'comms.read',
    'comms.write',
    'settings.read',
  ],

  // `admissions.read` is not incidental here: a teacher's register and a
  // challan's section picker both read grades, sections and students through
  // the admissions routes. The Sprint 7 role lists on those routes included
  // both of these, and dropping either would empty a dropdown rather than
  // refuse a page — the kind of breakage that gets diagnosed as "the app is
  // broken" rather than "we changed a permission".
  // `results.enter` without `results.publish` is the whole marks-entry design:
  // a teacher fills in their own paper and submits it, and somebody else makes
  // it real. They cannot undo a publication either, which is the point — a
  // grade a parent has already seen must not change without the school knowing.
  teacher: [
    'admissions.read',
    'academics.read',
    'attendance.mark',
    'exams.read',
    'results.enter',
  ],

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

  marketing: [
    'admissions.read',
    'admissions.write',
    'comms.read',
    'comms.write',
    'settings.read',
  ],

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
