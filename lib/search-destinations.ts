import type { PortalNavItem } from '@/components/school/PortalSidebar';

/**
 * The platform portal's screens, as a searchable list.
 *
 * The four school portals feed `searchPages` the navigation their shell already
 * built for that caller, which is what keeps a page result from ever naming a
 * screen the guard would bounce. The platform surface has no such per-caller
 * navigation — `SuperAdminSidebar` is a module-level constant in a `'use
 * client'` file, and every platform screen is open to the one identity that can
 * reach any of them — so the list is restated here rather than imported across
 * that boundary.
 *
 * It is four entries. When it stops being four, the right move is to lift
 * `SuperAdminSidebar`'s `NAV` into a shared server-safe module and delete this,
 * not to keep two lists of ten.
 */
export const PLATFORM_SEARCH_PAGES: readonly PortalNavItem[] = [
  { label: 'Dashboard', href: '/super-admin', icon: 'dashboard' },
  { label: 'Schools', href: '/super-admin/schools', icon: 'schools' },
  { label: 'Add School', href: '/super-admin/schools/new', icon: 'enroll' },
  { label: 'Modules', href: '/super-admin/modules', icon: 'modules' },
  { label: 'Feedback', href: '/super-admin/feedback', icon: 'feedback' },
];
