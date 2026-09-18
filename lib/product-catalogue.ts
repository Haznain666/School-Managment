/**
 * What this product is, in one file.
 *
 * ── Why a TypeScript module and not a table ──────────────────────────────
 * The Features and Roadmap tabs are a *description of the code*, and the code
 * is the thing that changes. A database row describing "Fee Management" cannot
 * know that `fee_management` was renamed, that `results.publish` was retired,
 * or that a role was added; it would go on being served, confidently, to the
 * person in the room with a prospect. Typed constants cannot: every module key
 * here is a `PlatformModuleKey`, every permission a `Permission`, every role a
 * `UserRole`, so the rename that would have made this file a lie is a
 * `typecheck` failure instead.
 *
 * It also means both tabs prerender. There is no query, no tenant, no session
 * — nothing here is per-school — so the pages are static HTML and cost nothing
 * per request. See `CLAUDE.md`'s second rule.
 *
 * ── The one thing that is never written down here ────────────────────────
 * **Who can do what.** `roleAccessForFeature` derives it from
 * `DEFAULT_ROLE_PERMISSIONS`, which is the same record the portal itself
 * resolves against. A hand-written matrix would be a second opinion about the
 * product's access rules, and the second opinion is always the stale one. Each
 * feature names the permission keys it is gated on; the matrix follows.
 *
 * ── Two registers, both true ─────────────────────────────────────────────
 * Every feature carries a `summary` — what it is, written for us — and a
 * `salesLine` — what it is, written for somebody deciding whether to buy it.
 * They are different sentences and neither is allowed to be a claim the code
 * does not support. Anything unverified is on the Roadmap or is absent.
 */

import {
  DEFAULT_ROLE_PERMISSIONS,
  PERMISSION_LABELS,
  type Permission,
} from '@/lib/permissions';
import { moduleLabel, type PlatformModuleKey } from '@/lib/platform-modules';
import {
  BRANCH_REQUIRED_ROLES,
  INVITABLE_ROLES,
  ROLE_DESCRIPTIONS,
  ROLE_HOME_ROUTES,
  ROLE_LABELS,
  USER_ROLES,
  type UserRole,
} from '@/types/school-auth';

/* -----------------------------------------------------------------------------
 * Types
 * -------------------------------------------------------------------------- */

export type PillarKey = 'academics' | 'finance' | 'people_ops' | 'platform';

export interface Pillar {
  key: PillarKey;
  label: string;
  /** Five or six words, for the index and the filter. */
  tagline: string;
  /** What the pillar covers, in a sentence a prospect hears. */
  blurb: string;
}

export interface FeatureEntry {
  /** Anchor id, kebab-case. Unique across the catalogue — asserted below. */
  key: string;
  pillar: PillarKey;
  name: string;
  /** null = ships regardless of any `school_modules` flag. */
  module: PlatformModuleKey | null;
  /** One line, internal register. */
  summary: string;
  /** One line a prospect hears. */
  salesLine: string;
  capabilities: readonly string[];
  /** The keys the matrix is derived from. Empty = not permission-gated. */
  permissions: readonly Permission[];
  /** Roles that reach this through their own portal rather than by permission. */
  portalAccess?: Partial<Record<UserRole, string>>;
  /** Per-role caveats that actually bind, not general cautions. */
  limitations?: Partial<Record<UserRole, string>>;
  routes: readonly string[];
  /** Glossary keys this entry leans on. */
  glossary?: readonly string[];
}

export type PortalName =
  | 'Administration'
  | 'Teaching'
  | 'Student'
  | 'Family'
  | 'Platform';

export interface RoleProfile {
  role: UserRole;
  /** From `ROLE_LABELS`. */
  label: string;
  /** From `ROLE_DESCRIPTIONS`. */
  description: string;
  portal: PortalName;
  /** From `ROLE_HOME_ROUTES`. */
  homeRoute: string;
  /** From `BRANCH_REQUIRED_ROLES`. */
  branchRequired: boolean;
  /** From `INVITABLE_ROLES`. */
  invitable: boolean;
  /** What their sidebar shows on day one, before the school configures anything. */
  defaultView: readonly string[];
  /** The boundaries that actually bind. */
  limitations: readonly string[];
}

export interface RoadmapEntry {
  key: string;
  pillar: PillarKey;
  name: string;
  summary: string;
  forWhom: string;
  /** Set when the `school_modules` flag already exists and is simply unbuilt. */
  module?: PlatformModuleKey;
}

export type GlossaryCategory =
  | 'Pillar'
  | 'Module'
  | 'Role'
  | 'Platform'
  | 'GoHighLevel';

export interface GlossaryTerm {
  key: string;
  term: string;
  definition: string;
  category: GlossaryCategory;
}

/**
 * How much of a feature a role reaches.
 *
 * `own` is not a weaker `partial`. A parent does not hold a fraction of the fee
 * module — they hold none of it, and reach their own children's vouchers
 * through a portal that queries by their uid. Collapsing the two would put
 * "Parent: partial" against Fee Management on a tab somebody sells from.
 */
export type AccessLevel = 'full' | 'partial' | 'read-only' | 'own' | 'none';

export const ACCESS_LEVEL_LABELS: Record<AccessLevel, string> = {
  full: 'Full',
  partial: 'Partial',
  'read-only': 'Read-only',
  own: 'Own records',
  none: 'None',
};

/* -----------------------------------------------------------------------------
 * Pillars
 * -------------------------------------------------------------------------- */

export const PILLAR_LABELS: Record<PillarKey, string> = {
  academics: 'Academics & Learning',
  finance: 'Finance',
  people_ops: 'People & Operations',
  platform: 'Platform',
};

/**
 * The grouping is the product owner's (2026-09-18) and exists nowhere else in
 * the repository — it is a way of talking about the modules, not a key any
 * table holds.
 *
 * `platform` is the fourth section and is **not** a pillar. It is what the
 * operator does across every tenant, and a school never sees it. It is here so
 * that the Features tab is a complete description of the product rather than a
 * complete description of the parts we sell.
 */
export const PILLARS: readonly Pillar[] = [
  {
    key: 'academics',
    label: PILLAR_LABELS.academics,
    tagline: 'Timetable, register, exams, results',
    blurb:
      'Everything between the bell and the report card: the week a class runs, ' +
      'the register that records who was in it, the papers they sat and the ' +
      'grades that come out of them.',
  },
  {
    key: 'finance',
    label: PILLAR_LABELS.finance,
    tagline: 'Admissions, fees, the books',
    blurb:
      'From the application form to the balance sheet. Children are admitted, ' +
      'billed, chased and receipted, and every rupee that moves posts to a ' +
      'double-entry ledger nobody can edit.',
  },
  {
    key: 'people_ops',
    label: PILLAR_LABELS.people_ops,
    tagline: 'Staff, payroll, campuses, messages',
    blurb:
      'The school as an employer and an organisation: who works here, what ' +
      'they are owed, who they report to, which campus they sit on, and how ' +
      'the school talks to everybody.',
  },
  {
    key: 'platform',
    label: PILLAR_LABELS.platform,
    tagline: 'Operator-only, across every school',
    blurb:
      'What the platform operator does, above the tenants. Provisioning, ' +
      'module switches, branding, support access and the feedback queue. No ' +
      'school sees any of it.',
  },
];

/** Pillars are rendered in this order on both tabs. */
export const PILLAR_KEYS: readonly PillarKey[] = PILLARS.map((pillar) => pillar.key);

/* -----------------------------------------------------------------------------
 * Features — what is built, today
 *
 * Every entry below is traceable to a route that exists, a module key in
 * `PLATFORM_MODULES`, or a permission key in `PERMISSIONS`. Five module flags
 * (`lms`, `event_mgmt`, `transport`, `library`, `hostel`) are switches with no
 * screen behind them; they are on the Roadmap and deliberately not here. A
 * Features tab that lists Library as shipped is a tab that loses a deal in the
 * room.
 * -------------------------------------------------------------------------- */

