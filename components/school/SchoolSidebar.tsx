import {
  PortalSidebar,
  type PortalNavItem,
  type PortalNavSection,
} from '@/components/school/PortalSidebar';
import type { SchoolModuleFlags } from '@/lib/platform-modules';
import type { UserRole } from '@/types/school-auth';

export interface SchoolSidebarProps {
  role: UserRole;
  moduleFlags: SchoolModuleFlags;
}

/**
 * Administrative sidebar, assembled server-side from the caller's role and the
 * school's enabled modules.
 *
 * Modules the school has not enabled are omitted from the list rather than
 * shown disabled: an admin should not be advertised features their school has
 * not bought.
 */
export function SchoolSidebar({ role, moduleFlags }: SchoolSidebarProps) {
  const items: PortalNavItem[] = [{ label: 'Dashboard', href: '/dashboard' }];

  if (role === 'school_admin' || role === 'hr_manager') {
    items.push({ label: 'Users & Staff', href: '/dashboard/users' });
  }

  if (role === 'branch_admin') {
    items.push({ label: 'My Branch Staff', href: '/dashboard/users' });
  }

  if (role === 'school_admin') {
    items.push({ label: 'Branches', href: '/dashboard/branches', placeholder: true });
  }

  if (role === 'accountant') {
    items.push({ label: 'Finance', href: '/dashboard/finance', placeholder: true });
  }

  // Module-gated destinations. These land on placeholders until the relevant
  // sprint builds them, but they only appear at all once the module is on.
  const moduleNav: Array<{ key: keyof SchoolModuleFlags; label: string; href: string }> = [
    { key: 'lms', label: 'LMS', href: '/dashboard/lms' },
    { key: 'hr_payroll', label: 'HR & Payroll', href: '/dashboard/hr' },
    { key: 'event_mgmt', label: 'Events', href: '/dashboard/events' },
  ];

  const canSeeModules =
    role === 'school_admin' || role === 'hr_manager' || role === 'accountant';

  if (canSeeModules) {
    for (const entry of moduleNav) {
      if (moduleFlags[entry.key]) {
        items.push({ label: entry.label, href: entry.href, placeholder: true });
      }
    }
  }

  items.push({ label: 'Settings', href: '/dashboard/settings' });

  // Modules with real screens of their own get a section rather than a single
  // link. They are built, not placeholders — and like every module entry they
  // appear only once the school has them switched on.
  const sections: PortalNavSection[] = [];

  if (moduleFlags.admissions && (canSeeModules || role === 'branch_admin')) {
    sections.push({
      label: 'Admissions',
      items: [
        { label: 'Overview', href: '/dashboard/admissions' },
        { label: 'Academic Years', href: '/dashboard/admissions/academic-years' },
        { label: 'Grades & Sections', href: '/dashboard/admissions/grades' },
        { label: 'Enroll Student', href: '/dashboard/admissions/enroll' },
        { label: 'All Students', href: '/dashboard/admissions/students' },
        { label: 'Applications', href: '/dashboard/admissions/applications' },
      ],
    });
  }

  if (moduleFlags.academics && (canSeeModules || role === 'branch_admin')) {
    sections.push({
      label: 'Academics',
      items: [
        { label: 'Overview', href: '/dashboard/academics' },
        { label: 'Subjects', href: '/dashboard/academics/subjects' },
        { label: 'Timetable', href: '/dashboard/academics/timetable' },
        { label: 'Mark Attendance', href: '/dashboard/academics/attendance' },
        { label: 'Attendance Reports', href: '/dashboard/academics/attendance/reports' },
      ],
    });
  }

  // Fees is gated on the module *and* on the role: a teacher never sees it,
  // and a branch admin sees it scoped to their own branch's grades.
  if (moduleFlags.fee_management && (canSeeModules || role === 'branch_admin')) {
    sections.push({
      label: 'Fees',
      items: [
        { label: 'Overview', href: '/dashboard/fees' },
        { label: 'Fee Structure', href: '/dashboard/fees/types' },
        { label: 'Challans', href: '/dashboard/fees/challans' },
        { label: 'Reports', href: '/dashboard/fees/reports' },
        { label: 'Settings', href: '/dashboard/fees/settings' },
      ],
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
