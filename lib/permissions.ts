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
  'students.read',
  'students.create',
  'students.update',
  'students.delete',
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
  'results.promotion',
  'hr.read',
  'hr.write',
  'payroll.read',
  'payroll.write',
  'payroll.approve',
  'comms.read',
  'comms.write',
  'comms.send',
  'chat.read',
  'chat.send',
  'chat.grant',
  'chat.moderate',
  'chat.oversight',
  'settings.read',
  'settings.write',
  'branches.manage',
  'principals.manage',
  'permissions.manage',
  'calendar.manage',
  'accounting.read',
  'accounting.write',
  'accounting.settle',
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
    key: 'student-records',
    label: 'Student records',
    permissions: [
      'students.read',
      'students.create',
      'students.update',
      'students.delete',
    ],
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
      'results.promotion',
    ],
  },
  {
    key: 'comms',
    label: 'Communications',
    permissions: ['comms.read', 'comms.write', 'comms.send'],
  },
  {
    key: 'chat',
    label: 'Chat',
    permissions: [
      'chat.read',
      'chat.send',
      'chat.grant',
      'chat.moderate',
      'chat.oversight',
    ],
  },
  { key: 'hr', label: 'HR', permissions: ['hr.read', 'hr.write'] },
  {
    key: 'accounting',
    label: 'Accounting',
    permissions: ['accounting.read', 'accounting.write', 'accounting.settle'],
  },
  {
    key: 'payroll',
    label: 'Payroll',
    permissions: ['payroll.read', 'payroll.write', 'payroll.approve'],
  },
  {
    key: 'school',
    label: 'School',
    permissions: [
      'settings.read',
      'settings.write',
      'branches.manage',
      'principals.manage',
      'permissions.manage',
      'calendar.manage',
    ],
  },
];

export const PERMISSION_LABELS: Record<Permission, string> = {
  'users.read': 'See the staff and user list',
  'users.write': 'Invite, edit and deactivate users',
  'admissions.read': 'See students, grades and applications',
  'admissions.write': 'Enroll students and decide applications',
  'students.read': 'Open a student’s record',
  'students.create': 'Enroll a student',
  'students.update': 'Edit a student’s record',
  'students.delete': 'Delete a student record',
  'students.import': 'Bulk-import students from a spreadsheet',
  'students.promote': 'Roll the school over to the next academic year',
  'students.transfer': 'Move a student to another branch',
  'fees.read': 'See vouchers, the price list and fee reports',
  'fees.write': 'Set prices, raise vouchers and take payments',
  'academics.read': 'See subjects, the timetable and the register',
  'academics.write': 'Set subjects and build the timetable',
  'attendance.mark': 'Take the student register',
  'exams.read': 'See exam terms, datesheets and published results',
  'exams.write': 'Schedule exams, add papers and set grading schemes',
  'exams.publish': 'Announce a datesheet and publish a term’s report cards',
  'results.enter': 'Enter and correct marks for a paper',
  'results.publish': 'Publish marks, unpublish them, and open a re-sit',
  'results.promotion': 'Set and override a student’s promotion status for a term',
  'comms.read': 'See announcements and who they reached',
  'comms.write': 'Write and schedule announcements',
  'comms.send': 'Send an announcement, and email it to its audience',
  'chat.read': 'Open the chat inbox',
  'chat.send': 'Start conversations and reply to them',
  'chat.grant': 'Open chat for a class or a pupil, and close it again',
  'chat.moderate': 'Read reported messages, remove one, and ban somebody from chat',
  'chat.oversight': 'Read every conversation in reach, not only reported ones',
  'hr.read': 'See staff records and leave',
  'hr.write': 'Add staff, set salaries and decide leave',
  'payroll.read': 'See payroll runs and payslips',
  'payroll.write': 'Run, approve and pay payroll',
  'payroll.approve':
    'Approve a payroll run for the staff you are responsible for, and override a deduction',
  'settings.read': 'See the school profile and branding',
  'settings.write': 'Edit the school profile, logo and colours',
  'branches.manage': 'Add, edit and delete a campus',
  'principals.manage': 'Decide which principal runs which campus or division',
  'permissions.manage': 'Change what every role may do',
  'calendar.manage':
    'Add a holiday, move one, and load the year’s public holidays',
  'accounting.read': 'See the ledger, expenses and the financial statements',
  'accounting.write': 'Record expenses, post journal entries and edit the chart of accounts',
  'accounting.settle': 'Take a fee counter’s cash in and settle their account',
};