export const PRODUCT_FEATURES: readonly FeatureEntry[] = [
  /* ── Academics & Learning ─────────────────────────────────────────────── */
  {
    key: 'academics-timetable',
    pillar: 'academics',
    name: 'Academics & timetable',
    module: 'academics',
    summary:
      'Subjects, period structures and the weekly grid, with a teacher-by-teacher ' +
      'view that shows a clash before it is saved.',
    salesLine:
      'Build the week once. Every class and every teacher sees the same ' +
      'timetable, and the school can run more than one bell schedule.',
    capabilities: [
      'Subjects per grade, with codes',
      'Several period structures — an infant school and a senior school keep different bells',
      'A section’s grade decides which bell schedule its grid is drawn on',
      'Teacher calendar: one teacher’s whole week, across sections',
      'A slot belonging to another structure is refused at the write, not merely hidden',
    ],
    permissions: ['academics.read', 'academics.write'],
    portalAccess: {
      teacher: 'Their own timetable, on the teaching portal.',
      student: 'Their class’s timetable.',
      parent: 'Each child’s timetable.',
    },
    routes: [
      '/dashboard/academics',
      '/dashboard/academics/subjects',
      '/dashboard/academics/timetable',
      '/dashboard/academics/teacher-calendar',
    ],
    glossary: ['period-structure', 'section', 'module'],
  },
  {
    key: 'attendance',
    pillar: 'academics',
    name: 'Attendance & the register',
    module: 'academics',
    summary:
      'Daily marking from the teaching portal, with summary and subject-wise ' +
      'reporting behind it.',
    salesLine:
      'The register is taken on a phone in the classroom, and the parent can see ' +
      'it the same morning.',
    capabilities: [
      'Present, absent, late, excused and holiday',
      'Marked by the teacher timetabled into the section — checked on the server',
      'Attendance reports by class and by subject',
      'Feeds the family and pupil portals directly',
    ],
    permissions: ['academics.read', 'attendance.mark'],
    portalAccess: {
      student: 'Their own attendance record.',
      parent: 'Each child’s attendance.',
    },
    limitations: {
      teacher: 'Only sections they are timetabled into.',
      branch_admin: 'Their own campus.',
    },
    routes: [
      '/dashboard/academics/attendance',
      '/dashboard/academics/attendance/reports',
      '/teacher/attendance',
      '/parent/attendance',
    ],
    glossary: ['section', 'campus'],
  },
  {
    key: 'exams-datesheets',
    pillar: 'academics',
    name: 'Exams, terms & datesheets',
    module: 'academics',
    summary:
      'Exam terms per academic year, exams under them, per-grade and per-subject ' +
      'schedules, and a publish step that is a separate permission.',
    salesLine:
      'Set the term, build the datesheet once, and it appears on every pupil and ' +
      'family screen the moment it is published — not before.',
    capabilities: [
      'Exam terms per academic year',
      'Datesheets by grade and by subject',
      'Printable datesheet',
      'Scheduling and publishing are two different rights, on purpose',
    ],
    permissions: ['exams.read', 'exams.write', 'exams.publish'],
    portalAccess: {
      student: 'Their own exams and datesheet.',
      parent: 'Each child’s exams.',
    },
    routes: [
      '/dashboard/exams',
      '/dashboard/exams/terms',
      '/teacher/exams',
      '/student/exams',
    ],
    glossary: ['exam-term', 'academic-year'],
  },
  {
    key: 'marks-gradebook',
    pillar: 'academics',
    name: 'Marks entry & gradebook',
    module: 'academics',
    summary:
      'A teacher keys their own paper and submits it; publishing is somebody ' +
      'else’s key. Result sub-categories split a paper into its components.',
    salesLine:
      'Teachers enter their own marks. Nothing reaches a parent until the school ' +
      'says so, and a published grade cannot be quietly changed.',
    capabilities: [
      'Marks per paper, per pupil',
      'Result sub-categories — written, oral, practical',
      'Gradebook across a teacher’s sections',
      '`results.enter` and `results.publish` are deliberately different keys',
    ],
    permissions: ['results.enter', 'results.publish'],
    portalAccess: {
      student: 'Their own published results.',
      parent: 'Each child’s published results.',
    },
    limitations: {
      teacher: 'Enters marks; cannot publish, and cannot undo a publication.',
      coordinator: 'Can key marks in for a teacher who is away. Cannot publish.',
    },
    routes: [
      '/teacher/marks',
      '/teacher/gradebook',
      '/student/results',
      '/parent/results',
    ],
    glossary: ['exam-term', 'grading-scheme'],
  },
  {
    key: 'report-cards',
    pillar: 'academics',
    name: 'Report cards & grading schemes',
    module: 'academics',
    summary:
      'Term results assembled into a printable report card, against a grading ' +
      'scheme the school defines — including an O-Level ladder.',
    salesLine:
      'The report card the school already issues, printed from the browser. No ' +
      'PDF software, no plug-in, no separate stationery run.',
    capabilities: [
      'Grading schemes per school, with bands and descriptors',
      'Term results per pupil, aggregated from every paper',
      'Batch-printable report cards',
      'Parents print their own child’s copy from the family portal',
    ],
    permissions: ['exams.read', 'results.publish'],
    portalAccess: {
      student: 'Their own report card.',
      parent: 'Each child’s report card, printable.',
    },
    routes: [
      '/dashboard/exams/report-cards',
      '/dashboard/exams/report-cards/print',
      '/dashboard/exams/grading',
      '/dashboard/exams/settings',
      '/parent/results/print',
    ],
    glossary: ['grading-scheme', 'print-sheet'],
  },
  {
    key: 'promotions',
    pillar: 'academics',
    name: 'Promotions & promotion criteria',
    module: 'academics',
    summary:
      'End-of-year movement between grades, against criteria the school sets per ' +
      'grade, with a class teacher able to run it for their own class.',
    salesLine:
      'Move the whole school up a year in an afternoon, against rules the school ' +
      'wrote down rather than rules somebody remembered.',
    capabilities: [
      'Promotion criteria per grade',
      'Bulk promotion by section',
      'Class teachers promote their own class',
      'A promotion is recorded, so last year’s class is still answerable',
    ],
    permissions: ['results.promotion', 'students.promote'],
    routes: [
      '/dashboard/exams/promotions',
      '/dashboard/exams/criteria',
      '/dashboard/admissions/promote',
      '/teacher/promotions',
    ],
    glossary: ['academic-year', 'section'],
  },
  {
    key: 'lesson-plans',
    pillar: 'academics',
    name: 'Lesson plans',
    module: 'academics',
    summary:
      'A teacher’s own weekly plan per section, optionally shared with colleagues ' +
      'who hold `academics.read`.',
    salesLine:
      'Weekly planning where the timetable already is, and a head who wants to ' +
      'read them does not have to ask for them.',
    capabilities: [
      'One plan per section per week, owned by the teacher who wrote it',
      'Only for sections the teacher is actually timetabled into',
      'Shared plans readable across the school',
      'Ownership is the gate — no toggle for a school to get wrong',
    ],
    permissions: ['academics.read'],
    portalAccess: {
      teacher: 'Writes and corrects their own plans.',
    },
    routes: ['/teacher/lesson-plans'],
    glossary: ['section'],
  },
  {
    key: 'substitute-cover',
    pillar: 'academics',
    name: 'Substitute cover',
    module: 'academics',
    summary:
      'One day’s cover for an absent teacher, arranged from the dashboard and ' +
      'notified to the colleague who is now teaching it.',
    salesLine:
      'A teacher calls in sick at seven; by half past, the class has a name ' +
      'against it and that colleague has been told.',
    capabilities: [
      'Free-period availability computed from the real grid',
      'The substitute is notified, not merely recorded',
      'Its own permission key — building next term’s timetable is not the same act',
      'Reach follows the chain of command, not the key alone',
    ],
    permissions: ['timetable.substitute'],
    limitations: {
      coordinator: 'Their own assigned teachers only.',
      section_head: 'The teachers under their coordinators.',
      branch_admin: 'Not in the default set — deciding a teacher’s afternoon is an academic call.',
    },
    routes: ['/dashboard'],
    glossary: ['chain-of-command', 'permission'],
  },
  {
    key: 'calendar-holidays',
    pillar: 'academics',
    name: 'School calendar & holidays',
    module: null,
    summary:
      'The school’s year — closures, public holidays, campus-specific days — ' +
      'visible on every portal, with editing gated on `calendar.manage`.',
    salesLine:
      'One calendar. Everybody in the school is looking at the same one, ' +
      'including the parents.',
    capabilities: [
      'Public holidays, school closures and campus-only days',
      'An announced closure notifies the people it affects',
      'Visible on all four portals; editing is a separate right',
      'Feeds payroll, so nobody is docked for a day the school was shut',
    ],
    permissions: ['calendar.manage'],
    portalAccess: {
      teacher: 'Sees the calendar. Cannot change it.',
      student: 'Sees the calendar.',
      parent: 'Sees the calendar.',
    },
    routes: [
      '/dashboard/calendar',
      '/teacher/calendar',
      '/student/calendar',
      '/parent/calendar',
    ],
    glossary: ['campus'],
  },

  /* ── Finance ──────────────────────────────────────────────────────────── */
  {
    key: 'admissions-enrollment',
    pillar: 'finance',
    name: 'Admissions & enrollment',
    module: 'admissions',
    summary:
      'A public application form on the school’s own subdomain, an applications ' +
      'queue, one-click conversion to an enrolled pupil, and an optional mirror ' +
      'into the school’s GoHighLevel sub-account.',
    salesLine:
      'Enquiries arrive on the school’s own web address and become enrolled ' +
      'pupils without anybody retyping a form.',
    capabilities: [
      'Public application form, captcha-protected',
      'Applications queue, with one-click conversion to an enrollment',
      'Guardians captured as people: father, mother or sibling first',
      'Admission fee raised at enrollment, on its own permission key',
      'Optional contact sync to GoHighLevel where a school has connected one',
    ],
    permissions: ['admissions.read', 'admissions.write', 'students.create'],
    limitations: {
      branch_admin: 'Their own campus.',
      marketing: 'Enquiries, applications and pupil records. No fees, no academics.',
    },
    routes: [
      '/apply',
      '/dashboard/admissions',
      '/dashboard/admissions/applications',
      '/dashboard/admissions/enroll',
    ],
    glossary: ['subdomain', 'ghl-location-id', 'contact-sync', 'guardian'],
  },
  {
    key: 'student-records',
    pillar: 'finance',
    name: 'Student records & bulk import',
    module: 'admissions',
    summary:
      'The pupil record — profile, guardians, documents, academic history — plus ' +
      'a CSV importer with column mapping and a generated sample sheet.',
    salesLine:
      'Bring four hundred pupils across from a spreadsheet, map the columns once, ' +
      'and see what would fail before anything is written.',
    capabilities: [
      'Profile, guardians, uploaded documents, academic history',
      'CSV import with column mapping and per-row validation',
      'A sample sheet generated from the importer’s own field list, never typed',
      'Guardian CNIC is what makes siblings siblings, so it is canonicalised on the way in',
      'Departure and deletion are recorded, not silent',
    ],
    permissions: [
      'students.read',
      'students.update',
      'students.import',
      'students.delete',
    ],
    portalAccess: {
      student: 'Their own profile.',
      parent: 'Their children’s records.',
    },
    routes: [
      '/dashboard/admissions/students',
      '/dashboard/admissions/import',
      '/parent/children',
    ],
    glossary: ['cnic', 'sibling-link', 'admission-number'],
  },
  {
    key: 'campus-transfer',
    pillar: 'finance',
    name: 'Campus transfer',
    module: 'admissions',
    summary:
      'Moving an enrolled pupil from one campus to another, kept as a record ' +
      'rather than an edited field.',
    salesLine:
      'A family moves across town; the child moves campus without being ' +
      'un-enrolled and re-admitted.',
    capabilities: [
      'Transfer between the school’s own campuses',
      'The old campus’s history stays attached to the pupil',
      'Its own permission key, separate from editing a pupil',
    ],
    permissions: ['students.transfer'],
    routes: ['/dashboard/admissions/students/[studentId]/transfer'],
    glossary: ['campus'],
  },
  {
    key: 'fee-structure-vouchers',
    pillar: 'finance',
    name: 'Fee structure & vouchers',
    module: 'fee_management',
    summary:
      'Fee types and per-grade structures, vouchers raised in bulk or one at a ' +
      'time, part payments, bank accounts and printable voucher stationery.',
    salesLine:
      'Raise a month’s vouchers for the whole school in one pass, print them on ' +
      'the school’s own stationery, and take the money at the counter.',
    capabilities: [
      'Fee types and per-grade fee structures',
      'Bulk and single voucher generation, with a per-school voucher number series',
      'Part payments, receipts and a payment history per voucher',
      'Printable vouchers carrying the school’s own bank details',
      'Money is integer paise in code and NUMERIC in the database — no rounding drift',
    ],
    permissions: ['fees.read', 'fees.write', 'fees.admission'],
    portalAccess: {
      student: 'Their own fee status.',
      parent: 'Their children’s vouchers and what is outstanding.',
    },
    limitations: {
      branch_admin: 'Reads fees and raises an admission voucher. Does not set prices.',
      principal: 'Reads fees and raises an admission voucher. Does not set prices.',
    },
    routes: [
      '/dashboard/fees',
      '/dashboard/fees/types',
      '/dashboard/fees/structures',
      '/dashboard/fees/challans',
      '/dashboard/fees/challans/print',
      '/student/fees',
      '/parent/fees',
    ],
    glossary: ['voucher', 'paise', 'print-sheet'],
  },
  {
    key: 'family-vouchers',
    pillar: 'finance',
    name: 'Family vouchers & sibling discounts',
    module: 'fee_management',
    summary:
      'One voucher covering every enrolled child in a family, with sibling ' +
      'discounts computed from the guardian CNIC that links them.',
    salesLine:
      'One bill per family, not one per child — and the second-child discount is ' +
      'worked out rather than remembered.',
    capabilities: [
      'A single voucher across siblings',
      'Sibling discounts derived from the shared guardian record',
      'Family and per-child views stay reconciled',
    ],
    permissions: ['fees.read', 'fees.write'],
    portalAccess: {
      parent: 'Their own family voucher.',
    },
    routes: ['/dashboard/fees/family', '/parent/fees'],
    glossary: ['sibling-link', 'cnic', 'voucher'],
  },
  {
    key: 'concessions-late-fees',
    pillar: 'finance',
    name: 'Concessions & late-fee rules',
    module: 'fee_management',
    summary:
      'Concession schemes and per-pupil discounts, plus late-fee rules applied on ' +
      'a schedule the school sets.',
    salesLine:
      'Staff children, hardship cases and scholarship places are a scheme you ' +
      'apply, not a number somebody types differently each month.',
    capabilities: [
      'Concession schemes, applied to a pupil or a cohort',
      'Per-pupil discounts, by amount or percentage',
      'Late-fee rules with their own schedule',
      'Removing a discount reprices unpaid vouchers and leaves settled ones alone',
    ],
    permissions: ['fees.read', 'fees.write'],
    routes: ['/dashboard/fees/concessions', '/dashboard/fees/settings'],
    glossary: ['voucher', 'concession'],
  },
  {
    key: 'aged-debt',
    pillar: 'finance',
    name: 'Aged debt & defaulters',
    module: 'fee_management',
    summary:
      'What is owed, bucketed by age, per pupil and per campus, with a record of ' +
      'having chased each family.',
    salesLine:
      'Know exactly who owes what and for how long — and who has already been ' +
      'reminded, so nobody is chased twice in a week.',
    capabilities: [
      'Aging buckets: not yet due, 1–30, 31–60, 61–90, over 90 days',
      'Defaulter list, filterable by class and campus',
      'Reminders recorded against the voucher with a sequence number',
      'Exportable and printable',
    ],
    permissions: ['fees.read'],
    routes: ['/dashboard/fees/defaulters', '/dashboard/reports/outstanding-aging'],
    glossary: ['aging-bucket', 'voucher'],
  },
  {
    key: 'accounting',
    pillar: 'finance',
    name: 'Accounting: ledger, day book & expenses',
    module: 'accounts',
    summary:
      'A double-entry ledger nothing can edit, a chart of accounts, expenses with ' +
      'categories, a cash counter per clerk, and a settlement step.',
    salesLine:
      'A real set of books, not a summary screen. Every payment posts as it is ' +
      'taken, corrections are reversing entries, and the March question about an ' +
      'October payment has an answer.',
    capabilities: [
      'Append-only ledger — a correction is a mirror entry, and both are kept',
      'Chart of accounts, editable per school',
      'Day book, expenses and expense categories',
      'Cash lands in the drawer of whoever took it; settling it is a separate right',
      'Balance sheet, profit & loss and monthly accounts read straight off the entries',
    ],
    permissions: ['accounting.read', 'accounting.write', 'accounting.settle'],
    limitations: {
      accountant:
        'Takes money and keeps the books. Accepting their own cash count is deliberately not theirs.',
      principal: 'Reads the books. Does not run them.',
    },
    routes: [
      '/dashboard/accounting',
      '/dashboard/accounting/day-book',
      '/dashboard/accounting/expenses',
      '/dashboard/accounting/accounts',
      '/dashboard/accounting/categories',
      '/dashboard/accounting/counters',
    ],
    glossary: ['ledger', 'double-entry', 'cash-counter', 'paise'],
  },
  {
    key: 'finance-reports',
    pillar: 'finance',
    name: 'Fee & finance reports',
    module: null,
    summary:
      'Fee collection, outstanding and aging, monthly revenue, balance sheet, ' +
      'profit & loss, day book, account summary and expense detail.',
    salesLine:
      'The reports a school board asks for, on screen, exportable and printable, ' +
      'without anybody assembling a spreadsheet.',
    capabilities: [
      'Fee collection and collection rate, by class and campus',
      'Outstanding & aging',
      'Monthly revenue, balance sheet, profit & loss',
      'Day book, account summary, monthly accounts, expense detail',
      'Each report carries the permission of the screen its data comes from',
    ],
    permissions: ['fees.read', 'accounting.read'],
    routes: [
      '/dashboard/fees/reports',
      '/dashboard/reports',
      '/dashboard/reports/[reportKey]',
      '/dashboard/reports/[reportKey]/print',
    ],
    glossary: ['ledger', 'print-sheet'],
  },

  /* ── People & Operations ──────────────────────────────────────────────── */
  {
    key: 'users-roles-permissions',
    pillar: 'people_ops',
    name: 'Users, roles & the permission matrix',
    module: null,
    summary:
      'Invitations, twelve roles, and a per-school override matrix over a ' +
      'code-defined catalogue of permission keys.',
    salesLine:
      'The school decides who can do what, itself, without asking us — and sees a ' +
      'sentence explaining every switch before it moves one.',
    capabilities: [
      'Invite by email; the account is created when the invite is accepted',
      'Twelve roles, ten of them invitable',
      'A permission matrix the school edits, over defaults that work on day one',
      'Every key carries a plain-English label, and thirty carry a paragraph',
      'Authorization is read per request, so deactivating somebody takes effect at once',
    ],
    permissions: ['users.read', 'users.write', 'permissions.manage'],
    limitations: {
      branch_admin: 'Sees only their own campus’s people.',
    },
    routes: [
      '/dashboard/users',
      '/dashboard/users/invite',
      '/dashboard/settings/permissions',
    ],
    glossary: ['permission', 'permission-matrix', 'role', 'school-user'],
  },
  {
    key: 'multi-campus',
    pillar: 'people_ops',
    name: 'Multi-campus',
    module: null,
    summary:
      'Branches as first-class records, with staff, pupils, calendars, exams and ' +
      'money scoped to them, and a header that always says which one you are in.',
    salesLine:
      'Run three campuses from one login, and never wonder which campus the ' +
      'number on the screen belongs to.',
    capabilities: [
      'Branches with their own address, contact and calendar',
      'Branch-scoped queries throughout, not a filter over a shared list',
      'Four roles require a campus; the rest see the whole school',
      'A campus selector, and a header that names the current scope',
    ],
    permissions: ['settings.read', 'branches.manage'],
    limitations: {
      branch_admin: 'Confined to one campus — which is what the record defines.',
    },
    routes: ['/dashboard/branches', '/dashboard/branches/new'],
    glossary: ['campus', 'branch-required-role', 'tenant'],
  },
  {
    key: 'principal-assignments',
    pillar: 'people_ops',
    name: 'Principal assignments & the chain of command',
    module: null,
    summary:
      'Which campuses or grades each head is answerable for, and who approves ' +
      'whose leave — coordinator, section head, vice principal, principal.',
    salesLine:
      'A school with three heads stops being a school where everybody sees ' +
      'everything. Each one sees their own campuses, or their own grades.',
    capabilities: [
      'A principal is scoped to campuses, or to named grades',
      'One head per campus, enforced',
      'Section heads own coordinators; coordinators own teachers',
      'The chain decides approvals and reach — not a hard-coded role list',
    ],
    permissions: ['principals.manage'],
    routes: ['/dashboard/settings', '/dashboard/hr/chain'],
    glossary: ['chain-of-command', 'principal-scope', 'campus'],
  },
  {
    key: 'staff-records',
    pillar: 'people_ops',
    name: 'Staff records & salary components',
    module: 'hr_payroll',
    summary:
      'The personnel file — one person, one record, linked to their login — and ' +
      'the salary structure built from reusable components.',
    salesLine:
      'One record per member of staff, whether or not they have a login, and a ' +
      'salary built out of named components rather than a single figure.',
    capabilities: [
      'Personnel file: designation, campus, joining date, documents',
      'A staff row and a login are the same person, linked',
      'Salary components — allowances, deductions — reused across staff',
      'Per-staff salary structure built from those components',
      'Probation tracked and notified',
    ],
    permissions: ['hr.read', 'hr.write'],
    limitations: {
      branch_admin: 'Reads their own campus’s staff. Does not edit personnel files.',
      section_head: 'Reads leave, not personnel files — deliberately.',
    },
    routes: ['/dashboard/hr/staff', '/dashboard/hr/salary-components'],
    glossary: ['school-user', 'campus'],
  },
  {
    key: 'leave-management',
    pillar: 'people_ops',
    name: 'Leave management',
    module: 'hr_payroll',
    summary:
      'Leave types, entitlements, applications and approvals that travel up the ' +
      'chain of command, with four permission keys instead of one.',
    salesLine:
      'A teacher applies on their phone, their coordinator decides it, and the ' +
      'payroll already knows.',
    capabilities: [
      'Leave types, and settings per campus',
      'Applications from the teaching portal and from the dashboard',
      'Approval follows the chain: coordinator, section head, vice principal, principal',
      'HR keeps the rules and the files for staff with no login — and does not approve',
      'Quotas and balances computed, not stored',
    ],
    permissions: ['leave.read', 'leave.request', 'leave.approve', 'leave.manage'],
    limitations: {
      teacher: 'Applies for their own leave and sees their own record. Approves nobody.',
      coordinator: 'Decides the leave of the teachers assigned to them, and nobody else.',
      hr_manager: 'Keeps the rules and the files. Does not sign off against them.',
    },
    routes: [
      '/dashboard/leave',
      '/dashboard/leave/me',
      '/dashboard/hr/leave',
      '/teacher/leave',
    ],
    glossary: ['chain-of-command', 'permission'],
  },
  {
    key: 'staff-register',
    pillar: 'people_ops',
    name: 'Staff register & Saturday duty',
    module: 'hr_payroll',
    summary:
      'Staff attendance, per-role working calendars, and a Saturday duty rota ' +
      'saved one row per role.',
    salesLine:
      'The staff register feeds the payroll, so loss of pay is computed rather ' +
      'than argued about.',
    capabilities: [
      'Daily staff attendance per campus',
      'Working calendars per role — a teacher’s week is not an accountant’s',
      'Saturday duty policy, one setting per role',
      'Feeds loss of pay in the payroll calculator',
    ],
    permissions: ['hr.read', 'hr.write'],
    routes: [
      '/dashboard/hr/attendance',
      '/dashboard/hr/saturday-duty',
      '/dashboard/hr/calendars',
    ],
    glossary: ['campus', 'role'],
  },
  {
    key: 'payroll',
    pillar: 'people_ops',
    name: 'Payroll runs & payslips',
    module: 'hr_payroll',
    summary:
      'Monthly runs computed from salary structures, the staff register and ' +
      'leave, producing numbered payslips staff read on their own portal.',
    salesLine:
      'Run the month’s payroll from what the school already recorded, and every ' +
      'member of staff finds their payslip waiting for them.',
    capabilities: [
      'Runs per month, per campus',
      'Gross, loss of pay, deductions, net payable',
      'Numbered payslips, from a per-school series',
      'Staff read their own payslips on the teaching portal',
      'Payroll summary report',
    ],
    permissions: ['payroll.read', 'payroll.write'],
    portalAccess: {
      teacher: 'Their own payslips.',
    },
    routes: [
      '/dashboard/payroll',
      '/dashboard/payroll/runs',
      '/dashboard/payroll/payslips',
      '/teacher/payslips',
    ],
    glossary: ['paise', 'print-sheet'],
  },
  {
    key: 'payroll-approvals',
    pillar: 'people_ops',
    name: 'Payroll approvals',
    module: 'hr_payroll',
    summary:
      'A head signs off the slice of the salary bill they are answerable for. ' +
      'Computing a run and approving it are different keys, held by different people.',
    salesLine:
      'The person who computes the payroll is not the person who signs it. That ' +
      'is a control, and it is switched on by default.',
    capabilities: [
      'Approval per campus or per grade set, following the principal’s scope',
      'HR computes; the head approves',
      'The approval is recorded against the run',
    ],
    permissions: ['payroll.approve'],
    limitations: {
      hr_manager: 'Deliberately absent. HR computes the payroll; the head signs it.',
    },
    routes: ['/dashboard/payroll/approvals'],
    glossary: ['principal-scope', 'permission'],
  },
  {
    key: 'staff-kpis',
    pillar: 'people_ops',
    name: 'Staff KPIs & performance',
    module: 'staff_kpis',
    summary:
      'KPIs defined per role, monthly and annual ratings, and one overall figure ' +
      'per member of staff — with a rate key per target role.',
    salesLine:
      'Appraisal that happens monthly instead of once a year, and a single number ' +
      'a salary review can actually turn on.',
    capabilities: [
      'KPIs defined per role, by the school',
      'Monthly ratings and an annual overall',
      'Who rates whom is a permission key per target role, not a hard-coded list',
      'Staff see their own scorecard',
      'Campus scorecards for heads',
    ],
    permissions: ['kpis.read', 'kpis.create', 'kpis.delete', 'kpis.overall'],
    portalAccess: {
      teacher: 'Their own performance page.',
    },
    limitations: {
      branch_admin: 'Rates non-teaching staff and coordinators. Never teachers.',
      accountant: 'Reads the yearly overall only — never a monthly KPI, never a comment.',
      hr_manager: 'Sees scores. Rating stays with the line manager.',
    },
    routes: [
      '/dashboard/performance',
      '/dashboard/performance/kpis',
      '/dashboard/performance/setup',
      '/dashboard/performance/staff',
      '/dashboard/performance/me',
      '/teacher/performance',
    ],
    glossary: ['kpi', 'permission', 'module'],
  },
  {
    key: 'chat',
    pillar: 'people_ops',
    name: 'Chat & messaging',
    module: 'chat',
    summary:
      'Internal messaging across all four portals: office desks, time-limited ' +
      'class grants, attachments, reporting, moderation and head-level oversight.',
    salesLine:
      'Parents and teachers message each other inside the school’s own system, ' +
      'under the school’s own rules — not on a phone number nobody controls.',
    capabilities: [
      'Conversations between staff, parents and pupils',
      'Office desks — a parent writes to the fee office, not to a person who left',
      'Grants open a class for a fixed window and then close it',
      'Attachments, reporting, and moderation of reported messages',
      'Head-level oversight, scoped by the same principal scope as everything else',
      'Broadcasts: one message to a whole class',
      'Delivered instantly, with a bell and a browser notification',
    ],
    permissions: ['chat.read', 'chat.send', 'chat.grant', 'chat.moderate', 'chat.oversight'],
    portalAccess: {
      student: 'Their own conversations, inside the school’s rules.',
      parent: 'Their own conversations with the school.',
    },
    limitations: {
      teacher: 'May open their own sections and nothing else.',
      branch_admin:
        'Moderates reported messages; oversight of everything said is the head’s.',
      vice_principal: 'Opens a class. Does not close a safeguarding report.',
    },
    routes: [
      '/dashboard/chat',
      '/dashboard/chat/moderation',
      '/dashboard/chat/oversight',
      '/teacher/chat',
      '/student/chat',
      '/parent/chat',
    ],
    glossary: ['chat-desk', 'chat-grant', 'oversight', 'module'],
  },
  {
    key: 'announcements-email',
    pillar: 'people_ops',
    name: 'Announcements & email',
    module: null,
    summary:
      'Notices written once and delivered to a chosen audience, scheduled or ' +
      'immediate, over email and the portals. Not module-gated: every school ' +
      'tells people things.',
    salesLine:
      'One notice reaches the right classes, the right campus and the right ' +
      'parents — and the school can see that it went.',
    capabilities: [
      'Audience by role, campus, grade or section',
      'Scheduled release, swept by the server rather than by somebody remembering',
      'Email through the school’s own SMTP account, with an outbox and a health view',
      'Visible on the teaching, pupil and family portals',
      'Drafting and sending are two different rights',
    ],
    permissions: ['comms.read', 'comms.write', 'comms.send'],
    portalAccess: {
      teacher: 'Reads the school’s announcements.',
      student: 'Reads the school’s announcements.',
      parent: 'Reads the school’s announcements.',
    },
    limitations: {
      coordinator: 'Drafts a notice; the head releases it.',
      marketing: 'Drafts a notice; the head releases it.',
    },
    routes: [
      '/dashboard/communications',
      '/teacher/announcements',
      '/student/announcements',
      '/parent/announcements',
    ],
    glossary: ['announcement-audience', 'smtp'],
  },
  {
    key: 'web-push-pwa',
    pillar: 'people_ops',
    name: 'Web push & the installable app',
    module: null,
    summary:
      'A progressive web app with an offline shell, an in-app notification bell, ' +
      'and browser push subscriptions per device.',
    salesLine:
      'Parents install the school on their home screen and are notified when ' +
      'something happens — no app store, no download.',
    capabilities: [
      'Installable on Android, iOS and desktop, from the browser',
      'Offline shell, so a dropped connection is not a blank page',
      'Notification bell with an unread count on every portal',
      'Push subscriptions per device, revocable',
      'Notification preferences per person',
    ],
    permissions: [],
    portalAccess: {
      school_admin: 'Bell and push on the administrative portal.',
      branch_admin: 'Bell and push on the administrative portal.',
      principal: 'Bell and push on the administrative portal.',
      vice_principal: 'Bell and push on the administrative portal.',
      section_head: 'Bell and push on the administrative portal.',
      coordinator: 'Bell and push on the administrative portal.',
      teacher: 'Bell and push on the teaching portal.',
      student: 'Bell and push on the pupil portal.',
      parent: 'Bell and push on the family portal.',
      accountant: 'Bell and push on the administrative portal.',
      hr_manager: 'Bell and push on the administrative portal.',
      marketing: 'Bell and push on the administrative portal.',
    },
    routes: ['/offline'],
    glossary: ['pwa', 'web-push'],
  },
  {
    key: 'reports',
    pillar: 'people_ops',
    name: 'Reports',
    module: null,
    summary:
      'Sixteen reports over one index, each carrying the permission of the screen ' +
      'its data comes from, each exportable and printable.',
    salesLine:
      'Attendance, results, fees, payroll, leave, enrollment and the books — all ' +
      'in one place, and each person sees only the ones they are entitled to.',
    capabilities: [
      'Attendance summary, and subject-wise attendance',
      'Academic results, enrollment funnel, leave summary',
      'Fee collection, outstanding & aging, monthly revenue',
      'Balance sheet, profit & loss, day book, account summary, monthly accounts, expense detail, income & expense summary',
      'Payroll summary',
      'CSV export and a print sheet for every one of them',
    ],
    permissions: [
      'academics.read',
      'exams.read',
      'fees.read',
      'hr.read',
      'payroll.read',
      'accounting.read',
      'admissions.read',
    ],
    routes: ['/dashboard/reports', '/dashboard/reports/[reportKey]'],
    glossary: ['print-sheet', 'permission'],
  },
  {
    key: 'feedback',
    pillar: 'people_ops',
    name: 'Feedback to the vendor',
    module: null,
    summary:
      'Anybody on the administrative portal can report a bug or ask for ' +
      'something, and is emailed when its status changes. Gated on no ' +
      'permission, deliberately — the route takes the nine administrative roles.',
    salesLine:
      'When something is wrong, the person who found it tells us directly — and ' +
      'hears back.',
    capabilities: [
      'A bug or a request, from anybody on the administrative portal',
      'Emailed when the status changes',
      'Reaches one cross-school queue the operator works from',
      'No permission gates it — the only thing one could do is stop somebody reporting a bug',
    ],
    permissions: [],
    // The nine administrative roles, which is exactly `ADMIN_PORTAL_ROLES` —
    // the list the route itself is gated on. Teachers, pupils and parents are
    // on other shells and have no screen for this.
    portalAccess: {
      school_admin: 'Anybody on the administrative portal can file one.',
      branch_admin: 'Anybody on the administrative portal can file one.',
      principal: 'Anybody on the administrative portal can file one.',
      vice_principal: 'Anybody on the administrative portal can file one.',
      section_head: 'Anybody on the administrative portal can file one.',
      coordinator: 'Anybody on the administrative portal can file one.',
      accountant: 'Anybody on the administrative portal can file one.',
      hr_manager: 'Anybody on the administrative portal can file one.',
      marketing: 'Anybody on the administrative portal can file one.',
    },
    routes: ['/dashboard/feedback'],
    glossary: ['feedback-queue'],
  },
  {
    key: 'global-search',
    pillar: 'people_ops',
    name: 'Global search',
    module: null,
    summary:
      'One search box over pupils, staff, vouchers and screens, on every portal, ' +
      'returning only what the searcher is entitled to.',
    salesLine:
      'Type a name or an admission number anywhere in the system and land on the ' +
      'record.',
    capabilities: [
      'Pupils, staff, vouchers and destinations',
      'Available on all four portals',
      'Results filtered by the searcher’s own permissions and campus',
    ],
    permissions: ['students.read'],
    portalAccess: {
      teacher: 'Searches what their own portal reaches.',
      student: 'Searches their own portal.',
      parent: 'Searches their own portal.',
    },
    routes: ['/dashboard/search', '/teacher/search', '/student/search', '/parent/search'],
    glossary: ['admission-number'],
  },

  /* ── Platform (operator-only) ─────────────────────────────────────────── */
  {
    key: 'school-provisioning',
    pillar: 'platform',
    name: 'School provisioning & subdomains',
    module: null,
    summary:
      'Creating a tenant: the school record, its first administrator, its ' +
      'campuses, and a wildcard subdomain provisioned on the host.',
    salesLine:
      'A new school is live on its own web address, with its own administrator ' +
      'signed in, in one sitting.',
    capabilities: [
      'Guided wizard: school, campus, first administrator',
      'Subdomain provisioned, and its status reported back',
      'Setup progress shown to the school until it is complete',
      'Deactivation takes effect on every session at that school',
    ],
    permissions: [],
    routes: ['/super-admin/schools', '/super-admin/schools/new'],
    glossary: ['tenant', 'subdomain', 'super-admin'],
  },
  {
    key: 'module-toggles',
    pillar: 'platform',
    name: 'Module toggles & bulk apply',
    module: null,
    summary:
      'Per-school module switches, and a cross-school page that applies a change ' +
      'to up to a hundred schools at once, from a baseline of what they hold.',
    salesLine:
      'Sell a module, switch it on. Switch it on for nine schools at once, ' +
      'without nine visits.',
    capabilities: [
      'Twelve module flags per school',
      'Bulk apply, with a blast-radius cap',
      'Switches initialise from what the selected schools actually hold',
      'Only the switches that were moved are written',
    ],
    permissions: [],
    routes: ['/super-admin/modules', '/super-admin/schools/[schoolId]/modules'],
    glossary: ['module', 'module-flag', 'super-admin'],
  },
  {
    key: 'login-as-admin',
    pillar: 'platform',
    name: 'Login as Admin',
    module: null,
    summary:
      'The operator entering a school’s portal to reproduce a fault, with the ' +
      'session marked as such and the portal saying so on screen.',
    salesLine:
      'When a school reports a problem we look at their screen — and their screen ' +
      'says we are looking.',
    capabilities: [
      'A session minted for one school, marked as platform-admin',
      'The portal says whose seat it is, on screen',
      'Changes nothing about what the session may do — the role alone decides that',
    ],
    permissions: [],
    routes: ['/super-admin/schools/[schoolId]/login-as'],
    glossary: ['super-admin', 'tenant'],
  },
  {
    key: 'branding-palette',
    pillar: 'platform',
    name: 'Branding & palette',
    module: null,
    summary:
      'Each school’s logo and five-colour palette, from which every token in the ' +
      'interface is derived and contrast-checked.',
    salesLine:
      'The portal is in the school’s colours, with the school’s crest, on the ' +
      'school’s own address. It looks like theirs because it is.',
    capabilities: [
      'Logo upload, with an on-canvas editor',
      'Five-colour palette, with presets',
      'Every surface, badge and chart colour derived from it',
      'Contrast audited against deliberately hostile palettes',
      'The Super Admin surface stays deliberately uncoloured',
    ],
    permissions: [],
    routes: ['/super-admin/schools/[schoolId]/branding'],
    glossary: ['palette', 'super-admin'],
  },
  {
    key: 'ghl-integration',
    pillar: 'platform',
    name: 'GoHighLevel integration',
    module: null,
    summary:
      'An optional per-school connection to the school’s own GoHighLevel ' +
      'sub-account, used for contact sync only.',
    salesLine:
      'A school already running GoHighLevel gets its pupils and guardians ' +
      'mirrored into its own sub-account. A school that does not, loses nothing.',
    capabilities: [
      'Connected means the school’s GHL Location ID is stored — there is no second flag to disagree with it',
      'The pupil and the primary guardian are mirrored on enrollment',
      'A failed sync never blocks an enrollment, and can be replayed',
      'Opt-in: a school without a sub-account is normal, not an error',
      'Contact sync only — nothing on this platform sends messages through it',
    ],
    permissions: [],
    routes: ['/super-admin/schools/[schoolId]/integrations'],
    glossary: ['ghl', 'ghl-location-id', 'ghl-sub-account', 'contact-sync', 'tenant'],
  },
  {
    key: 'feedback-queue',
    pillar: 'platform',
    name: 'The feedback queue',
    module: null,
    summary:
      'Every school’s feedback in one cross-tenant queue, sectioned by what has ' +
      'been decided about it; a status change emails the school.',
    salesLine:
      'One queue for what every school has told us, so nothing is answered in ' +
      'four places and nothing is answered nowhere.',
    capabilities: [
      'Active, work in progress, future development, resolved',
      'Bugs marked in words as well as in colour',
      'Changing a status emails the school that reported it',
      'Filterable by school and by nature',
    ],
    permissions: [],
    routes: ['/super-admin/feedback', '/super-admin/feedback/[ticketId]'],
    glossary: ['feedback-queue', 'super-admin', 'tenant'],
  },
];

