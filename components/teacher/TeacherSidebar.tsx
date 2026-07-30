import { PortalSidebar, type PortalNavItem } from '@/components/school/PortalSidebar';

/**
 * Teacher portal navigation.
 *
 * Everything past the dashboard is marked as a placeholder — those destinations
 * arrive with the Academics and Fee Management modules in later sprints.
 */
const ITEMS: readonly PortalNavItem[] = [
  { label: 'My Dashboard', href: '/teacher' },
  { label: 'My Classes', href: '/teacher/classes', placeholder: true },
  { label: 'Attendance', href: '/teacher/attendance', placeholder: true },
  { label: 'Grades', href: '/teacher/grades', placeholder: true },
];

export function TeacherSidebar() {
  return <PortalSidebar items={ITEMS} ariaLabel="Teacher navigation" />;
}
