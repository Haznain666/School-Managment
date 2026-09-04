import type { PortalNavItem } from '@/components/school/PortalSidebar';

/**
 * Teacher portal navigation.
 *
 * The timetable and the register are real destinations as of Sprint 6; marks
 * became one in Sprint 9, which is what the "Grades" placeholder had been
 * standing in for. What remains a placeholder arrives with a later sprint.
 *
 * Data rather than a component since Sprint 10.5 — `PortalFrame` renders the
 * same list on desktop and inside the mobile drawer.
 */
/**
 * Built per request: the announcements entry carries an unread count, and
 * Promotions appears only for a teacher who is the class teacher of something.
 *
 * Hiding it is a courtesy, not the control — `/teacher/promotions` refuses the
 * same person, because a link is not a permission and a typed URL would
 * otherwise walk straight in.
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
export function teacherNav(
  unreadNotices = 0,
  isClassTeacher = false,
  unreadChats = 0,
  chatEnabled = true,
): PortalNavItem[] {
  return [
    { label: 'My Dashboard', href: '/teacher', icon: 'dashboard' },
    { label: 'My Timetable', href: '/teacher/timetable', icon: 'timetable' },
    { label: 'My Classes', href: '/teacher/classes', icon: 'students' },
    { label: 'Attendance', href: '/teacher/attendance', icon: 'attendance' },
    { label: 'My Exams', href: '/teacher/exams', icon: 'exams' },
    { label: 'Marks', href: '/teacher/marks', icon: 'marks' },
    { label: 'Gradebook', href: '/teacher/gradebook', icon: 'grading' },
    ...(isClassTeacher
      ? [
          {
            label: 'Promotions',
            href: '/teacher/promotions',
            icon: 'promote' as const,
          },
        ]
      : []),
    { label: 'Lesson Plans', href: '/teacher/lesson-plans', icon: 'academics' },
    // Sprint 27. When the school is shut, and which Saturdays this teacher is
    // on duty. Not gated on anything: a teacher who cannot see the calendar is
    // a teacher planning a lesson for a day the school is closed.
    { label: 'Calendar', href: '/teacher/calendar', icon: 'calendar' },
    ...(chatEnabled
      ? ([
          {
            label: 'Messages',
            href: '/teacher/chat',
            icon: 'chat',
            ...(unreadChats > 0 ? { badge: unreadChats } : {}),
          },
        ] satisfies PortalNavItem[])
      : []),
    {
      label: 'Announcements',
      href: '/teacher/announcements',
      icon: 'announcements',
      ...(unreadNotices > 0 ? { badge: unreadNotices } : {}),
    },
    // Their own record, at the bottom because it is not the job — it is the
    // two things a teacher previously had to walk to the office to ask for.
    { label: 'My Payslips', href: '/teacher/payslips', icon: 'payroll' },
    { label: 'My Leave', href: '/teacher/leave', icon: 'leave' },
  ];
}