/* -----------------------------------------------------------------------------
 * Role profiles
 *
 * `label`, `description`, `homeRoute`, `branchRequired` and `invitable` are all
 * *derived* rather than restated. A second copy of a role description is the
 * copy that goes stale, and this file is read by somebody with a prospect in
 * front of them.
 * -------------------------------------------------------------------------- */

type RoleProfileBody = Pick<RoleProfile, 'portal' | 'defaultView' | 'limitations'>;

const ROLE_PROFILE_BODIES: Record<UserRole, RoleProfileBody> = {
  school_admin: {
    portal: 'Administration',
    defaultView: [
      'Dashboard',
      'Users & Staff',
      'Branches',
      'Admissions',
      'Academics',
      'Exams',
      'Fees',
      'HR',
      'Leave',
      'Payroll',
      'Staff performance',
      'Accounting',
      'Communications',
      'Messages',
      'Reports',
      'Calendar',
      'Settings',
      'Feedback',
    ],
    limitations: [
      'Holds every permission by default, including the permission matrix itself.',
      'Cannot be stripped of `permissions.manage` — the one rule a school cannot configure away.',
      'Sees every campus.',
    ],
  },
  branch_admin: {
    portal: 'Administration',
    defaultView: [
      'Dashboard',
      'My Branch Staff',
      'Branches',
      'Admissions',
      'Academics',
      'Exams',
      'Fees',
      'HR',
      'Leave',
      'Staff performance',
      'Communications',
      'Messages',
      'Reports',
      'Calendar',
      'Settings',
      'Feedback',
    ],
    limitations: [
      'Confined to one campus. Every list, count and report is that campus only.',
      'Schedules the campus’s exams; publishing its marks is the head’s call.',
      'Rates non-teaching staff and coordinators — never teachers.',
      'Moderates reported messages, but does not hold chat oversight.',
      'Reads fees and raises admission vouchers; does not set prices.',
    ],
  },
  principal: {
    portal: 'Administration',
    defaultView: [
      'Dashboard',
      'Users & Staff',
      'Branches',
      'Admissions',
      'Academics',
      'Exams',
      'Fees',
      'HR',
      'Leave',
      'Payroll',
      'Staff performance',
      'Accounting',
      'Communications',
      'Messages',
      'Reports',
      'Calendar',
      'Settings',
      'Feedback',
    ],
    limitations: [
      'Scoped to the campuses they head, or to named grades where the school assigns grades instead.',
      'Approves the slice of the payroll they are answerable for; does not compute it.',
      'Reads the books; `accounting.write` and `accounting.settle` are deliberately absent.',
      'Top of every approval chain at their branch, so nothing stalls unheard.',
    ],
  },
  vice_principal: {
    portal: 'Administration',
    defaultView: [
      'Dashboard',
      'Users & Staff',
      'Branches',
      'Admissions',
      'Academics',
      'Exams',
      'Fees',
      'HR',
      'Leave',
      'Staff performance',
      'Communications',
      'Messages',
      'Reports',
      'Calendar',
      'Settings',
      'Feedback',
    ],
    limitations: [
      'The head’s academic rights, without payroll.',
      'Opens a class for chat; does not close a safeguarding report.',
      'Rates teachers, coordinators and section heads — never a deputy, never the head.',
    ],
  },
  section_head: {
    portal: 'Administration',
    defaultView: [
      'Dashboard',
      'Branches',
      'Admissions',
      'Academics',
      'Exams',
      'Leave',
      'Staff performance',
      'Communications',
      'Messages',
      'Reports',
      'Calendar',
      'Settings',
      'Feedback',
    ],
    limitations: [
      'Runs one section; the coordinators under them report here.',
      'Approves and rates their coordinators, and reaches their coordinators’ teachers.',
      'Reads leave, not personnel files — that distinction is why the leave keys exist.',
      'Cannot ban a named person from a conversation; that threshold is higher.',
    ],
  },
  coordinator: {
    portal: 'Administration',
    defaultView: [
      'Dashboard',
      'Branches',
      'Admissions',
      'Academics',
      'Exams',
      'Leave',
      'Staff performance',
      'Communications',
      'Messages',
      'Reports',
      'Calendar',
      'Settings',
      'Feedback',
    ],
    limitations: [
      'Builds the timetable and the datesheet; publishing results is not theirs.',
      'Decides leave for the teachers assigned to them in the chain, and nobody else.',
      'Drafts a notice; the head releases it.',
      'Rates only the teachers a principal has assigned to them.',
    ],
  },
  teacher: {
    portal: 'Teaching',
    defaultView: [
      'My Dashboard',
      'My Timetable',
      'My Classes',
      'Attendance',
      'My Exams',
      'Marks',
      'Gradebook',
      'Promotions (class teachers only)',
      'Lesson Plans',
      'Calendar',
      'Messages',
      'Announcements',
      'My Performance',
      'My Payslips',
      'My Leave',
    ],
    limitations: [
      'Only the sections they are timetabled into — checked on the server, not in the dropdown.',
      'Enters marks; cannot publish them, and cannot undo a publication.',
      'Applies for their own leave; approves nobody.',
      'Opens chat for their own sections only.',
    ],
  },
  student: {
    portal: 'Student',
    defaultView: [
      'My Dashboard',
      'My Timetable',
      'My Exams',
      'My Results',
      'Fee Status',
      'Calendar',
      'Messages',
      'Announcements',
    ],
    limitations: [
      'Holds no permission at all. The pupil portal queries by their own uid.',
      'Created by the admissions flow, never by an invitation.',
      'Sees their own record and nothing else.',
    ],
  },
  parent: {
    portal: 'Family',
    defaultView: [
      'My Dashboard',
      'My Children',
      'Attendance',
      'Results',
      'Timetable',
      'Fees',
      'Calendar',
      'Messages',
      'Announcements',
      'Settings',
    ],
    limitations: [
      'Holds no permission at all. The family portal queries by their own uid.',
      'Created by the admissions flow, never by an invitation.',
      'Sees every enrolled child linked to them, and no other family.',
    ],
  },
  accountant: {
    portal: 'Administration',
    defaultView: [
      'Dashboard',
      'Branches',
      'Admissions',
      'Fees',
      'Leave',
      'Accounting',
      'Messages',
      'Reports',
      'Calendar',
      'Settings',
      'Feedback',
    ],
    limitations: [
      'Takes fees and keeps the books.',
      'Cannot accept their own cash count — settlement is somebody else’s key.',
      'Reads the yearly performance overall; never a monthly KPI, never a comment.',
    ],
  },
  hr_manager: {
    portal: 'Administration',
    defaultView: [
      'Dashboard',
      'Users & Staff',
      'Branches',
      'Admissions',
      'Academics',
      'Fees',
      'HR',
      'Leave',
      'Payroll',
      'Staff performance',
      'Messages',
      'Reports',
      'Calendar',
      'Settings',
      'Feedback',
    ],
    limitations: [
      'Computes the payroll; the head signs it.',
      'Keeps leave rules and files, including for staff who have no login — and does not approve.',
      'Sees performance scores; rating stays with the line manager.',
      'Owns the school’s year — the closures, the public holidays, the Saturday rota.',
    ],
  },
  marketing: {
    portal: 'Administration',
    defaultView: [
      'Dashboard',
      'Branches',
      'Admissions',
      'Leave',
      'Communications',
      'Messages',
      'Reports',
      'Calendar',
      'Settings',
      'Feedback',
    ],
    limitations: [
      'Enquiries, applications and pupil records. No fees, no academics, no HR.',
      'Drafts a notice; the head releases it.',
    ],
  },
};

