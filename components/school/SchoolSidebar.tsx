import {
  PortalSidebar,
  type PortalNavItem,
  type PortalNavSection,
} from '@/components/school/PortalSidebar';
import type { Permission } from '@/lib/permissions';
import type { SchoolModuleFlags } from '@/lib/platform-modules';
import type { UserRole } from '@/types/school-auth';

export interface SchoolSidebarProps {
  role: UserRole;
  /** Resolved against this school's own matrix by the portal shell. */
  permissions: readonly Permission[];
  moduleFlags: SchoolModuleFlags;
}

/**
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
export function SchoolSidebar({ role, permissions, moduleFlags }: SchoolSidebarProps) {
  const can = (permission: Permission): boolean => permissions.includes(permission);

  const items: PortalNavItem[] = [{ label: 'Dashboard', href: '/dashboard' }];

  if (can('users.read')) {
    items.push({
      // A branch admin sees only their own branch's people, and saying so is
      // more useful than a generic label they will misread as the whole school.
      label: role === 'branch_admin' ? 'My Branch Staff' : 'Users & Staff',
      href: '/dashboard/users',
    });
  }

  if (role === 'school_admin') {
    items.push({ label: 'Branches', href: '/dashboard/branches', placeholder: true });
  }

  if (can('fees.write') && role === 'accountant') {
    items.push({ label: 'Finance', href: '/dashboard/finance', placeholder: true });
  }

  // Module-gated destinations that land on placeholders until the relevant
  // sprint builds them. They appear only once the module is on.
  const moduleNav: Array<{ key: keyof SchoolModuleFlags; label: string; href: string }> = [
    { key: 'lms', label: 'LMS', href: '/dashboard/lms' },
    { key: 'event_mgmt', label: 'Events', href: '/dashboard/events' },
  ];

  for (const entry of moduleNav) {
    if (moduleFlags[entry.key] && can('academics.read')) {
      items.push({ label: entry.label, href: entry.href, placeholder: true });
    }
  }

  items.push({ label: 'Settings', href: '/dashboard/settings' });

  // Modules with real screens of their own get a section rather than a single
  // link. They are built, not placeholders.
  const sections: PortalNavSection[] = [];

  if (moduleFlags.admissions && can('admissions.read')) {
    sections.push({
      label: 'Admissions',
      items: [
        { label: 'Overview', href: '/dashboard/admissions' },
        { label: 'Academic Years', href: '/dashboard/admissions/academic-years' },
        { label: 'Grades & Sections', href: '/dashboard/admissions/grades' },
        ...(can('admissions.write')
          ? [{ label: 'Enroll Student', href: '/dashboard/admissions/enroll' }]
          : []),
        { label: 'All Students', href: '/dashboard/admissions/students' },
        { label: 'Applications', href: '/dashboard/admissions/applications' },
      ],
    });
  }

  if (moduleFlags.academics && can('academics.read')) {
    sections.push({
      label: 'Academics',
      items: [
        { label: 'Overview', href: '/dashboard/academics' },
        { label: 'Subjects', href: '/dashboard/academics/subjects' },
        { label: 'Timetable', href: '/dashboard/academics/timetable' },
        ...(can('attendance.mark')
          ? [{ label: 'Mark Attendance', href: '/dashboard/academics/attendance' }]
          : []),
        { label: 'Attendance Reports', href: '/dashboard/academics/attendance/reports' },
      ],
    });
  }

  // Exams live under the Academics module rather than one of their own — see
  // `dashboard/exams/layout.tsx` for why. The section is gated on `exams.read`,
  // which is the permission that layout enforces.
  if (moduleFlags.academics && can('exams.read')) {
    sections.push({
      label: 'Exams',
      items: [
        { label: 'Terms & Exams', href: '/dashboard/exams' },
        { label: 'Report Cards', href: '/dashboard/exams/report-cards' },
        { label: 'Grading Schemes', href: '/dashboard/exams/grading' },
      ],
    });
  }

  if (moduleFlags.fee_management && can('fees.read')) {
    sections.push({
      label: 'Fees',
      items: [
        { label: 'Overview', href: '/dashboard/fees' },
        { label: 'Fee Structure', href: '/dashboard/fees/types' },
        { label: 'Challans', href: '/dashboard/fees/challans' },
        { label: 'Reports', href: '/dashboard/fees/reports' },
        ...(can('fees.write')
          ? [{ label: 'Settings', href: '/dashboard/fees/settings' }]
          : []),
      ],
    });
  }

  if (moduleFlags.hr_payroll && can('hr.read')) {
    sections.push({
      label: 'HR',
      items: [
        { label: 'Overview', href: '/dashboard/hr' },
        { label: 'Staff', href: '/dashboard/hr/staff' },
        { label: 'Salary Components', href: '/dashboard/hr/salary-components' },
        { label: 'Leave', href: '/dashboard/hr/leave' },
        { label: 'Staff Register', href: '/dashboard/hr/attendance' },
      ],
    });
  }

  if (moduleFlags.hr_payroll && can('payroll.read')) {
    sections.push({
      label: 'Payroll',
      items: [{ label: 'Payroll Runs', href: '/dashboard/payroll' }],
    });
  }

  return (
    <PortalSidebar
      items={items}
      sections={sections}
      ariaLabel="School administration navigation"
    />
  );
}
