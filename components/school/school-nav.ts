import type {
  PortalNavItem,
  PortalNavSection,
} from '@/components/school/PortalSidebar';
import type { Permission } from '@/lib/permissions';
import { REPORTS } from '@/lib/report-catalogue';
import type { SchoolModuleFlags } from '@/lib/platform-modules';
import type { UserRole } from '@/types/school-auth';

export interface SchoolNavProps {
  role: UserRole;
  /** Resolved against this school's own matrix by the portal shell. */
  permissions: readonly Permission[];
  moduleFlags: SchoolModuleFlags;
}

/**
 * The administrative portal's navigation, assembled server-side from the
 * caller's permissions and the school's enabled modules.
 *
 * Sprint 10.5 turned this from a component into a function returning data. It
 * has to be data now because `PortalFrame` renders the same list twice — inline
 * on desktop, in a drawer on mobile — and a component can only be in one place.
 * The gating below is unchanged and still runs on the server, which is why
 * icons are named by string: see `components/school/nav-icons.ts`.
 *
 * (Original notes, still true.)
 *
 * Administrative sidebar, assembled server-side from the caller's permissions
 * and the school's enabled modules.
 *
 * Two independent gates, and they answer different questions. Modules the
 * school has not enabled are omitted because the school has not bought them.
 * Sections the caller cannot open are omitted because their role does not hold
 * the permission — and since Sprint 8 that is per school, so the same role can
 * see different things at two different schools running this same build.
 *
 * Every entry below is gated on the *read* permission its layout enforces, so
 * a link in this sidebar never leads somewhere the guard will bounce. Write
 * permissions decide what appears on the page, not what appears here.
 */