/**
 * Twelve profiles, in `USER_ROLES` order — which is the seniority order the
 * portal reads the list in, and the order the permissions matrix draws its
 * columns in.
 *
 * Built by mapping over `USER_ROLES` rather than written out, so a thirteenth
 * role is a `typecheck` failure in `ROLE_PROFILE_BODIES` above rather than a
 * role quietly missing from a tab nobody re-reads.
 */
export const ROLE_PROFILES: readonly RoleProfile[] = USER_ROLES.map((role) => ({
  role,
  label: ROLE_LABELS[role],
  description: ROLE_DESCRIPTIONS[role],
  homeRoute: ROLE_HOME_ROUTES[role],
  branchRequired: BRANCH_REQUIRED_ROLES.includes(role),
  invitable: INVITABLE_ROLES.includes(role),
  ...ROLE_PROFILE_BODIES[role],
}));

/* -----------------------------------------------------------------------------
 * Roadmap
 *
 * ── No sprint numbers, no dates, no order ────────────────────────────────
 * The product owner's instruction, and a standing rule: this product has no
 * release dates, and none may be stated or implied. A roadmap with an order on
 * it is a roadmap with dates on it as far as the person reading it is
 * concerned. So: the name, what it does, and who it is for.
 *
 * Five of these already have a `school_modules` flag — `lms`, `event_mgmt`,
 * `transport`, `library`, `hostel` — and the flag is the whole of what exists.
 * `module` is set on those entries so the tab can say so honestly rather than
 * implying more than a switch.
 * -------------------------------------------------------------------------- */

