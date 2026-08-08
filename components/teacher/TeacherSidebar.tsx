import { PortalSidebar, type PortalNavItem } from '@/components/school/PortalSidebar';

/**
 * Teacher portal navigation.
 *
 * The timetable and the register are real destinations as of Sprint 6; marks
 * became one in Sprint 9, which is what the "Grades" placeholder had been
 * standing in for. What remains a placeholder arrives with a later sprint.
 */
const ITEMS: readonly PortalNavItem[] = [
  { label: 'My Dashboard', href: '/teacher' },
  { label: 'My Timetable', href: '/teacher/timetable' },
  { label: 'Attendance', href: '/teacher/attendance' },
  { label: 'Marks', href: '/teacher/marks' },
];

export function TeacherSidebar() {
  return <PortalSidebar items={ITEMS} ariaLabel="Teacher navigation" />;
}