export const PERMISSION_DESCRIPTIONS: Partial<Record<Permission, string>> = {
  'fees.write':
    'Includes marking a voucher paid. Grant it only to people who handle money.',
  'payroll.write':
    'Includes approving a run, which is irreversible. Separate from payroll.read on purpose.',
  'payroll.approve':
    'A head signs off the teachers and coordinators they are answerable for, ' +
    'and nobody else’s. Deliberately not HR’s: the person who computes the ' +
    'payroll is not the person who signs it off, which is the same control ' +
    'accounting.settle exists to draw.',
  'calendar.manage':
    'The school’s own calendar — a closure, a founder’s day, and the year’s ' +
    'public holidays loaded in one click. Every Islamic date is written as ' +
    'tentative because it is decided by moon sighting, and whoever holds this ' +
    'is who confirms it. Reading the calendar needs no permission at all.',
  'permissions.manage':
    'Whoever holds this can grant themselves anything else. School Administrator always keeps it.',
  'attendance.mark': 'A teacher needs this for their own classes.',
  'comms.send':
    'Sending puts a notice in front of every parent it is addressed to, and ' +
    'an email cannot be recalled. Separate from comms.write on purpose.',
  'chat.grant':
    'Lets a teacher open chat for a whole class for a set time. It cannot lift ' +
    'a ban issued by somebody senior — that is decided by rank, not by this.',
  'chat.moderate':
    'Reading conversations that involve a pupil, and banning a parent from ' +
    'chat. Grant it to the people a safeguarding complaint would go to.',
  'chat.oversight':
    'The whole correspondence, not one reported message: staff to staff, ' +
    'teacher to teacher, and every thread about a pupil. A School ' +
    'Administrator reads the school; a Principal reads their own campuses, ' +
    'and one given particular grades reads those grades. Everybody in a ' +
    'conversation is told it can be read.',
  'results.enter':
    'A teacher needs this for their own papers. It does not let them publish.',
  'results.publish':
    'The check on a teacher’s marks. Whoever holds this is who a parent’s ' +
    'complaint about a wrong grade comes back to.',
  'results.promotion':
    'Deliberately not a teacher’s. A class teacher already overrides the ' +
    'promotion status of their own section, and that authority comes from ' +
    'being named on the section — checked per section, not per role. This key ' +
    'is the school-wide version of it, for the office.',
  'exams.publish':
    'Publishing a term issues its report cards. Separate from exams.write on purpose.',
  'students.delete':
    'Removes the child, their guardians, their enrollment history and their ' +
    'whole fee record. It is not an undo for a wrong enrollment — withdrawing ' +
    'is, and it keeps the history. Refused outright once any money has been ' +
    'received against the student, because a receipt is a fact the school is ' +
    'not allowed to erase.',
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
  'branches.manage':
    'A campus is the boundary every other list in this product is drawn ' +
    'inside — students, staff, grades, vouchers and the ledger all belong to ' +
    'one. Editing a campus renames it everywhere it appears; deleting one is ' +
    'refused outright while anybody is enrolled at it. Separate from ' +
    'settings.write because a school group hands its campuses to somebody ' +
    'more senior than whoever maintains the logo.',
  'principals.manage':
    'An assignment decides which students, staff and results a head can see. ' +
    'Whoever holds this can widen their own principal’s view of the school.',
  'accounting.read':
    'The whole of the school’s money — what it earns, what it spends, what it ' +
    'holds and what every fee counter is carrying. Narrower than it looks: it ' +
    'shows totals and heads, not any individual child’s fee record.',
  'accounting.write':
    'Includes approving an expense, which posts money out of a cash or bank ' +
    'account and cannot be edited afterwards — only reversed, in the open. ' +
    'Grant it to whoever the school would hold answerable for a wrong figure.',
  'accounting.settle':
    'The other side of a fee counter. Whoever holds this counts the clerk’s ' +
    'takings and accepts them, so it should not be the clerk — a person who ' +
    'both takes money and settles their own account is a control with nobody ' +
    'in it.',
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
 * Sprint 14 added `results.promotion` — setting and overriding the promotion
 * status a term ends in — and gave it to `school_admin`, `branch_admin` and
 * `principal` only. `teacher` deliberately does not hold it, and that is not
 * an oversight: a class teacher already overrides their own section's
 * statuses, and the authority for that comes from being named on
 * `sections.class_teacher_id`, which is checked per section. A role key would
 * hand every teacher in the school every class in it.
 *
 * Sprint 13 added `principals.manage`, and `principal` deliberately does not
 * hold it. An assignment is what narrows a head to their own campus or
 * division; a head who could edit assignments could widen that narrowing, which
 * would make BR4 a suggestion rather than a boundary. It sits with
 * `school_admin` — the same reasoning that keeps `students.transfer` there.
 *
 * Sprint 18 split the student record out of `admissions.*` into four keys, and
 * the defaults below are chosen so that **nothing changes for any school on the
 * day this deploys**: `students.read` goes to every role that already holds
 * `admissions.read`, and `students.create` and `students.update` to every role
 * that already holds `admissions.write`. A school that has never opened the
 * permissions screen sees exactly the access it had yesterday.
 *
 * `students.delete` is the exception and goes to `school_admin` alone. It is
 * the only key here that destroys history rather than writing it, and there is
 * no role for which "may enroll a child" should have implied "may make one
 * disappear".
 *
 * Sprint 19a added `branches.manage` and gave it to `school_admin` alone —
 * which, because that role holds `[...PERMISSIONS]`, needs no entry below. It
 * is deliberately **not** granted to `branch_admin`: a campus administrator
 * editing the campus record is editing the boundary they are confined by, and
 * `resolveBranchScope` reads that boundary on every request. Creating a branch
 * stays on `settings.write` where it has always been, so a school that has
 * never opened the permissions screen can still make its first campus exactly
 * as it could yesterday; only editing and deleting an existing one are new.
 */
export const DEFAULT_ROLE_PERMISSIONS: Record<UserRole, readonly Permission[]> = {
  school_admin: [...PERMISSIONS],

  branch_admin: [
    'users.read',
    'admissions.read',
    'admissions.write',
    'students.read',
    'students.create',
    'students.update',
    'fees.read',
    'academics.read',
    'attendance.mark',
    // Scheduling the campus's exams is the job; signing off its marks is not.
    // Publishing is the head's call, and Sprint 8's override table is there for
    // the school that disagrees.
    'exams.read',
    'exams.write',
    // A campus decides who moves up in its own classes. The academic
    // judgement is a head's, and a branch admin is the head of a campus.
    'results.promotion',
    // A campus has to be able to tell its own parents something. Withholding
    // the send would leave a branch drafting notices for somebody else to
    // release, which in practice means they are never released.
    'comms.read',
    'comms.write',
    'comms.send',
    'hr.read',
    // Sprint 27. A campus closes for a road blocked by a rally, and the person
    // who knows that is at the campus. This is deliberately *not* the same
    // decision as `branches.manage` two lines of reasoning below: editing the
    // campus record is editing the boundary a branch admin is confined by,
    // while adding a day the campus is shut is running it.
    'calendar.manage',
    'chat.read',
    'chat.send',
    'chat.grant',
    'chat.moderate',
    // `chat.oversight` is deliberately absent, and this is the one place in
    // this file where an omission is the decision rather than an oversight.
    // A campus administrator runs the campus office; reading what its teachers
    // say to each other, and what parents say to them, is the head's job and
    // the head's accountability. `chat.moderate` still lets them act on a
    // *reported* message, which is the thing an office actually has to do.
    'settings.read',
  ],

  principal: [
    'users.read',
    'admissions.read',
    'admissions.write',
    'students.read',
    'students.create',
    'students.update',
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
    'results.promotion',
    'comms.read',
    'comms.write',
    'comms.send',
    'hr.read',
    'payroll.read',
    // Sprint 27. `payroll.read` is seeing the salary bill; this is signing off
    // the slice of it a head is answerable for — their own campuses' teachers
    // and coordinators, or the ones in their own grades. It is deliberately
    // **not** `payroll.write`, which is still HR's: a head who could raise,
    // recompute and approve a run in one seat is a control with nobody in it.
    'payroll.approve',
    // A head owns the school's year. Confirming a tentative Eid date is
    // exactly the judgement this key exists for.
    'calendar.manage',
    // The same reasoning as `payroll.read` directly above: seeing what the
    // school earns and spends is a head's job, running the books is not.
    // `accounting.write` and `accounting.settle` are deliberately absent.
    'accounting.read',
    // A head is who a safeguarding complaint reaches, so they moderate.
    'chat.read',
    'chat.send',
    'chat.grant',
    'chat.moderate',
    // Sprint 26. A head reads the correspondence of the campuses they run, and
    // a head given particular grades reads those grades — the same
    // `PrincipalScope` that already narrows their students, their registers and
    // their marks, applied to conversations. It narrows sight and nothing else.
    'chat.oversight',
    'settings.read',
  ],

  vice_principal: [
    'users.read',
    'admissions.read',
    'admissions.write',
    'students.read',
    'students.create',
    'students.update',
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
    // Opens chat for a class; does not review a report. `chat.moderate` is
    // deliberately absent — a deputy standing in still refers a safeguarding
    // matter up rather than closing it.
    'chat.read',
    'chat.send',
    'chat.grant',
    'settings.read',
  ],

  coordinator: [
    'admissions.read',
    'students.read',
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
    'chat.read',
    'chat.send',
    'chat.grant',
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
    'students.read',
    'academics.read',
    'attendance.mark',
    'exams.read',
    'results.enter',
    // `chat.grant` is what opens a class for two hours. A teacher may open her
    // own sections and nothing else — the resolver checks the scope against
    // `listTeacherSections`, so the permission is the door and not the room.
    'chat.read',
    'chat.send',
    'chat.grant',
  ],

  // Sprint 13.5 gives the accountant the module named after them, and stops
  // one step short of the whole of it.
  //
  // `accounting.settle` is the step. An accountant at a fee counter is the
  // person whose takings get settled, and a person who both takes money across
  // a desk and accepts their own count is a control with nobody in it. The
  // bursar or head accepts it, which by default means `school_admin`. A school
  // with one office and one person in it grants it to them in one click —
  // Sprint 8's whole purpose — and does so having read the sentence under it.
  accountant: [
    'admissions.read',
    'students.read',
    'fees.read',
    'fees.write',
    'payroll.read',
    'accounting.read',
    'accounting.write',
    'chat.read',
    'chat.send',
    'settings.read',
  ],

  hr_manager: [
    'users.read',
    'users.write',
    'fees.read',
    'academics.read',
    'admissions.read',
    'students.read',
    'hr.read',
    'hr.write',
    'payroll.read',
    'payroll.write',
    // `payroll.approve` is deliberately absent, and this is the second place
    // in this file where an omission is the decision. HR computes the payroll;
    // the head signs it. A person who does both is the control
    // `accounting.settle` exists to draw, in a different module.
    //
    // `calendar.manage` **is** here: the school's year — the closures, the
    // public holidays, the Saturday rota — is HR's to keep, and it is what
    // stops a teacher being docked for a day the school was shut.
    'calendar.manage',
    'chat.read',
    'chat.send',
    'settings.read',
  ],

  marketing: [
    'admissions.read',
    'admissions.write',
    'students.read',
    'students.create',
    'students.update',
    'comms.read',
    'comms.write',
    'chat.read',
    'chat.send',
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