export const ROADMAP_ITEMS: readonly RoadmapEntry[] = [
  {
    key: 'lms-courses',
    pillar: 'academics',
    name: 'Learning management: courses & content',
    module: 'lms',
    summary:
      'Courses, units and uploaded content, attached to the subjects and sections ' +
      'the timetable already knows about.',
    forWhom: 'Teachers building a course, and the coordinators who review it.',
  },
  {
    key: 'lms-student',
    pillar: 'academics',
    name: 'Learning management: the pupil’s experience',
    module: 'lms',
    summary:
      'Where a pupil reads the material, works through it and is marked on it — on ' +
      'the portal they already sign in to.',
    forWhom: 'Pupils, and the parents who want to see what was set.',
  },
  {
    key: 'e-learning',
    pillar: 'academics',
    name: 'Homework diary, study material & online classes',
    module: 'lms',
    summary:
      'A homework diary parents can see, downloadable study material, and live ' +
      'online classes hosted by the school rather than by a third party.',
    forWhom: 'Teachers setting work, and families keeping up with it.',
  },
  {
    key: 'events',
    pillar: 'academics',
    name: 'Events & activity calendar',
    module: 'event_mgmt',
    summary:
      'School events beside the holidays already on the calendar — sports days, ' +
      'parents’ evenings, trips — each with the audience it is for.',
    forWhom: 'The office running the event, and every family attending it.',
  },
  {
    key: 'documents',
    pillar: 'people_ops',
    name: 'Certificates & the ID card designer',
    summary:
      'School-issued documents generated from records already held — leaving ' +
      'certificates, character certificates — and a designer for pupil and staff ' +
      'ID cards.',
    forWhom: 'The office, which types these by hand today.',
  },
  {
    key: 'digital-payments',
    pillar: 'finance',
    name: 'Digital payments & the parent wallet',
    summary:
      'JazzCash and Easypaisa against a voucher, and a parent balance that carries ' +
      'a credit forward — posting to the same append-only ledger.',
    forWhom:
      'Parents paying from a phone, and the fee counter that no longer has to count it.',
  },
  {
    key: 'staff-loans',
    pillar: 'finance',
    name: 'Staff loans & advances',
    summary:
      'Loans and advances, with instalment recovery scheduled against the payroll ' +
      'and the balance derived from the instalments rather than stored.',
    forWhom: 'HR and accounts, and the member of staff who asks eleven months later.',
  },
  {
    key: 'reminder-sequences',
    pillar: 'finance',
    name: 'Automated fee reminder sequences',
    summary:
      'First notice, second notice and escalation, sent on a schedule to the ' +
      'families who are behind, instead of a clerk deciding each week.',
    forWhom: 'The fee office, and the head who wants collection to be a process.',
  },
  {
    key: 'message-templates',
    pillar: 'people_ops',
    name: 'Message templates with merge tags',
    summary:
      'Reusable notice and reminder templates, editable per school, whose merge ' +
      'tags resolve against the same audience data the sender reads.',
    forWhom: 'Whoever writes the same message every month.',
  },
  {
    key: 'pos',
    pillar: 'finance',
    name: 'Point of sale, inventory & merchandise',
    summary:
      'Uniforms, books and stationery sold across a counter, with stock behind ' +
      'them and every sale posting to the ledger.',
    forWhom: 'Schools that run a shop, and the accountant who reconciles it.',
  },
  {
    key: 'transport',
    pillar: 'people_ops',
    name: 'Transport management',
    module: 'transport',
    summary:
      'Routes, vehicles, stops and the pupils on each — with transport fees billed ' +
      'through the fee module that already exists.',
    forWhom: 'Schools running their own buses, and the parents on a route.',
  },
  {
    key: 'library',
    pillar: 'people_ops',
    name: 'Library management',
    module: 'library',
    summary:
      'A catalogue, issue and return, and what a pupil or member of staff ' +
      'currently holds.',
    forWhom: 'The librarian, and anybody who has lost a book.',
  },
  {
    key: 'hostel',
    pillar: 'people_ops',
    name: 'Hostel management',
    module: 'hostel',
    summary:
      'Rooms, allocations and the boarders in them, with hostel charges billed ' +
      'through the fee module.',
    forWhom: 'Boarding schools, and the warden who keeps the list.',
  },
  {
    key: 'biometric',
    pillar: 'people_ops',
    name: 'Biometric device integration',
    summary:
      'Fingerprint and face devices feeding the staff register directly, so ' +
      'attendance is captured rather than entered.',
    forWhom:
      'Schools that already own the hardware, and the HR office that rekeys it today.',
  },
  {
    key: 'gate-attendance',
    pillar: 'people_ops',
    name: 'Gate attendance',
    summary:
      'A scan at the gate on arrival and departure, against the pupil ID card the ' +
      'school issues, notifying the family.',
    forWhom: 'Parents who want to know their child arrived, and the office at the gate.',
  },
  {
    key: 'mobile-app',
    pillar: 'people_ops',
    name: 'Cross-platform mobile app',
    summary:
      'The portals packaged as a native app for Android and iOS, over the same ' +
      'screens the web already serves.',
    forWhom: 'Parents and teachers who expect to find a school in an app store.',
  },
  {
    key: 'language',
    pillar: 'people_ops',
    name: 'Per-school language, including right-to-left',
    summary:
      'Every screen in the school’s chosen language, with a layout that works in ' +
      'both directions.',
    forWhom: 'Schools that do not run in English, and the parents reading a voucher.',
  },
  {
    key: 'saas-billing',
    pillar: 'platform',
    name: 'Subscription billing',
    summary:
      'What each school is on, what it owes, and what happens when it stops ' +
      'paying — handled by the platform rather than by hand.',
    forWhom: 'The platform operator.',
  },
  {
    key: 'public-api',
    pillar: 'platform',
    name: 'Integrations, webhooks & a public API',
    summary:
      'A documented API and outbound webhooks, so a school’s other systems can ' +
      'read from here and be told when something happens.',
    forWhom: 'Schools with an existing system, and whoever integrates it.',
  },
  {
    key: 'security-hardening',
    pillar: 'platform',
    name: 'Security audit & hardening',
    summary:
      'An audit of tenancy, sessions and storage across the whole surface, and the ' +
      'work that comes out of it.',
    forWhom: 'Every school on the platform, whether or not they ask.',
  },
  {
    key: 'performance',
    pillar: 'platform',
    name: 'Performance',
    summary:
      'Query and payload work across the heaviest screens, measured against a real ' +
      'origin rather than a development machine.',
    forWhom: 'Everybody on a phone, on a slow connection.',
  },
];

