import { PortalSidebar, type PortalNavItem } from '@/components/school/PortalSidebar';

/**
 * Parent portal navigation.
 *
 * Fees is a real destination as of Sprint 5, attendance as of Sprint 6. What
 * remains a placeholder arrives in a later sprint.
 */
const ITEMS: readonly PortalNavItem[] = [
  { label: 'My Dashboard', href: '/parent' },
  { label: 'My Children', href: '/parent/children', placeholder: true },
  { label: 'Attendance', href: '/parent/attendance' },
  { label: 'Fees', href: '/parent/fees' },
  { label: 'Announcements', href: '/parent/announcements', placeholder: true },
];

export function ParentSidebar() {
  return <PortalSidebar items={ITEMS} ariaLabel="Parent navigation" />;
}
