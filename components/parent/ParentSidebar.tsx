import { PortalSidebar, type PortalNavItem } from '@/components/school/PortalSidebar';

/**
 * Parent portal navigation.
 *
 * Fees became real in Sprint 5. The rest stay placeholders until the Academics
 * module builds them.
 */
const ITEMS: readonly PortalNavItem[] = [
  { label: 'My Dashboard', href: '/parent' },
  { label: 'My Children', href: '/parent/children', placeholder: true },
  { label: 'Fees', href: '/parent/fees' },
  { label: 'Announcements', href: '/parent/announcements', placeholder: true },
];

export function ParentSidebar() {
  return <PortalSidebar items={ITEMS} ariaLabel="Parent navigation" />;
}