/* -----------------------------------------------------------------------------
 * Glossary
 * -------------------------------------------------------------------------- */

/**
 * Builds a module glossary definition from the module catalogue itself, so the
 * term carries the module's real label rather than a copy of it.
 */
function moduleDefinition(key: PlatformModuleKey, rest: string): string {
  return `The \`${key}\` module — “${moduleLabel(key)}”. ${rest}`;
}

export const GLOSSARY: readonly GlossaryTerm[] = [
  /* Pillars */
  {
    key: 'pillar-academics',
    term: 'Academics & Learning',
    category: 'Pillar',
    definition:
      'The pillar covering the timetable, the register, exams, marks, report ' +
      'cards, promotions, lesson plans, cover and the school calendar.',
  },
  {
    key: 'pillar-finance',
    term: 'Finance',
    category: 'Pillar',
    definition:
      'The pillar covering admissions, pupil records, fees, concessions, aged ' +
      'debt and the accounting ledger.',
  },
  {
    key: 'pillar-people-ops',
    term: 'People & Operations',
    category: 'Pillar',
    definition:
      'The pillar covering users and permissions, campuses, staff, leave, ' +
      'payroll, performance, chat, announcements and reporting.',
  },
  {
    key: 'pillar-platform',
    term: 'Platform',
    category: 'Pillar',
    definition:
      'Not a pillar, and not sold as one. What the operator does above the ' +
      'tenants: provisioning, module switches, branding, support access, the ' +
      'feedback queue.',
  },

  /* Modules */
  {
    key: 'module',
    term: 'Module',
    category: 'Module',
    definition:
      'A slice of functionality a school can be switched on or off ' +
      'independently. There are twelve. `lib/platform-modules.ts` is the single ' +
      'source of truth, and the database CHECK constraint derives from it.',
  },
  {
    key: 'module-flag',
    term: 'Module flag',
    category: 'Module',
    definition:
      'One row in `school_modules` saying whether one module is on for one ' +
      'school. A module with no row is off.',
  },
  {
    key: 'module-admissions',
    term: 'Admissions & Enrollment',
    category: 'Module',
    definition: moduleDefinition(
      'admissions',
      'The public application form, the applications queue and the enrollment flow.',
    ),
  },
  {
    key: 'module-fees',
    term: 'Fee Management',
    category: 'Module',
    definition: moduleDefinition(
      'fee_management',
      'Fee types, structures, vouchers, payments, concessions and aged debt.',
    ),
  },
  {
    key: 'module-academics',
    term: 'Academics & Timetable',
    category: 'Module',
    definition: moduleDefinition(
      'academics',
      'Subjects, period structures, the timetable, the register, exams and ' +
        'results. Exams are not a flag of their own — they ship inside this one.',
    ),
  },
  {
    key: 'module-chat',
    term: 'Chat & Messaging',
    category: 'Module',
    definition: moduleDefinition(
      'chat',
      'Internal messaging. Gated because not every school is ready to let ' +
        'parents and pupils write back.',
    ),
  },
  {
    key: 'module-hr',
    term: 'HR & Payroll',
    category: 'Module',
    definition: moduleDefinition(
      'hr_payroll',
      'Staff records, salary components, leave, the staff register and payroll runs.',
    ),
  },
  {
    key: 'module-accounts',
    term: 'Accounts & Finance',
    category: 'Module',
    definition: moduleDefinition(
      'accounts',
      'The double-entry ledger, the day book, expenses and the financial statements.',
    ),
  },
  {
    key: 'module-kpis',
    term: 'Staff KPIs & Performance',
    category: 'Module',
    definition: moduleDefinition(
      'staff_kpis',
      'KPIs per role, monthly and annual ratings, one overall figure per member ' +
        'of staff.',
    ),
  },

  /* Roles */
  {
    key: 'role',
    term: 'Role',
    category: 'Role',
    definition:
      'One of twelve values on a person’s membership of a school. It decides ' +
      'which portal shell they land in; what they may do inside it is the ' +
      'permission matrix, which is per school.',
  },
  {
    key: 'permission',
    term: 'Permission',
    category: 'Role',
    definition:
      'One named right, such as `fees.write`. Roles hold sets of them. Nothing ' +
      'resolves one key from another — holding `fees.write` does not imply ' +
      '`fees.admission`.',
  },
  {
    key: 'permission-matrix',
    term: 'Permission matrix',
    category: 'Role',
    definition:
      'The screen where a school grants or revokes a key for a role, over the ' +
      'defaults. Ten roles are configurable; pupils and parents are not, because ' +
      'nothing they reach is permission-gated.',
  },
  {
    key: 'default-permissions',
    term: 'Default permissions',
    category: 'Role',
    definition:
      'What every role holds before a school changes anything. Defined in code, ' +
      'so a new school works on day one without a single row of configuration.',
  },
  {
    key: 'branch-required-role',
    term: 'Branch-required role',
    category: 'Role',
    definition:
      'A role that cannot exist without a campus: branch administrator, teacher, ' +
      'pupil, parent. The other eight see the whole school unless they are scoped ' +
      'another way.',
  },
  {
    key: 'invitable-role',
    term: 'Invitable role',
    category: 'Role',
    definition:
      'A role a school administrator may hand out from the invite screen — ten of ' +
      'the twelve. Pupils and parents are made by the admissions flow instead.',
  },
  {
    key: 'chain-of-command',
    term: 'Chain of command',
    category: 'Role',
    definition:
      'Coordinator, section head, vice principal, principal. It decides who ' +
      'approves whose leave, who rates whom, and whose classes a substitute may be ' +
      'arranged for.',
  },
  {
    key: 'principal-scope',
    term: 'Principal scope',
    category: 'Role',
    definition:
      'What one head is answerable for: their campuses, or named grades. It ' +
      'narrows their pupils, registers, marks, payroll approvals and chat ' +
      'oversight consistently.',
  },
  {
    key: 'guardian',
    term: 'Guardian',
    category: 'Role',
    definition:
      'A person responsible for a pupil. The first one recorded must be father, ' +
      'mother or sibling; father and mother are each available once.',
  },

  /* Platform */
  {
    key: 'tenant',
    term: 'Tenant',
    category: 'Platform',
    definition:
      'One school. Every table carries its location id and every query filters on ' +
      'it, read from the verified session and never from a request body.',
  },
  {
    key: 'campus',
    term: 'Campus (branch)',
    category: 'Platform',
    definition:
      'One site of a school. Staff, pupils, calendars, exams and money are scoped ' +
      'to it; a school with one campus never has to think about it.',
  },
  {
    key: 'subdomain',
    term: 'Subdomain',
    category: 'Platform',
    definition:
      'The school’s own web address on the platform. Provisioned when the school ' +
      'is created, and the address its public application form lives on.',
  },
  {
    key: 'super-admin',
    term: 'Super Admin',
    category: 'Platform',
    definition:
      'The platform operator. Cross-tenant, with no school of its own, on a ' +
      'deliberately uncoloured surface so it is never mistaken for a school’s ' +
      'portal.',
  },
  {
    key: 'school-user',
    term: 'School user',
    category: 'Platform',
    definition:
      'A person’s membership of one school: their role, their campus, whether they ' +
      'are active. Read on every request, which is what makes deactivation immediate.',
  },
  {
    key: 'voucher',
    term: 'Voucher (challan)',
    category: 'Platform',
    definition:
      'One bill, for one pupil or one family, with its own number from a ' +
      'per-school series. Part payments are ordinary.',
  },
  {
    key: 'ledger',
    term: 'Ledger',
    category: 'Platform',
    definition:
      'The school’s books. Append-only: nothing updates or deletes an entry, and a ' +
      'correction is a reversing entry with both sides kept.',
  },
  {
    key: 'double-entry',
    term: 'Double entry',
    category: 'Platform',
    definition:
      'Every transaction has debits equal to credits, in whole paise — enforced in ' +
      'the poster, in the browser and in the database.',
  },
  {
    key: 'paise',
    term: 'Paise',
    category: 'Platform',
    definition:
      'Money is whole paise as an integer everywhere in code, and NUMERIC in the ' +
      'database. No floating point, so no balance sheet out by four rupees.',
  },
  {
    key: 'cash-counter',
    term: 'Cash counter',
    category: 'Platform',
    definition:
      'A clerk’s own cash drawer. A cash payment lands in the drawer of whoever ' +
      'took it, and settling it is a separate right.',
  },
  {
    key: 'aging-bucket',
    term: 'Aging bucket',
    category: 'Platform',
    definition:
      'How long a debt has been owed: not yet due, 1–30, 31–60, 61–90, over 90 days.',
  },
  {
    key: 'concession',
    term: 'Concession',
    category: 'Platform',
    definition:
      'A reduction applied to a pupil’s fees — staff child, hardship, scholarship ' +
      '— as a named scheme rather than a hand-typed figure.',
  },
  {
    key: 'sibling-link',
    term: 'Sibling link',
    category: 'Platform',
    definition:
      'Two pupils are siblings when their guardian records share a CNIC. It is what ' +
      'makes the family voucher one voucher.',
  },
  {
    key: 'cnic',
    term: 'CNIC',
    category: 'Platform',
    definition:
      'The Pakistani national identity number. Canonicalised before it is stored, ' +
      'because the same number written two ways is two different people to every ' +
      'query. Always optional — no screen refuses a person for not having their ' +
      'card to hand.',
  },
  {
    key: 'admission-number',
    term: 'Admission number',
    category: 'Platform',
    definition:
      'The school’s own identifier for a pupil, from a per-school series. What the ' +
      'office searches on.',
  },
  {
    key: 'academic-year',
    term: 'Academic year',
    category: 'Platform',
    definition:
      'The year a school runs — per campus, where campuses differ. Enrollments, ' +
      'exam terms and promotions all hang off it.',
  },
  {
    key: 'exam-term',
    term: 'Exam term',
    category: 'Platform',
    definition:
      'A named assessment period inside an academic year — first term, mid-year — ' +
      'holding the exams under it and the term result that comes out.',
  },
  {
    key: 'grading-scheme',
    term: 'Grading scheme',
    category: 'Platform',
    definition:
      'The bands and descriptors a school turns marks into, defined per school. An ' +
      'O-Level ladder is one of them.',
  },
  {
    key: 'period-structure',
    term: 'Period structure',
    category: 'Platform',
    definition:
      'One bell schedule. A school keeps as many as it needs, and a class runs on ' +
      'the one its grade is assigned — so an infant timetable is never drawn ' +
      'against the senior school’s rows.',
  },
  {
    key: 'section',
    term: 'Section',
    category: 'Platform',
    definition:
      'One class within a grade — 5-A, 5-B. The unit the register, the timetable ' +
      'and the gradebook all work in.',
  },
  {
    key: 'chat-desk',
    term: 'Desk',
    category: 'Platform',
    definition:
      'An office rather than a person — the fee desk, the admissions desk. A parent ' +
      'writes to the desk, so the conversation survives the person leaving.',
  },
  {
    key: 'chat-grant',
    term: 'Grant',
    category: 'Platform',
    definition:
      'Permission to message a class, open for a fixed window and then closed ' +
      'again. A teacher may grant over their own sections only.',
  },
  {
    key: 'oversight',
    term: 'Oversight',
    category: 'Platform',
    definition:
      'A head reading the correspondence of the campuses or grades they are ' +
      'answerable for. It narrows sight and nothing else, and it is a permission ' +
      'the school can move.',
  },
  {
    key: 'announcement-audience',
    term: 'Announcement audience',
    category: 'Platform',
    definition:
      'Who a notice is for: by role, campus, grade or section. Resolved at send ' +
      'time, from the same data the portals read.',
  },
  {
    key: 'kpi',
    term: 'KPI',
    category: 'Platform',
    definition:
      'One measurable expectation of a role, defined by the school, rated monthly ' +
      'and rolled into a yearly overall.',
  },
  {
    key: 'print-sheet',
    term: 'Print sheet',
    category: 'Platform',
    definition:
      'How this product prints: a real page laid out for paper and printed by the ' +
      'browser. No PDF library and no headless browser, because the host cannot ' +
      'run one.',
  },
  {
    key: 'pwa',
    term: 'PWA',
    category: 'Platform',
    definition:
      'The installable web app. Added to a home screen from the browser, with an ' +
      'offline shell, and no app store in between.',
  },
  {
    key: 'web-push',
    term: 'Web push',
    category: 'Platform',
    definition:
      'A browser notification delivered to a subscribed device, per person per ' +
      'device, revocable by the person who allowed it.',
  },
  {
    key: 'smtp',
    term: 'SMTP',
    category: 'Platform',
    definition:
      'The school’s own outbound mail account. Email is how this product talks to ' +
      'people; it is not a module and a school cannot switch it off.',
  },
  {
    key: 'palette',
    term: 'Palette',
    category: 'Platform',
    definition:
      'The school’s five colours. Every surface, badge and chart colour in the ' +
      'portal is derived from them, and contrast-checked.',
  },
  {
    key: 'feedback-queue',
    term: 'Feedback queue',
    category: 'Platform',
    definition:
      'One cross-school queue of what schools have told us. A status change emails ' +
      'the school that reported it.',
  },

  /* GoHighLevel */
  {
    key: 'ghl',
    term: 'GoHighLevel (GHL)',
    category: 'GoHighLevel',
    definition:
      'A third-party CRM some schools already use. Here it is an optional, ' +
      'per-school integration — not a requirement, and not the tenant key.',
  },
  {
    key: 'ghl-sub-account',
    term: 'GHL sub-account',
    category: 'GoHighLevel',
    definition:
      'The school’s own account inside GoHighLevel. A school without one works ' +
      'fully and loses nothing; that is normal, not an error.',
  },
  {
    key: 'ghl-location-id',
    term: 'GHL Location ID',
    category: 'GoHighLevel',
    definition:
      'The identifier of a school’s GHL sub-account, stored on the school record. ' +
      'Connected means that column is set — there is deliberately no second flag ' +
      'beside it that could disagree.',
  },
  {
    key: 'contact-sync',
    term: 'Contact sync',
    category: 'GoHighLevel',
    definition:
      'What the integration does, and all it does: a pupil and their primary ' +
      'guardian are mirrored into the school’s sub-account on enrollment. Nothing ' +
      'on this platform sends messages through GoHighLevel.',
  },
];

