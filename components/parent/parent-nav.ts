import type { PortalNavItem } from '@/components/school/PortalSidebar';

/**
 * Parent portal navigation.
 *
 * Fees is a real destination as of Sprint 5, attendance as of Sprint 6,
 * announcements as of Sprint 11. What remains a placeholder arrives in a later
 * sprint.
 *
 * Data rather than a component since Sprint 10.5 — `PortalFrame` renders the
 * same list on desktop and inside the mobile drawer. Parents are the audience
 * most likely to be on a phone and this portal had no navigation at all below
 * 768px, so the drawer matters here more than anywhere else in the product.
 */
/**
 * Built per request rather than held as a constant, because the announcements
 * entry carries an unread count. A badge that showed a number from build time
 * would be worse than no badge — it would be a number that never changed.
 */
/**
 * ── `chatEnabled` — Sprint 26 ────────────────────────────────────────────
 * The `chat` module flag now gates this entry, as it has always gated the
 * administrative sidebar's. Before Sprint 26 it gated only that one, which had
 * two consequences and both were defects: an administrator whose school had
 * never had the flag set saw no Messages link while every teacher, parent and
 * pupil at the same school did, and a school that switched Chat off kept a full
 * inbox on three of its four portals. The flag means one thing now — chat is on
 * here, or it is on nowhere.
 *
 * The page behind the link enforces it too. A link is not a permission.
 */
export function parentNav(
  unreadNotices = 0,
  unreadChats = 0,
  chatEnabled = true,
): PortalNavItem[] {
  return [
    { label: 'My Dashboard', href: '/parent', icon: 'dashboard' },
    { label: 'My Children', href: '/parent/children', icon: 'children' },
    { label: 'Attendance', href: '/parent/attendance', icon: 'attendance' },
    { label: 'Results', href: '/parent/results', icon: 'marks' },
    { label: 'Fees', href: '/parent/fees', icon: 'fees' },
    ...(chatEnabled
      ? ([
          {
            label: 'Messages',
            href: '/parent/chat',
            icon: 'chat',
            ...(unreadChats > 0 ? { badge: unreadChats } : {}),
          },
        ] satisfies PortalNavItem[])
      : []),
    {
      label: 'Announcements',
      href: '/parent/announcements',
      icon: 'announcements',
      // Omitted rather than passed as 0: `PortalNavItem` says so, and a badge
      // reading "0" is a notification that there is nothing to notify about.
      ...(unreadNotices > 0 ? { badge: unreadNotices } : {}),
    },
    { label: 'Settings', href: '/parent/settings', icon: 'settings' },
  ];
}
