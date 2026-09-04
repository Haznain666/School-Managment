import type { PortalNavItem } from '@/components/school/PortalSidebar';

/**
 * Student portal navigation.
 *
 * The timetable is a real destination as of Sprint 6; exams, results and fees
 * became ones in Sprint 13, which is what the three placeholders had been
 * standing in for.
 *
 * There is deliberately no assignment tracker here. `SPRINTS.md` gives the
 * homework diary to Sprint 19.5, there is no assignments table to read, and a
 * tracker invented now would be built twice — see `STATE.md` §5ac.
 *
 * Data rather than a component since Sprint 10.5 — `PortalFrame` renders the
 * same list on desktop and inside the mobile drawer. That matters most here:
 * students are the audience least likely to own a desktop, and this portal had
 * no navigation at all below 768px.
 */
/** Built per request: the announcements entry carries an unread count. */
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
export function studentNav(
  unreadNotices = 0,
  unreadChats = 0,
  chatEnabled = true,
): PortalNavItem[] {
  return [
    { label: 'My Dashboard', href: '/student', icon: 'dashboard' },
    { label: 'My Timetable', href: '/student/timetable', icon: 'timetable' },
    { label: 'My Exams', href: '/student/exams', icon: 'exams' },
    { label: 'My Results', href: '/student/results', icon: 'marks' },
    { label: 'Fee Status', href: '/student/fees', icon: 'fees' },
    ...(chatEnabled
      ? ([
          {
            label: 'Messages',
            href: '/student/chat',
            icon: 'chat',
            ...(unreadChats > 0 ? { badge: unreadChats } : {}),
          },
        ] satisfies PortalNavItem[])
      : []),
    {
      label: 'Announcements',
      href: '/student/announcements',
      icon: 'announcements',
      ...(unreadNotices > 0 ? { badge: unreadNotices } : {}),
    },
  ];
}