export const GLOSSARY_CATEGORIES: readonly GlossaryCategory[] = [
  'Pillar',
  'Module',
  'Role',
  'Platform',
  'GoHighLevel',
];

/* -----------------------------------------------------------------------------
 * Derivations and lookups
 * -------------------------------------------------------------------------- */

export function featuresForPillar(pillar: PillarKey): readonly FeatureEntry[] {
  return PRODUCT_FEATURES.filter((feature) => feature.pillar === pillar);
}

export function roadmapForPillar(pillar: PillarKey): readonly RoadmapEntry[] {
  return ROADMAP_ITEMS.filter((item) => item.pillar === pillar);
}

export function featureByKey(key: string): FeatureEntry | undefined {
  return PRODUCT_FEATURES.find((feature) => feature.key === key);
}

export function glossaryTerm(key: string): GlossaryTerm | undefined {
  return GLOSSARY.find((term) => term.key === key);
}

/**
 * A key whose action is `read`.
 *
 * Used for one thing only: telling "holds the read key and nothing else" apart
 * from "holds some of this". A role with `exams.read` alone is read-only on
 * exams; a role with `exams.read` and `exams.write` but not `exams.publish` is
 * partial. The distinction matters on a tab somebody sells from, because
 * "Partial" against a head who can only look is a claim.
 */
