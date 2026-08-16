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
/** Built per request: the announcements entry carries an unread count. */
export function teacherNav(unreadNotices = 0): PortalNavItem[] {
  return [
    { label: 'My Dashboard', href: '/teacher', icon: 'dashboard' },
    { label: 'My Timetable', href: '/teacher/timetable', icon: 'timetable' },
    { label: 'My Classes', href: '/teacher/classes', icon: 'students' },
    { label: 'Attendance', href: '/teacher/attendance', icon: 'attendance' },
    { label: 'Marks', href: '/teacher/marks', icon: 'marks' },
    { label: 'Gradebook', href: '/teacher/gradebook', icon: 'grading' },
    { label: 'Lesson Plans', href: '/teacher/lesson-plans', icon: 'academics' },
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
