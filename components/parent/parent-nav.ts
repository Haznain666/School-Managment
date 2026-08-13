import type { PortalNavItem } from '@/components/school/PortalSidebar';

/**
 * Parent portal navigation.
 *
 * Fees is a real destination as of Sprint 5, attendance as of Sprint 6. What
 * remains a placeholder arrives in a later sprint.
 *
 * Data rather than a component since Sprint 10.5 — `PortalFrame` renders the
 * same list on desktop and inside the mobile drawer. Parents are the audience
 * most likely to be on a phone and this portal had no navigation at all below
 * 768px, so the drawer matters here more than anywhere else in the product.
 */
export const PARENT_NAV: readonly PortalNavItem[] = [
  { label: 'My Dashboard', href: '/parent', icon: 'dashboard' },
  { label: 'My Children', href: '/parent/children', icon: 'children', placeholder: true },
  { label: 'Attendance', href: '/parent/attendance', icon: 'attendance' },
  { label: 'Fees', href: '/parent/fees', icon: 'fees' },
  {
    label: 'Announcements',
    href: '/parent/announcements',
    icon: 'announcements',
    placeholder: true,
  },
];
