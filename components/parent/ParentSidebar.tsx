import { PortalSidebar, type PortalNavItem } from '@/components/school/PortalSidebar';

/**
 * Parent portal navigation.
 *
 * Everything past the dashboard is marked as a placeholder — those destinations
 * arrive with the Academics and Fee Management modules in later sprints.
 */
const ITEMS: readonly PortalNavItem[] = [
  { label: 'My Dashboard', href: '/parent' },
  { label: 'My Children', href: '/parent/children', placeholder: true },
  { label: 'Fee Status', href: '/parent/fees', placeholder: true },
  { label: 'Announcements', href: '/parent/announcements', placeholder: true },
];

export function ParentSidebar() {
  return <PortalSidebar items={ITEMS} ariaLabel="Parent navigation" />;
}
