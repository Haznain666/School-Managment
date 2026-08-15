import type { PortalNavItem } from '@/components/school/PortalSidebar';

/**
 * Student portal navigation.
 *
 * The timetable is a real destination as of Sprint 6. What remains a
 * placeholder arrives with a later sprint.
 *
 * Data rather than a component since Sprint 10.5 — `PortalFrame` renders the
 * same list on desktop and inside the mobile drawer. That matters most here:
 * students are the audience least likely to own a desktop, and this portal had
 * no navigation at all below 768px.
 */
/** Built per request: the announcements entry carries an unread count. */
export function studentNav(unreadNotices = 0): PortalNavItem[] {
  return [
    { label: 'My Dashboard', href: '/student', icon: 'dashboard' },
    { label: 'My Timetable', href: '/student/timetable', icon: 'timetable' },
    { label: 'My Classes', href: '/student/classes', icon: 'academics', placeholder: true },
    { label: 'My Grades', href: '/student/grades', icon: 'marks', placeholder: true },
    { label: 'Fee Status', href: '/student/fees', icon: 'fees', placeholder: true },
    {
      label: 'Announcements',
      href: '/student/announcements',
      icon: 'announcements',
      ...(unreadNotices > 0 ? { badge: unreadNotices } : {}),
    },
  ];
}