export function schoolNav({ role, permissions, moduleFlags }: SchoolNavProps): {
  items: PortalNavItem[];
  sections: PortalNavSection[];
} {
  const can = (permission: Permission): boolean => permissions.includes(permission);

  const items: PortalNavItem[] = [{ label: 'Dashboard', href: '/dashboard', icon: 'dashboard' }];

  if (can('users.read')) {
    items.push({
      // A branch admin sees only their own branch's people, and saying so is
      // more useful than a generic label they will misread as the whole school.
      label: role === 'branch_admin' ? 'My Branch Staff' : 'Users & Staff',
      href: '/dashboard/users',
      icon: 'users',
    });
  }

  // No longer a placeholder: a school creates and lists its own campuses since
  // the invite flow began depending on one existing. Gated on `settings.read`
  // like every other school-level configuration screen, which by default is
  // every administrative role — creating is separately gated on
  // `settings.write` by the page and the route.
  if (can('settings.read')) {
    items.push({ label: 'Branches', href: '/dashboard/branches', icon: 'branches' });
  }

  // Module-gated destinations that land on placeholders until the relevant
  // sprint builds them. They appear only once the module is on.
  const moduleNav: Array<{
    key: keyof SchoolModuleFlags;
    label: string;
    href: string;
    icon: PortalNavItem['icon'];
  }> = [
    { key: 'lms', label: 'LMS', href: '/dashboard/lms', icon: 'lms' },
    { key: 'event_mgmt', label: 'Events', href: '/dashboard/events', icon: 'events' },
  ];

  for (const entry of moduleNav) {
    if (moduleFlags[entry.key] && can('academics.read')) {
      items.push({
        label: entry.label,
        href: entry.href,
        icon: entry.icon,
        placeholder: true,
      });
    }
  }

  // Communications is a single destination rather than a section: one screen
  // writes, sends and reports, and a section with one child is a folder.
  //
  // Not module-gated. Every school tells people things, and there is no
  // `school_modules` flag that means "does not communicate".
  if (can('comms.read')) {
    items.push({
      label: 'Communications',
      href: '/dashboard/communications',
      icon: 'announcements',
    });
  }

  // Reports is a single destination for the same reason Communications is: one
  // index leads to all nine, and a section holding one link is a folder.
  //
  // Gated on holding *any* of the nine report permissions rather than on one
  // key — each report carries the permission of the screen its data comes from
  // (see `lib/report-catalogue.ts`), so an accountant reaches the financial
  // ones and a coordinator the academic ones. Somebody with none of them never
  // sees the link, which is what makes the index's empty state rare rather
  // than routine.
  if (REPORTS.some((report) => can(report.permission))) {
    items.push({ label: 'Reports', href: '/dashboard/reports', icon: 'reports' });
  }

  items.push({ label: 'Settings', href: '/dashboard/settings', icon: 'settings' });

  // Modules with real screens of their own get a section rather than a single
  // link. They are built, not placeholders.
  const sections: PortalNavSection[] = [];

  if (moduleFlags.admissions && can('admissions.read')) {
    sections.push({
      label: 'Admissions',
      icon: 'admissions',
      items: [
        { label: 'Overview', href: '/dashboard/admissions', icon: 'dashboard' },
        { label: 'Academic Years', href: '/dashboard/admissions/academic-years', icon: 'academicYears' },
        { label: 'Grades & Sections', href: '/dashboard/admissions/grades', icon: 'grades' },
        ...(can('admissions.write')
          ? ([{ label: 'Enroll Student', href: '/dashboard/admissions/enroll', icon: 'enroll' }] satisfies PortalNavItem[])
          : []),
        // Gated on its own key, not on `admissions.write`: enrolling one child
        // and loading eight hundred are different-sized mistakes, which is why
        // Sprint 10 gave the import a permission of its own.
        ...(can('students.import')
          ? ([{ label: 'Import Students', href: '/dashboard/admissions/import', icon: 'import' }] satisfies PortalNavItem[])
          : []),
        ...(can('students.promote')
          ? ([{ label: 'Promote Students', href: '/dashboard/admissions/promote', icon: 'promote' }] satisfies PortalNavItem[])
          : []),
        { label: 'All Students', href: '/dashboard/admissions/students', icon: 'students' },
        { label: 'Applications', href: '/dashboard/admissions/applications', icon: 'applications' },
      ],
    });
  }

  if (moduleFlags.academics && can('academics.read')) {
    sections.push({
      label: 'Academics',
      icon: 'academics',
      items: [
        { label: 'Overview', href: '/dashboard/academics', icon: 'dashboard' },
        { label: 'Subjects', href: '/dashboard/academics/subjects', icon: 'subjects' },
        { label: 'Timetable', href: '/dashboard/academics/timetable', icon: 'timetable' },
        // Beside the timetable rather than under People: the question it
        // answers — is this teacher free on Thursday — is a timetable question,
        // and it is gated on the same permission.
        { label: 'Teacher Calendar', href: '/dashboard/academics/teacher-calendar', icon: 'timetable' },
        ...(can('attendance.mark')
          ? ([{ label: 'Mark Attendance', href: '/dashboard/academics/attendance', icon: 'attendance' }] satisfies PortalNavItem[])
          : []),
        { label: 'Attendance Reports', href: '/dashboard/academics/attendance/reports', icon: 'attendanceReports' },
      ],
    });
  }

  // Exams live under the Academics module rather than one of their own — see
  // `dashboard/exams/layout.tsx` for why. The section is gated on `exams.read`,
  // which is the permission that layout enforces.
  if (moduleFlags.academics && can('exams.read')) {
    sections.push({
      label: 'Exams',
      icon: 'exams',
      items: [
        { label: 'Terms & Exams', href: '/dashboard/exams', icon: 'exams' },
        {
          label: 'Terms & Datesheets',
          href: '/dashboard/exams/terms',
          icon: 'exams',
        },
        // Promotions is the only entry here gated on a second permission. The
        // rest of the section rides on `exams.read`, but deciding whether a
        // child moves up is not the same act as reading a datesheet — and the
        // page refuses anyone this hides it from, because a link is not a
        // permission.
        ...(can('results.promotion')
          ? [
              {
                label: 'Promotions',
                href: '/dashboard/exams/promotions',
                icon: 'reportCards' as const,
              },
            ]
          : []),
        {
          label: 'Promotion Criteria',
          href: '/dashboard/exams/criteria',
          icon: 'grading',
        },
        { label: 'Report Cards', href: '/dashboard/exams/report-cards', icon: 'reportCards' },
        { label: 'Grading Schemes', href: '/dashboard/exams/grading', icon: 'grading' },
        { label: 'Exam Settings', href: '/dashboard/exams/settings', icon: 'grading' },
      ],
    });
  }

  if (moduleFlags.fee_management && can('fees.read')) {
    sections.push({
      label: 'Fees',
      icon: 'fees',
      items: [
        { label: 'Overview', href: '/dashboard/fees', icon: 'dashboard' },
        { label: 'Fee Structure', href: '/dashboard/fees/types', icon: 'feeStructure' },
        { label: 'Challans', href: '/dashboard/fees/challans', icon: 'challans' },
        { label: 'Family Vouchers', href: '/dashboard/fees/family', icon: 'familyVouchers' },
        // Aged debt per student. Distinct from the Defaulters *tab* inside Fee
        // Reports, which is a per-challan chase list feeding the reminder
        // sender — see the page's docblock for why both exist.
        { label: 'Aged Debt', href: '/dashboard/fees/defaulters', icon: 'agedDebt' },
        { label: 'Reports', href: '/dashboard/fees/reports', icon: 'reports' },
        ...(can('fees.write')
          ? ([{ label: 'Settings', href: '/dashboard/fees/settings', icon: 'settings' }] satisfies PortalNavItem[])
          : []),
      ],
    });
  }

  if (moduleFlags.hr_payroll && can('hr.read')) {
    sections.push({
      label: 'HR',
      icon: 'hr',
      items: [
        { label: 'Overview', href: '/dashboard/hr', icon: 'dashboard' },
        { label: 'Staff', href: '/dashboard/hr/staff', icon: 'staff' },
        { label: 'Salary Components', href: '/dashboard/hr/salary-components', icon: 'salaryComponents' },
        { label: 'Leave', href: '/dashboard/hr/leave', icon: 'leave' },
        { label: 'Staff Register', href: '/dashboard/hr/attendance', icon: 'staffRegister' },
      ],
    });
  }

  if (moduleFlags.hr_payroll && can('payroll.read')) {
    sections.push({
      label: 'Payroll',
      icon: 'payroll',
      items: [{ label: 'Payroll Runs', href: '/dashboard/payroll', icon: 'payroll' }],
    });
  }

  // Sprint 13.5. This replaces the `Finance` placeholder that pointed at
  // `/dashboard/finance`, which never existed — it was shown to accountants
  // only, and led to a 404 for the one role most likely to click it.
  //
  // Module-gated on `accounts`, which is the flag `lib/platform-modules.ts`
  // has carried as "Accounts & Finance" since Sprint 2. `SPRINTS.md` §0.9 names
  // a new `accounting` flag; adding one would be a second switch for one
  // thing, plus a `school_modules` CHECK change, and a school with the old flag
  // on and the new one off would see the module vanish.
  //
  // Cash Counters is gated on `accounting.settle` rather than `read`: it is the
  // screen where somebody accepts a clerk's takings, and putting it in front of
  // the clerk themselves is the control this permission exists to keep.
  if (moduleFlags.accounts && can('accounting.read')) {
    sections.push({
      label: 'Accounting',
      icon: 'accounting',
      items: [
        { label: 'Overview', href: '/dashboard/accounting', icon: 'dashboard' },
        { label: 'Day Book', href: '/dashboard/accounting/day-book', icon: 'dayBook' },
        { label: 'Expenses', href: '/dashboard/accounting/expenses', icon: 'expenses' },
        ...(can('accounting.settle')
          ? ([
              {
                label: 'Cash Counters',
                href: '/dashboard/accounting/counters',
                icon: 'cashCounters',
              },
            ] satisfies PortalNavItem[])
          : []),
        {
          label: 'Chart of Accounts',
          href: '/dashboard/accounting/accounts',
          icon: 'chartOfAccounts',
        },
        ...(can('accounting.write')
          ? ([
              {
                label: 'Expense Categories',
                href: '/dashboard/accounting/categories',
                icon: 'settings',
              },
            ] satisfies PortalNavItem[])
          : []),
      ],
    });
  }

  /*
   * Feedback to the people who build this, and it is gated on nothing.
   *
   * Every other entry in this list is behind the read permission its own layout
   * enforces, which is right: those are the school's records and a school
   * decides who sees which. This is not a record — it is a person telling the
   * vendor that a screen is broken — and the only thing a permission could do
   * here is stop somebody reporting a bug. Last in the list because it is not
   * part of anybody's day, and always present because the day it is needed is
   * not a day to go looking for it.
   */
  items.push({ label: 'Feedback', href: '/dashboard/feedback', icon: 'feedback' });

  return { items, sections };
}
