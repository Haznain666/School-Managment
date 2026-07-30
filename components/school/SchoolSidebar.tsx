import { PortalSidebar, type PortalNavItem } from '@/components/school/PortalSidebar';
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
    { key: 'admissions', label: 'Admissions', href: '/dashboard/admissions' },
    { key: 'fee_management', label: 'Fee Management', href: '/dashboard/fees' },
    { key: 'academics', label: 'Academics', href: '/dashboard/academics' },
    { key: 'lms', label: 'LMS', href: '/dashboard/lms' },
    { key: 'hr_payroll', label: 'HR & Payroll', href: '/dashboard/hr' },
    { key: 'event_mgmt', label: 'Events', href: '/dashboard/events' },
  ];

  if (role === 'school_admin' || role === 'hr_manager' || role === 'accountant') {
    for (const entry of moduleNav) {
      if (moduleFlags[entry.key]) {
        items.push({ label: entry.label, href: entry.href, placeholder: true });
      }
    }
  }

  items.push({ label: 'Settings', href: '/dashboard/settings' });

  return <PortalSidebar items={items} ariaLabel="School administration navigation" />;
}