function isReadShaped(permission: Permission): boolean {
  return permission.endsWith('.read');
}

export interface RoleAccess {
  level: AccessLevel;
  /** The feature's keys this role holds by default. */
  held: readonly Permission[];
  /** The feature's keys this role does not hold. */
  missing: readonly Permission[];
  /** Set when the role reaches this through their own portal. */
  portalNote?: string;
  /** Set when the entry records a caveat for this role. */
  limitation?: string;
}

/**
 * How one role reaches one feature, derived from `DEFAULT_ROLE_PERMISSIONS`.
 *
 * ── Derived, never written down ──────────────────────────────────────────
 * This is the whole reason the Features tab can be trusted. A hand-maintained
 * matrix is a second opinion about the product's access rules and it is always
 * the stale one; this reads the same record the portal resolves against, so
 * changing a default changes the tab in the same commit.
 *
 * What it shows is the **default**. A school that has overridden a key on its
 * own permissions matrix holds something different, and saying so on a
 * cross-tenant tab would need a tenant this page deliberately does not have.
 */
export function roleAccessDetail(feature: FeatureEntry, role: UserRole): RoleAccess {
  const defaults = DEFAULT_ROLE_PERMISSIONS[role];
  const held = feature.permissions.filter((permission) => defaults.includes(permission));
  const missing = feature.permissions.filter(
    (permission) => !defaults.includes(permission),
  );
  const portalNote = feature.portalAccess?.[role];
  const limitation = feature.limitations?.[role];

  const base: Omit<RoleAccess, 'level'> = {
    held,
    missing,
    ...(portalNote === undefined ? {} : { portalNote }),
    ...(limitation === undefined ? {} : { limitation }),
  };

  if (held.length === 0) {
    return { ...base, level: portalNote === undefined ? 'none' : 'own' };
  }

  if (missing.length === 0) return { ...base, level: 'full' };

  const everythingHeldIsARead = held.every(isReadShaped);
  const somethingMissingIsNotARead = missing.some(
    (permission) => !isReadShaped(permission),
  );

  return {
    ...base,
    level: everythingHeldIsARead && somethingMissingIsNotARead ? 'read-only' : 'partial',
  };
}

/** The whole row for one feature, in `USER_ROLES` order. */
export function roleAccessForFeature(
  feature: FeatureEntry,
): Record<UserRole, AccessLevel> {
  const matrix = {} as Record<UserRole, AccessLevel>;
  for (const role of USER_ROLES) {
    matrix[role] = roleAccessDetail(feature, role).level;
  }
  return matrix;
}

/** Whether a role reaches this feature at all — what the role filter narrows on. */
export function roleReachesFeature(feature: FeatureEntry, role: UserRole): boolean {
  return roleAccessDetail(feature, role).level !== 'none';
}

/**
 * True when no school role reaches this at all.
 *
 * Every Platform entry answers yes, and the card says so in one line rather
 * than drawing twelve chips all reading "None" — which is a wall of negatives
 * that has to be read to learn one fact.
 */
export function isOperatorOnly(feature: FeatureEntry): boolean {
  return USER_ROLES.every((role) => !roleReachesFeature(feature, role));
}

/* -----------------------------------------------------------------------------
 * Search
 * -------------------------------------------------------------------------- */

export interface CatalogueSearchResult {
  features: readonly FeatureEntry[];
  roadmap: readonly RoadmapEntry[];
  roles: readonly RoleProfile[];
  glossary: readonly GlossaryTerm[];
}

function normalise(value: string): string {
  return value.toLowerCase().trim();
}

function featureHaystack(feature: FeatureEntry): string {
  return normalise(
    [
      feature.name,
      feature.summary,
      feature.salesLine,
      PILLAR_LABELS[feature.pillar],
      feature.module === null ? '' : moduleLabel(feature.module),
      ...feature.capabilities,
      ...feature.routes,
      ...feature.permissions,
      ...feature.permissions.map((permission) => PERMISSION_LABELS[permission]),
      ...Object.values(feature.portalAccess ?? {}),
      ...Object.values(feature.limitations ?? {}),
      /*
       * Role names, so "what can a coordinator do" finds the features a
       * coordinator is named on rather than finding nothing. Only the roles
       * that actually reach it — otherwise every role matches every feature and
       * the role words stop narrowing anything.
       */
      ...USER_ROLES.filter((role) => roleReachesFeature(feature, role)).map(
        (role) => ROLE_LABELS[role],
      ),
      ...(feature.glossary ?? []).map((key) => glossaryTerm(key)?.term ?? ''),
    ].join(' '),
  );
}

function roadmapHaystack(item: RoadmapEntry): string {
  return normalise(
    [
      item.name,
      item.summary,
      item.forWhom,
      PILLAR_LABELS[item.pillar],
      item.module === undefined ? '' : moduleLabel(item.module),
    ].join(' '),
  );
}

function roleHaystack(profile: RoleProfile): string {
  return normalise(
    [
      profile.label,
      profile.description,
      profile.portal,
      profile.homeRoute,
      ...profile.defaultView,
      ...profile.limitations,
    ].join(' '),
  );
}

function glossaryHaystack(term: GlossaryTerm): string {
  return normalise([term.term, term.definition, term.category].join(' '));
}

/**
 * Full-text search across everything on both tabs.
 *
 * Every word in the query must appear somewhere in the entry, so "teacher
 * attendance" narrows rather than widens. An OR search over a catalogue this
 * small returns most of it, which reads as a broken search box.
 */
export function searchCatalogue(query: string): CatalogueSearchResult {
  const words = normalise(query)
    .split(/\s+/)
    .filter((word) => word !== '');

  if (words.length === 0) {
    return {
      features: PRODUCT_FEATURES,
      roadmap: ROADMAP_ITEMS,
      roles: ROLE_PROFILES,
      glossary: GLOSSARY,
    };
  }

  const matches = (haystack: string): boolean =>
    words.every((word) => haystack.includes(word));

  return {
    features: PRODUCT_FEATURES.filter((feature) => matches(featureHaystack(feature))),
    roadmap: ROADMAP_ITEMS.filter((item) => matches(roadmapHaystack(item))),
    roles: ROLE_PROFILES.filter((profile) => matches(roleHaystack(profile))),
    glossary: GLOSSARY.filter((term) => matches(glossaryHaystack(term))),
  };
}

/* -----------------------------------------------------------------------------
 * Load-time safety
 *
 * The types above already refuse a module key that is not a `PlatformModuleKey`,
 * a permission that is not a `Permission`, a role that is not a `UserRole`, and
 * a `ROLE_PROFILE_BODIES` missing any of the twelve. What they cannot see is a
 * duplicated anchor id — two features sharing a `key` produce two elements with
 * the same `id`, and the quick-nav then scrolls to whichever the browser found
 * first, silently. So that one is checked at module load, where it fails during
 * the prerender rather than under somebody's cursor.
 * -------------------------------------------------------------------------- */

function assertUniqueKeys(label: string, keys: readonly string[]): void {
  const seen = new Set<string>();
  for (const key of keys) {
    if (seen.has(key)) {
      throw new Error(
        `product-catalogue: duplicate ${label} key "${key}". Anchor ids must be ` +
          'unique, or the quick-nav scrolls to the wrong entry.',
      );
    }
    seen.add(key);
  }
}

assertUniqueKeys(
  'feature',
  PRODUCT_FEATURES.map((feature) => feature.key),
);
assertUniqueKeys(
  'roadmap',
  ROADMAP_ITEMS.map((item) => item.key),
);
assertUniqueKeys(
  'glossary',
  GLOSSARY.map((term) => term.key),
);

/** Every glossary key a feature names must exist. A dead chip is a dead end. */
for (const feature of PRODUCT_FEATURES) {
  for (const key of feature.glossary ?? []) {
    if (glossaryTerm(key) === undefined) {
      throw new Error(
        `product-catalogue: feature "${feature.key}" names glossary term "${key}", ` +
          'which does not exist.',
      );
    }
  }
}
