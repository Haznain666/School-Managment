import { PortalSidebar, type PortalNavItem } from '@/components/school/PortalSidebar';

/**
 * Teacher portal navigation.
 *
 * The timetable and the register are real destinations as of Sprint 6. What
 * remains a placeholder arrives with a later sprint.
 */
const ITEMS: readonly PortalNavItem[] = [
  { label: 'My Dashboard', href: '/teacher' },
  { label: 'My Timetable', href: '/teacher/timetable' },
  { label: 'Attendance', href: '/teacher/attendance' },
  { label: 'Grades', href: '/teacher/grades', placeholder: true },
];

export function TeacherSidebar() {
  return <PortalSidebar items={ITEMS} ariaLabel="Teacher navigation" />;
}
